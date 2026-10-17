import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classify } from "./classify.js";
import {
  localMediaRefs,
  MEDIA_DIGEST_KEY,
  MESSAGE_MODIFY_ACTIONS,
  withMediaDigests,
} from "./message.js";
import type { Decision, SentinelMode } from "./types.js";
import { resolveSentinelConfig } from "./types.js";

const TG_OWNER = "123456789";
const STRANGER = "+15550001111";

function info(mode: SentinelMode = "outbound") {
  return {
    config: resolveSentinelConfig({ owners: { telegram: [TG_OWNER] }, mode }),
  };
}

function keyOf(decision: Decision): string {
  if (decision.kind !== "ask" && decision.kind !== "judge") {
    throw new Error(`expected ask or judge, got ${decision.kind}`);
  }
  return decision.action.semanticKey;
}

describe("message edits and deletes", () => {
  it("always ask, whatever the target", () => {
    for (const action of MESSAGE_MODIFY_ACTIONS) {
      for (const target of [{}, { chatId: TG_OWNER, channel: "telegram" }, { target: STRANGER }]) {
        const decision = classify("message", { action, messageId: 7, ...target }, info());
        expect(decision.kind).toBe("ask");
      }
    }
  });

  it("describe the change for the owner and stay asked in money mode", () => {
    const decision = classify(
      "message",
      { action: "edit", channel: "telegram", chatId: TG_OWNER, messageId: 7, message: "Hi" },
      info("money"),
    );
    expect(decision.kind).toBe("ask");
    if (decision.kind === "ask") {
      expect(decision.action.summary).toBe(`Edit a Telegram message in ${TG_OWNER} to "Hi"`);
      expect(decision.action.detail).toContain("could be one of Muse's approval requests");
    }
    expect(classify("message", { action: "delete", messageId: 7 }, info("money")).kind).toBe("ask");
    expect(classify("message", { action: "delete", messageId: 7 }, info("off")).kind).toBe("allow");
  });
});

describe("localMediaRefs", () => {
  it("collects media, path, filePath and MEDIA: lines, skipping web URLs", () => {
    expect(
      localMediaRefs({
        media: " MEDIA: /ws/a.jpg",
        path: "https://example.com/b.png",
        filePath: "~/c.pdf",
        // A literal "\n" counts as a line break, as in core.
        message:
          "Here you go\\nMEDIA: `/ws/my photo.jpg`\nMEDIA: /ws/x.png and ./d.txt\nMEDIA: https://x.test/e.png",
        caption: "MEDIA:file:///ws/f.png",
      }),
    ).toEqual([
      "/ws/a.jpg",
      "~/c.pdf",
      "/ws/my photo.jpg",
      "/ws/my",
      "/ws/x.png and ./d.txt",
      "/ws/x.png",
      "./d.txt",
      "file:///ws/f.png",
    ]);
    expect(localMediaRefs({ message: "no attachments here" })).toEqual([]);
  });
});

describe("withMediaDigests", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sentinel-media-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const send = (extra: Record<string, unknown>): Record<string, unknown> => ({
    action: "send",
    channel: "whatsapp",
    target: STRANGER,
    ...extra,
  });

  async function keyFor(params: Record<string, unknown>): Promise<string> {
    return keyOf(classify("message", await withMediaDigests(params), info()));
  }

  it("changes the approval key when the file's bytes change, not otherwise", async () => {
    const file = path.join(dir, "photo.jpg");
    fs.writeFileSync(file, "one");
    const params = send({ media: file });
    const first = await keyFor(params);
    expect(await keyFor(params)).toBe(first);
    expect(await keyFor(send({ path: file }))).not.toBe(first);

    fs.writeFileSync(file, "two");
    const second = await keyFor(params);
    expect(second).not.toBe(first);
    fs.writeFileSync(file, "one");
    expect(await keyFor(params)).toBe(first);

    // Same for a file named on a MEDIA: line, and through a file:// URL.
    const line = send({ message: `Look\nMEDIA: ${file}` });
    const url = send({ media: `file://${file}` });
    const lineKey = await keyFor(line);
    const urlKey = await keyFor(url);
    fs.writeFileSync(file, "three");
    expect(await keyFor(line)).not.toBe(lineKey);
    expect(await keyFor(url)).not.toBe(urlKey);
  });

  it("leaves the params alone and drops a digest the model passed in", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "x");
    const params = send({ media: file, [MEDIA_DIGEST_KEY]: { [file]: "sha256:00" } });
    const copy = await withMediaDigests(params);
    expect(params[MEDIA_DIGEST_KEY]).toEqual({ [file]: "sha256:00" });
    expect(copy[MEDIA_DIGEST_KEY]).toEqual({
      [file]: "sha256:2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    });
    expect(await withMediaDigests(send({ message: "hi", [MEDIA_DIGEST_KEY]: "x" }))).toEqual(
      send({ message: "hi" }),
    );
  });

  it("keeps a stable key for files the send could not read either", async () => {
    const missing = send({ media: path.join(dir, "missing.jpg") });
    expect(await keyFor(missing)).toBe(await keyFor(missing));
    const folder = send({ media: dir });
    expect(await keyFor(folder)).toBe(await keyFor(folder));
    expect((await withMediaDigests(folder))[MEDIA_DIGEST_KEY]).toEqual({ [dir]: "not-a-file" });
  });

  it("never repeats the key for a file too large to fingerprint", async () => {
    const file = path.join(dir, "big.bin");
    fs.writeFileSync(file, "0123456789");
    const params = send({ media: file });
    const a = keyOf(classify("message", await withMediaDigests(params, { maxBytes: 4 }), info()));
    const b = keyOf(classify("message", await withMediaDigests(params, { maxBytes: 4 }), info()));
    expect(a).not.toBe(b);
  });

  it("does not show the fingerprints to the owner", async () => {
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "x");
    const decision = classify("message", await withMediaDigests(send({ media: file })), info());
    expect(decision.kind).toBe("ask");
    if (decision.kind === "ask") {
      expect(decision.action.detail).toContain(`Attachment: ${file}`);
      expect(decision.action.detail).not.toContain("sha256");
    }
  });
});
