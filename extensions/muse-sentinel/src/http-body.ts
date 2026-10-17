// Reads a small JSON request body with a size limit and a timeout.
// Own copy instead of the SDK's readJsonBodyWithLimit, so this module imports nothing from
// OpenClaw at runtime and tests never load the gateway.
import type { IncomingMessage } from "node:http";

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_BODY_TIMEOUT_MS = 10_000;

export type JsonBodyErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_BODY_TIMEOUT"
  | "CONNECTION_CLOSED"
  | "INVALID_JSON";

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; code: JsonBodyErrorCode; status: number; error: string };

const FAILURES: Record<JsonBodyErrorCode, { status: number; error: string }> = {
  PAYLOAD_TOO_LARGE: { status: 413, error: "Payload too large" },
  REQUEST_BODY_TIMEOUT: { status: 408, error: "Request body timeout" },
  CONNECTION_CLOSED: { status: 400, error: "Connection closed" },
  INVALID_JSON: { status: 400, error: "Invalid JSON" },
};

function failure(code: JsonBodyErrorCode): JsonBodyResult {
  return { ok: false, code, ...FAILURES[code] };
}

function declaredLength(req: IncomingMessage): number | undefined {
  const header = req.headers["content-length"];
  const raw = Array.isArray(header) ? header[0] : header;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Reads and parses a JSON body. An empty body is `{}`. Too large, too slow, closed early or
 * unparsable bodies come back as `{ ok: false, status }` (413, 408, 400, 400); the request is
 * destroyed when it is too large or too slow.
 */
export function readJsonBody(
  req: IncomingMessage,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<JsonBodyResult> {
  const maxBytes = Math.max(1, opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES);
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_BODY_TIMEOUT_MS);
  const length = declaredLength(req);
  if (length !== undefined && length > maxBytes) {
    req.destroy();
    return Promise.resolve(failure("PAYLOAD_TOO_LARGE"));
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    const finish = (result: JsonBodyResult) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("close", onClose);
      resolve(result);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buffer.length;
      if (total > maxBytes) {
        // Destroy without an Error: an 'error' event with no listener left would crash.
        req.destroy();
        finish(failure("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        finish({ ok: true, value: {} });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(text) as unknown });
      } catch {
        finish(failure("INVALID_JSON"));
      }
    };
    const onError = () => finish(failure("CONNECTION_CLOSED"));
    const onClose = () => finish(failure("CONNECTION_CLOSED"));
    const timer = setTimeout(() => {
      req.destroy();
      finish(failure("REQUEST_BODY_TIMEOUT"));
    }, timeoutMs);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}
