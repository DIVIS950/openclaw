import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isOwnerAddress, readLastRoute } from "./resume.js";

const dirs: string[] = [];

function apiWithStore(store: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sentinel-resume-"));
  dirs.push(dir);
  const storePath = path.join(dir, "sessions.json");
  if (store !== undefined) {
    fs.writeFileSync(storePath, typeof store === "string" ? store : JSON.stringify(store));
  }
  const resolveStorePath = vi.fn(() => storePath);
  const api = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    runtime: {
      config: { loadConfig: () => ({ session: { store: "/custom/{agentId}.json" } }) },
      channel: { session: { resolveStorePath } },
    },
  } as unknown as OpenClawPluginApi;
  return { api, resolveStorePath };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readLastRoute", () => {
  it("reads the last Telegram or WhatsApp route of the session", () => {
    const { api, resolveStorePath } = apiWithStore({
      "agent:work:main": {
        lastChannel: "whatsapp",
        lastTo: "+420123456789",
        lastAccountId: "default",
      },
    });
    expect(readLastRoute(api, "agent:work:main")).toEqual({
      channel: "whatsapp",
      to: "+420123456789",
      accountId: "default",
      threadId: undefined,
    });
    expect(resolveStorePath).toHaveBeenCalledWith("/custom/{agentId}.json", { agentId: "work" });
  });

  it("returns nothing for other channels, missing sessions and unreadable stores", () => {
    const webchat = apiWithStore({ "agent:main:main": { lastChannel: "webchat", lastTo: "x" } });
    expect(readLastRoute(webchat.api, "agent:main:main")).toBeUndefined();
    expect(readLastRoute(apiWithStore({}).api, "agent:main:main")).toBeUndefined();
    expect(readLastRoute(apiWithStore("{broken").api, "agent:main:main")).toBeUndefined();
    expect(readLastRoute(apiWithStore(undefined).api, "agent:main:main")).toBeUndefined();
  });
});

describe("isOwnerAddress", () => {
  const owners = { telegram: ["123"], whatsapp: ["+420123456789"] };
  it("matches only configured owners", () => {
    expect(isOwnerAddress({ channel: "telegram", to: "telegram:123" }, owners)).toBe(true);
    expect(isOwnerAddress({ channel: "telegram", to: "telegram:456" }, owners)).toBe(false);
    expect(isOwnerAddress({ channel: "whatsapp", to: "+420 123 456 789" }, owners)).toBe(true);
    expect(isOwnerAddress({ channel: "whatsapp", to: "+15550001111" }, owners)).toBe(false);
  });
});
