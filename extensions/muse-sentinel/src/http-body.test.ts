import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BODY_BYTES, readJsonBody } from "./http-body.js";

class FakeRequest extends PassThrough {
  headers: Record<string, string> = {};
}

function request(headers: Record<string, string> = {}): FakeRequest {
  const req = new FakeRequest();
  req.headers = headers;
  return req;
}

const asReq = (req: FakeRequest) => req as unknown as IncomingMessage;

describe("readJsonBody", () => {
  it("parses a JSON body", async () => {
    const req = request();
    const result = readJsonBody(asReq(req));
    req.end('{"id":"abc","decision":"approve"}');
    expect(await result).toEqual({ ok: true, value: { id: "abc", decision: "approve" } });
  });

  it("treats an empty body as {}", async () => {
    const req = request();
    const result = readJsonBody(asReq(req));
    req.end();
    expect(await result).toEqual({ ok: true, value: {} });
  });

  it("rejects invalid JSON with 400", async () => {
    const req = request();
    const result = readJsonBody(asReq(req));
    req.end("{nope");
    expect(await result).toMatchObject({ ok: false, code: "INVALID_JSON", status: 400 });
  });

  it("rejects a declared length over 16 KB with 413 before reading", async () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(16 * 1024);
    const req = request({ "content-length": String(16 * 1024 + 1) });
    expect(await readJsonBody(asReq(req))).toMatchObject({
      ok: false,
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    });
    expect(req.destroyed).toBe(true);
  });

  it("rejects a streamed body over the limit with 413", async () => {
    const req = request();
    const result = readJsonBody(asReq(req), { maxBytes: 10 });
    req.write('{"a":"');
    req.write("0123456789");
    expect(await result).toMatchObject({ ok: false, code: "PAYLOAD_TOO_LARGE", status: 413 });
    expect(req.destroyed).toBe(true);
  });

  it("times out a slow body with 408", async () => {
    const req = request();
    const result = readJsonBody(asReq(req), { timeoutMs: 20 });
    req.write("{");
    expect(await result).toMatchObject({ ok: false, code: "REQUEST_BODY_TIMEOUT", status: 408 });
  });

  it("reports a connection closed before the end", async () => {
    const req = request();
    const result = readJsonBody(asReq(req));
    req.write("{");
    req.destroy();
    expect(await result).toMatchObject({ ok: false, code: "CONNECTION_CLOSED", status: 400 });
  });
});
