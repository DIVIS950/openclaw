// HTTP API for the desktop watch page (through Caddy) and Pineapple. Every path sits under
// /api/channels/, where the gateway checks its bearer token before any plugin route runs.
// Responses never contain approval codes.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody } from "./http-body.js";
import type { ApprovalStore } from "./store.js";
import { asRecord } from "./text.js";
import type { PendingEntry, SentinelConfig } from "./types.js";

export const ROUTE_BASE = "/api/channels/muse-sentinel";
const BODY_LIMITS = { maxBytes: 16 * 1024, timeoutMs: 10_000 };

export type ResumeMode = "channel" | "none";

export type RouteContext = {
  config: SentinelConfig;
  store: () => ApprovalStore;
  logger: { warn: (message: string) => void; error: (message: string) => void };
  /** After a decision made over HTTP: wake the agent on the owner's last chat when asked to. */
  afterDecide: (entry: PendingEntry, resume: ResumeMode) => void;
  /** After the owner gives the browser back over HTTP. */
  afterGiveBack: (resume: ResumeMode) => void;
};

export type Route = {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/** Rejects other methods with 405; true when the request may go on. */
function allowMethod(req: IncomingMessage, res: ServerResponse, method: "GET" | "POST"): boolean {
  if (req.method === method) {
    return true;
  }
  res.setHeader("Allow", method);
  sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  return false;
}

/** Reads the JSON body; on failure answers with the matching status and returns undefined. */
async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
  const body = await readJsonBody(req, BODY_LIMITS);
  if (!body.ok) {
    sendJson(res, body.status, { ok: false, error: body.error });
    return undefined;
  }
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    sendJson(res, 400, { ok: false, error: "expected a JSON object" });
    return undefined;
  }
  return asRecord(body.value);
}

function readResumeMode(value: unknown, fallback: ResumeMode): ResumeMode | undefined {
  if (value === undefined) {
    return fallback;
  }
  return value === "channel" || value === "none" ? value : undefined;
}

function pendingView(entry: PendingEntry) {
  return {
    id: entry.id,
    summary: entry.summary,
    detail: entry.detail,
    tool: entry.tool,
    url: entry.url,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  };
}

function recentView(entry: PendingEntry) {
  return {
    id: entry.id,
    summary: entry.summary,
    status: entry.status,
    decidedAt: entry.decidedAt,
    decidedVia: entry.decidedVia,
  };
}

/** Wraps a handler so an unexpected error becomes a 500 instead of a hanging request. */
function guarded(ctx: RouteContext, name: string, handler: Route["handler"]): Route["handler"] {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      ctx.logger.error(`muse-sentinel: HTTP ${name} failed: ${String(err)}`);
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: "internal_error" });
      } else {
        res.end();
      }
    }
  };
}

export function createRoutes(ctx: RouteContext): Route[] {
  const state: Route["handler"] = async (req, res) => {
    if (!allowMethod(req, res, "GET")) {
      return;
    }
    const store = ctx.store();
    sendJson(res, 200, {
      paused: store.paused,
      mode: ctx.config.mode,
      pending: store.pending().map(pendingView),
      recent: store.recent(20).map(recentView),
    });
  };

  const decide: Route["handler"] = async (req, res) => {
    if (!allowMethod(req, res, "POST")) {
      return;
    }
    const body = await readBody(req, res);
    if (!body) {
      return;
    }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const decision = body.decision;
    const resume = readResumeMode(body.resume, "channel");
    if (!id || (decision !== "approve" && decision !== "deny") || !resume) {
      sendJson(res, 400, {
        ok: false,
        error:
          'expected {"id": string, "decision": "approve" | "deny", "resume"?: "channel" | "none"}',
      });
      return;
    }
    const store = ctx.store();
    // Only ids here: the 6-digit codes are for the owner's chat replies.
    if (!store.get(id)) {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    const result = store.decide(id, decision, "web");
    if (!result.ok) {
      const status = result.reason === "not_pending" ? result.entry.status : undefined;
      sendJson(res, result.reason === "not_pending" ? 409 : 404, {
        ok: false,
        error: result.reason,
        ...(status ? { status } : {}),
      });
      return;
    }
    sendJson(res, 200, { ok: true, status: result.entry.status });
    ctx.afterDecide(result.entry, resume);
  };

  const pause: Route["handler"] = async (req, res) => {
    if (!allowMethod(req, res, "POST") || !(await readBody(req, res))) {
      return;
    }
    const store = ctx.store();
    store.setPaused(true);
    sendJson(res, 200, { paused: store.paused });
  };

  const giveBack: Route["handler"] = async (req, res) => {
    if (!allowMethod(req, res, "POST")) {
      return;
    }
    const body = await readBody(req, res);
    if (!body) {
      return;
    }
    // Waking the agent is opt-in here; the watch page only toggles the flag.
    const resume = readResumeMode(body.resume, "none");
    if (!resume) {
      sendJson(res, 400, { ok: false, error: 'expected {"resume"?: "channel" | "none"}' });
      return;
    }
    const store = ctx.store();
    const wasPaused = store.paused;
    store.setPaused(false);
    sendJson(res, 200, { paused: store.paused });
    if (wasPaused) {
      ctx.afterGiveBack(resume);
    }
  };

  const health: Route["handler"] = async (req, res) => {
    if (!allowMethod(req, res, "GET")) {
      return;
    }
    sendJson(res, 200, {
      ok: true,
      mode: ctx.config.mode,
      guardModel: ctx.config.guardModel,
      pending: ctx.store().pending().length,
    });
  };

  return [
    { path: `${ROUTE_BASE}/state`, handler: guarded(ctx, "state", state) },
    { path: `${ROUTE_BASE}/decide`, handler: guarded(ctx, "decide", decide) },
    { path: `${ROUTE_BASE}/pause`, handler: guarded(ctx, "pause", pause) },
    { path: `${ROUTE_BASE}/resume`, handler: guarded(ctx, "resume", giveBack) },
    { path: `${ROUTE_BASE}/health`, handler: guarded(ctx, "health", health) },
  ];
}
