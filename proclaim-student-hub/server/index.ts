import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AppConfig } from "../shared/api.ts";
import {
  AiRefusalError,
  chatReply,
  dailyBrief,
  makeRevisionPack,
  oneShot,
  oneShotJson,
  summariseInbox,
  tutorReply,
} from "./ai.ts";
import { AuthError, createRateLimiter, verifyGoogleToken } from "./auth.ts";

const PORT = Number(process.env.PORT || 8787);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const ALLOWED = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const MAX_BODY = 20 * 1024 * 1024;

if (!GOOGLE_CLIENT_ID) {
  console.warn("GOOGLE_CLIENT_ID is not set: sign-in and AI features will be off. See README.md.");
}

const allowCall = createRateLimiter(Number(process.env.AI_CALLS_PER_MINUTE || 20));

// ---------- Request validation ----------

const Image = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  data: z.string().max(8_000_000),
});
const Turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20_000),
  images: z.array(Image).max(4).optional(),
});
const TutorBody = z.object({
  mode: z.enum(["explain", "check", "quiz", "summary"]),
  history: z.array(Turn).min(1).max(60),
});
const BriefBody = z.object({
  name: z.string().max(100),
  homework: z
    .array(
      z.object({
        title: z.string().max(300),
        course: z.string().max(200),
        due: z.string().max(60).optional(),
      }),
    )
    .max(30),
  emails: z.array(z.object({ from: z.string().max(200), subject: z.string().max(300) })).max(20),
  events: z.array(z.object({ title: z.string().max(300), start: z.string().max(60) })).max(20),
});
const InboxBody = z.object({
  emails: z
    .array(
      z.object({
        id: z.string().max(100),
        from: z.string().max(200),
        subject: z.string().max(300),
        snippet: z.string().max(1000),
      }),
    )
    .max(20),
});
const ReviseBody = z.object({
  images: z.array(Image).max(4),
  text: z.string().max(30_000),
});
const ChatBody = z.object({
  instructions: z.string().max(8_000),
  history: z.array(Turn).min(1).max(60),
});
const PromptBody = z.object({
  prompt: z.string().min(1).max(40_000),
  quick: z.boolean().optional(),
  images: z.array(Image).max(4).optional(),
});

// ---------- Helpers ----------

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) {
      throw new HttpError(413, "That's too big to send. Try fewer or smaller photos.");
    }
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Bad request.");
  }
}

function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, "Bad request.");
  }
  return result.data;
}

async function requireUser(req: IncomingMessage): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new HttpError(503, "The app isn't set up yet (GOOGLE_CLIENT_ID missing).");
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    throw new AuthError("Please sign in with Google first.", 401);
  }
  const email = await verifyGoogleToken(token, GOOGLE_CLIENT_ID, ALLOWED);
  if (!allowCall(email)) {
    throw new HttpError(429, "Slow down a little! Try again in a minute.");
  }
  return email;
}

function errorResponse(res: ServerResponse, err: unknown) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { error: err.message });
  }
  if (err instanceof AuthError) {
    return sendJson(res, err.status, { error: err.message });
  }
  if (err instanceof AiRefusalError) {
    return sendJson(res, 422, { error: err.message });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return sendJson(res, 429, { error: "The AI is busy right now. Try again in a minute." });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("Anthropic API key rejected");
    return sendJson(res, 503, { error: "The AI isn't set up correctly on the server." });
  }
  if (err instanceof Anthropic.APIError) {
    console.error("Anthropic API error", err.status, err.message);
    return sendJson(res, 502, { error: "The AI had a problem. Please try again." });
  }
  console.error(err);
  return sendJson(res, 500, { error: "Something went wrong. Please try again." });
}

/** Streams plain text to the browser as the AI writes it. */
async function streamText(
  res: ServerResponse,
  run: (onText: (text: string) => void, signal: AbortSignal) => Promise<void>,
) {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  try {
    await run((text) => res.write(text), abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) {
      // Headers are already sent, so report the problem inside the stream.
      const message =
        err instanceof AiRefusalError
          ? err.message
          : "Sorry, something went wrong. Please try again.";
      if (!(err instanceof AiRefusalError)) {
        console.error(err);
      }
      res.write(`\n\n${message}`);
    }
  }
  res.end();
}

// ---------- API routes ----------

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method === "GET" && pathname === "/api/config") {
    const config: AppConfig = {
      googleClientId: GOOGLE_CLIENT_ID,
      aiEnabled: Boolean(GOOGLE_CLIENT_ID),
    };
    return sendJson(res, 200, config);
  }
  if (req.method !== "POST") {
    throw new HttpError(404, "Not found.");
  }

  await requireUser(req);
  const raw = await readJson(req);

  switch (pathname) {
    case "/api/ai/brief": {
      const brief = await dailyBrief(parseBody(BriefBody, raw));
      return sendJson(res, 200, { brief });
    }
    case "/api/ai/inbox":
      return sendJson(res, 200, await summariseInbox(parseBody(InboxBody, raw)));
    case "/api/ai/revise":
      return sendJson(res, 200, await makeRevisionPack(parseBody(ReviseBody, raw)));
    case "/api/ai/tutor": {
      const body = parseBody(TutorBody, raw);
      return streamText(res, (onText, signal) =>
        tutorReply(body.mode, body.history, onText, signal),
      );
    }
    case "/api/ai/chat": {
      const body = parseBody(ChatBody, raw);
      return streamText(res, (onText, signal) =>
        chatReply(body.instructions, body.history, onText, signal),
      );
    }
    case "/api/ai/text": {
      const body = parseBody(PromptBody, raw);
      return sendJson(res, 200, {
        text: await oneShot(body.prompt, body.quick ?? false, body.images),
      });
    }
    case "/api/ai/json": {
      const body = parseBody(PromptBody, raw);
      return sendJson(res, 200, {
        value: await oneShotJson(body.prompt, body.quick ?? false, body.images),
      });
    }
    default:
      throw new HttpError(404, "Not found.");
  }
}

// ---------- Static files (production build) ----------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

async function serveStatic(res: ServerResponse, pathname: string) {
  let file = path.resolve(DIST, `.${decodeURIComponent(pathname)}`);
  // Never serve anything outside the build folder.
  if (!file.startsWith(DIST + path.sep) && file !== DIST) {
    throw new HttpError(404, "Not found.");
  }
  let info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    // Single-page app: unknown paths get index.html.
    file = path.join(DIST, "index.html");
    info = await stat(file).catch(() => null);
    if (!info) {
      throw new HttpError(404, "App not built yet. Run npm run build.");
    }
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": file.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(res, pathname);
    } else {
      throw new HttpError(405, "Method not allowed.");
    }
  } catch (err) {
    if (!res.headersSent) {
      errorResponse(res, err);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Proclaim Student Hub server on http://localhost:${PORT}`);
});
