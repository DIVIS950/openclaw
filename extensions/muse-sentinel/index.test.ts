import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, {
  ALREADY_USED_TEXT,
  DENIED_BLOCK_REASON,
  ERROR_BLOCK_REASON,
  NOT_OWNER_TEXT,
  NOT_WAITING_TEXT,
  PAUSED_BLOCK_REASON,
  registerMuseSentinel,
  TAB_CHECK_FAILED_REASON,
  TAB_CLOSED_REASON,
  TELEGRAM_TAP_TEXT,
  type SentinelDeps,
} from "./index.js";
import { NO_SNAPSHOT_REASON, STALE_SNAPSHOT_REASON } from "./src/classify.js";
import type { GuardVerdict } from "./src/guard.js";
import { approvedText, deniedText, GIVE_BACK_TEXT } from "./src/resume.js";
import {
  buttonsSnapshot,
  CHECKOUT_SNAPSHOT,
  CHECKOUT_SNAPSHOT_RENUMBERED,
  CHECKOUT_URL,
  wrapSnapshot,
} from "./src/test-helpers.js";
import type { ActionDescriptor } from "./src/types.js";

// Drives the whole plugin through a mock OpenClaw plugin api: hooks, commands, HTTP routes and
// the service, with a temp state dir. Nothing from the gateway is loaded.

const OWNER_TG = "123456789";
const OWNER_WA = "+420123456789";
const PLUGIN_CONFIG = {
  owners: { telegram: [OWNER_TG], whatsapp: [OWNER_WA] },
  guardModel: "claude-haiku-5-5",
  approvalTtlMinutes: 30,
  mode: "outbound",
};
const SESSION = "agent:main:main";
const STATE_KEY = Symbol.for("muse-sentinel");

type HookResult = { block?: boolean; blockReason?: string; params?: Record<string, unknown> };
type Handler = (...args: never[]) => unknown;
type CommandCtx = {
  channel: string;
  senderId?: string;
  from?: string;
  to?: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
  accountId?: string;
};
type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
type Service = { id: string; start: (ctx: unknown) => unknown; stop?: (ctx: unknown) => unknown };
type DispatchParams = {
  ctx: Record<string, unknown>;
  dispatcherOptions: {
    deliver: (payload: { text?: string }, info: { kind: string }) => Promise<void>;
  };
};

const tempDirs: string[] = [];
const servers: http.Server[] = [];
const startedServices: Service[] = [];

function resetSingleton() {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  delete holder[STATE_KEY];
}

function createHarness(
  opts: {
    pluginConfig?: Record<string, unknown>;
    deps?: Partial<SentinelDeps>;
    stateDir?: string;
  } = {},
) {
  const stateDir = opts.stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "muse-sentinel-"));
  tempDirs.push(stateDir);
  const hooks = new Map<string, { handler: Handler; priority?: number }>();
  const commands = new Map<
    string,
    { acceptsArgs?: boolean; requireAuth?: boolean; handler: (ctx: CommandCtx) => unknown }
  >();
  const routes = new Map<string, RouteHandler>();
  const services: Service[] = [];
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sendMessageTelegram = vi.fn(
    async (_to: string, _text: string, _opts?: Record<string, unknown>) => ({
      messageId: "1",
      chatId: OWNER_TG,
    }),
  );
  const sendMessageWhatsApp = vi.fn(
    async (_to: string, _text: string, _opts: Record<string, unknown>) => ({
      messageId: "1",
      toJid: "420123456789@s.whatsapp.net",
    }),
  );
  const finalizeInboundContext = vi.fn((ctx: Record<string, unknown>) => ({
    ...ctx,
    CommandAuthorized: ctx.CommandAuthorized === true,
  }));
  const dispatchReply = vi.fn(async (params: DispatchParams) => {
    await params.dispatcherOptions.deliver({ text: "Done, continuing." }, { kind: "final" });
    return { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
  });
  const sessionStorePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
  const resolveStateDir = vi.fn(() => stateDir);
  const judge = vi.fn(
    async (action: ActionDescriptor): Promise<GuardVerdict> => ({
      decision: "ask",
      reason: "test guard asks",
      summary: action.summary,
    }),
  );
  // Plain length split; the real chunkers also respect paragraphs and code fences.
  const chunkMarkdownText = vi.fn((text: string, limit: number) => {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += limit) {
      parts.push(text.slice(i, i + limit));
    }
    return parts;
  });
  const resolveTextChunkLimit = vi.fn(
    (_cfg: unknown, _channel?: string, _account?: string) => 4000,
  );
  const runtime = {
    config: { loadConfig: vi.fn(() => ({})) },
    state: { resolveStateDir },
    channel: {
      text: { chunkMarkdownText, resolveTextChunkLimit },
      telegram: { sendMessageTelegram },
      whatsapp: { sendMessageWhatsApp },
      reply: {
        finalizeInboundContext,
        dispatchReplyWithBufferedBlockDispatcher: dispatchReply,
      },
      session: { resolveStorePath: vi.fn(() => sessionStorePath) },
    },
  };
  const api = {
    id: "muse-sentinel",
    name: "Muse Sentinel",
    source: "test",
    config: {},
    pluginConfig: opts.pluginConfig ?? PLUGIN_CONFIG,
    runtime,
    logger,
    on: vi.fn((name: string, handler: Handler, hookOpts?: { priority?: number }) => {
      hooks.set(name, { handler, priority: hookOpts?.priority });
    }),
    registerCommand: vi.fn((command: { name: string; handler: (ctx: CommandCtx) => unknown }) => {
      commands.set(command.name, command);
    }),
    registerHttpRoute: vi.fn((route: { path: string; handler: RouteHandler }) => {
      routes.set(route.path, route.handler);
    }),
    registerService: vi.fn((service: Service) => {
      services.push(service);
    }),
  } as unknown as OpenClawPluginApi;

  // The browser's open tabs (what CDP /json/list would report); a snapshot opens its tab.
  const openTabs = new Set<string>();
  const openPageIds = vi.fn(async (_profile: string | undefined) => [...openTabs]);
  registerMuseSentinel(api, { judge, notifyTimeoutMs: 2_000, openPageIds, ...opts.deps });

  const hook = (name: string) => {
    const entry = hooks.get(name);
    if (!entry) {
      throw new Error(`hook ${name} not registered`);
    }
    return entry.handler as unknown as (event: unknown, ctx: unknown) => unknown;
  };

  const h = {
    api,
    stateDir,
    hooks,
    commands,
    routes,
    services,
    logger,
    judge,
    resolveStateDir,
    sendMessageTelegram,
    sendMessageWhatsApp,
    finalizeInboundContext,
    dispatchReply,
    resolveTextChunkLimit,
    sessionStorePath,
    openTabs,
    openPageIds,
    async call(toolName: string, params: Record<string, unknown>, sessionKey = SESSION) {
      return (await hook("before_tool_call")({ toolName, params }, { toolName, sessionKey })) as
        | HookResult
        | undefined;
    },
    after(event: Record<string, unknown>) {
      hook("after_tool_call")(event, { toolName: event.toolName });
    },
    snapshot(text: string, targetId = "TAB1", url = CHECKOUT_URL) {
      openTabs.add(targetId);
      h.after({
        toolName: "browser",
        params: { action: "snapshot" },
        result: { content: [{ type: "text", text }], details: { ok: true, targetId, url } },
      });
    },
    click(ref: string, extra: Record<string, unknown> = {}) {
      return h.call("browser", { action: "act", request: { kind: "click", ref, ...extra } });
    },
    async command(name: string, ctx: Partial<CommandCtx>) {
      const command = commands.get(name);
      if (!command) {
        throw new Error(`command ${name} not registered`);
      }
      const args = ctx.args ?? "";
      return (await command.handler({
        channel: "telegram",
        isAuthorizedSender: true,
        commandBody: `/${name} ${args}`.trim(),
        config: {},
        ...ctx,
        args,
      })) as { text?: string };
    },
    telegramOwner(args: string): Partial<CommandCtx> {
      const from = `telegram:${OWNER_TG}`;
      return { channel: "telegram", senderId: OWNER_TG, from, to: from, args };
    },
    whatsappOwner(args: string): Partial<CommandCtx> {
      return { channel: "whatsapp", senderId: OWNER_WA, from: OWNER_WA, to: OWNER_WA, args };
    },
    /** The entry id from the latest Telegram approval prompt's Allow button. */
    lastId(): string {
      const opts = sendMessageTelegram.mock.calls.at(-1)?.[2] as
        | { buttons?: Array<Array<{ callback_data: string }>> }
        | undefined;
      const data = opts?.buttons?.[0]?.[0]?.callback_data ?? "";
      const id = /^\/ok ([0-9a-f-]{36})$/.exec(data)?.[1];
      if (!id) {
        throw new Error(`no entry id in the last Telegram prompt (${data})`);
      }
      return id;
    },
    /** The 6-digit code from the latest WhatsApp approval prompt. */
    lastCode(): string {
      const text = String(sendMessageWhatsApp.mock.calls.at(-1)?.[1] ?? "");
      const code = /Reply \/ok (\d{6}) to allow/.exec(text)?.[1];
      if (!code) {
        throw new Error(`no approval code in the last WhatsApp prompt (${text})`);
      }
      return code;
    },
    startService(config: Record<string, unknown> = {}) {
      const service = services[0];
      if (!service) {
        throw new Error("no service registered");
      }
      startedServices.push(service);
      return service.start({ config, stateDir, logger });
    },
    async server() {
      const server = http.createServer((req, res) => {
        const handler = routes.get(new URL(req.url ?? "/", "http://localhost").pathname);
        if (!handler) {
          res.statusCode = 404;
          res.end();
          return;
        }
        void handler(req, res);
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      return (method: string, route: string, body?: string) =>
        httpRequest(`http://127.0.0.1:${port}/api/channels/muse-sentinel/${route}`, method, body);
    },
  };
  return h;
}

type HttpResult = { status: number; json: Record<string, unknown>; text: string; allow?: string };

function httpRequest(url: string, method: string, body?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, headers: body === undefined ? {} : { "content-type": "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            // not JSON
          }
          resolve({ status: res.statusCode ?? 0, json, text, allow: res.headers.allow });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

beforeEach(() => {
  resetSingleton();
});

afterEach(async () => {
  for (const service of startedServices.splice(0)) {
    await service.stop?.({});
  }
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.useRealTimers();
  resetSingleton();
});

describe("registration", () => {
  it("registers the hooks, owner commands, HTTP routes and service", () => {
    const h = createHarness();
    expect(h.hooks.get("before_tool_call")?.priority).toBe(-1000);
    expect(h.hooks.has("after_tool_call")).toBe(true);
    expect([...h.commands.keys()].toSorted()).toEqual(["no", "ok", "pause", "resume"]);
    for (const command of h.commands.values()) {
      expect(command).toMatchObject({ acceptsArgs: true, requireAuth: true });
    }
    expect([...h.routes.keys()].toSorted()).toEqual([
      "/api/channels/muse-sentinel/decide",
      "/api/channels/muse-sentinel/health",
      "/api/channels/muse-sentinel/pause",
      "/api/channels/muse-sentinel/resume",
      "/api/channels/muse-sentinel/state",
    ]);
    expect(h.services.map((s) => s.id)).toEqual(["muse-sentinel"]);
  });

  it("default export registers with the real guard, which asks when no API key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(plugin.id).toBe("muse-sentinel");
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-sentinel-"));
    tempDirs.push(stateDir);
    const hooks = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const sendMessageTelegram = vi.fn(async () => ({ messageId: "1", chatId: OWNER_TG }));
    const api = {
      pluginConfig: { owners: { telegram: [OWNER_TG] } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime: {
        state: { resolveStateDir: () => stateDir },
        channel: { telegram: { sendMessageTelegram } },
      },
      on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        hooks.set(name, handler);
      },
      registerCommand: vi.fn(),
      registerHttpRoute: vi.fn(),
      registerService: vi.fn(),
    } as unknown as OpenClawPluginApi;
    plugin.register(api);
    const result = (await hooks.get("before_tool_call")?.(
      { toolName: "browser", params: { action: "press", request: {} } },
      { toolName: "browser" },
    )) as HookResult;
    expect(result.block).toBe(true);
    const unsubscribe = (await hooks.get("before_tool_call")?.(
      {
        toolName: "browser",
        params: { action: "navigate", targetUrl: "https://list.example.com/unsubscribe?id=9" },
      },
      { toolName: "browser" },
    )) as HookResult;
    expect(unsubscribe.blockReason).toContain("needs the owner's approval");
    // Without a CDP URL in the config the open tabs cannot be listed: browser acts fail closed.
    hooks.get("after_tool_call")?.(
      {
        toolName: "browser",
        params: { action: "snapshot" },
        result: {
          content: [{ type: "text", text: CHECKOUT_SNAPSHOT }],
          details: { ok: true, targetId: "TAB1", url: CHECKOUT_URL },
        },
      },
      { toolName: "browser" },
    );
    expect(
      await hooks.get("before_tool_call")?.(
        { toolName: "browser", params: { action: "act", request: { kind: "click", ref: "e8" } } },
        { toolName: "browser" },
      ),
    ).toEqual({ block: true, blockReason: TAB_CHECK_FAILED_REASON });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendMessageTelegram).toHaveBeenCalledTimes(2);
  });
});

describe("before_tool_call", () => {
  it("allows reading tools and pins the classified params", async () => {
    const h = createHarness();
    const params = { path: "notes.md" };
    expect(await h.call("read", params)).toEqual({ params });
  });

  it("blocks always-denied tools with the tool name", async () => {
    const h = createHarness();
    expect(await h.call("exec", { command: "curl example.com" })).toEqual({
      block: true,
      blockReason: "BLOCKED by Muse Sentinel: the exec tool is turned off on this Muse server.",
    });
  });

  it("blocks a risky click with a key-free reason and sends the keys only to the owner", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    const result = await h.click("e8");
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toBe(
      'BLOCKED by Muse Sentinel: this needs the owner\'s approval: Click "Place order" on shop.example.com. The owner has been asked on their phone. Do not retry this action and do not try another way to do it. Tell the owner in one short sentence what you are waiting for, then stop. If they approve, you will be told to continue.',
    );
    const code = h.lastCode();
    const id = h.lastId();
    expect(result?.blockReason).not.toContain(code);
    expect(result?.blockReason).not.toContain(id);
    expect(result?.blockReason).not.toMatch(/\d{6}/);
    expect(h.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.mock.calls[0]?.[0].element).toMatchObject({
      role: "button",
      name: "Place order",
    });

    const [tgTo, tgText, tgOpts] = h.sendMessageTelegram.mock.calls[0] ?? [];
    expect(tgTo).toBe(OWNER_TG);
    expect(tgText).toContain("Place order");
    // A quoted reply shows the Telegram text to the model, so it holds neither key.
    expect(tgText).not.toContain(code);
    expect(tgText).not.toContain(id);
    expect(tgOpts).toMatchObject({
      textMode: "html",
      buttons: [
        [
          {
            text: '✅ Allow: Click "Place order" on shop.example.com',
            callback_data: `/ok ${id}`,
            style: "success",
          },
        ],
        [{ text: "❌ Don't", callback_data: `/no ${id}`, style: "danger" }],
      ],
    });
    const [waTo, waText, waOpts] = h.sendMessageWhatsApp.mock.calls[0] ?? [];
    expect(waTo).toBe(OWNER_WA);
    expect(waText).toContain(`Reply /ok ${code} to allow or /no ${code} to stop.`);
    expect(waOpts).toEqual({ verbose: false });

    // Retrying before the owner answers does not send a second prompt.
    expect((await h.click("e8"))?.blockReason).toBe(result?.blockReason);
    expect(h.sendMessageTelegram).toHaveBeenCalledTimes(1);
  });

  it("allows the approved action once, also with a renumbered ref, after /ok from the Telegram owner", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();
    const id = h.lastId();

    const reply = await h.command("ok", h.telegramOwner(id));
    expect(reply.text).toBe(
      'Allowed: Click "Place order" on shop.example.com. Muse will continue.',
    );
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(1));
    const ctx = h.finalizeInboundContext.mock.calls[0]?.[0];
    expect(ctx).toMatchObject({
      Body: approvedText('Click "Place order" on shop.example.com'),
      SessionKey: SESSION,
      Provider: "telegram",
      Surface: "telegram",
      OriginatingChannel: "telegram",
      From: `telegram:${OWNER_TG}`,
      To: `telegram:${OWNER_TG}`,
      OriginatingTo: `telegram:${OWNER_TG}`,
      ChatType: "direct",
      CommandAuthorized: false,
    });
    expect(String(ctx?.MessageSid)).toMatch(/^muse-sentinel-[0-9a-f-]{36}$/);
    expect(String(ctx?.Body)).not.toContain(code);
    expect(String(ctx?.Body)).not.toContain(id);
    await vi.waitFor(() =>
      expect(h.sendMessageTelegram).toHaveBeenCalledWith(
        `telegram:${OWNER_TG}`,
        "Done, continuing.",
        expect.objectContaining({}),
      ),
    );

    // The page re-rendered: same button, new ref. Allowed exactly once, without the guard.
    h.snapshot(CHECKOUT_SNAPSHOT_RENUMBERED);
    const judgeCalls = h.judge.mock.calls.length;
    const retry = await h.click("e18");
    // Pinned to the tab it was judged against, so the browser cannot run it on another one.
    expect(retry).toEqual({
      params: { action: "act", request: { kind: "click", ref: "e18", targetId: "TAB1" } },
    });
    expect(h.judge.mock.calls.length).toBe(judgeCalls);

    const again = await h.click("e18");
    expect(again?.block).toBe(true);
    expect(again?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram.mock.calls.filter((c) => c[2]?.buttons)).toHaveLength(2);
  });

  it("accepts /ok from the WhatsApp owner and resumes on WhatsApp", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();
    const reply = await h.command("ok", {
      channel: "whatsapp",
      senderId: "+420 123 456 789",
      from: OWNER_WA,
      to: OWNER_WA,
      args: ` ${code} `,
    });
    expect(reply.text).toContain("Allowed:");
    await vi.waitFor(() =>
      expect(h.sendMessageWhatsApp).toHaveBeenCalledWith(OWNER_WA, "Done, continuing.", {
        verbose: false,
        accountId: undefined,
      }),
    );
    expect(h.finalizeInboundContext.mock.calls[0]?.[0]).toMatchObject({
      Provider: "whatsapp",
      From: OWNER_WA,
      OriginatingTo: OWNER_WA,
    });
  });

  it("rejects /ok from non-owners, groups and webchat and keeps the request pending", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();
    const id = h.lastId();
    const attempts: Array<Partial<CommandCtx>> = [
      { channel: "telegram", senderId: "555", from: "telegram:555", args: id },
      { channel: "telegram", senderId: OWNER_TG, from: "telegram:group:-100123", args: id },
      { channel: "webchat", senderId: "openclaw-control-ui", args: code },
      { channel: "webchat", senderId: OWNER_TG, from: `telegram:${OWNER_TG}`, args: id },
      { channel: "whatsapp", senderId: "+15550001111", from: "+15550001111", args: code },
      { channel: "whatsapp", senderId: OWNER_WA, from: "120363000000000000@g.us", args: code },
    ];
    for (const ctx of attempts) {
      expect((await h.command("ok", ctx)).text).toBe(NOT_OWNER_TEXT);
    }
    expect(h.dispatchReply).not.toHaveBeenCalled();
    expect((await h.click("e8"))?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram).toHaveBeenCalledTimes(1);
  });

  it("answers unknown keys and a missing key", async () => {
    const h = createHarness();
    const unknownId = "0b8f8a1e-4c1d-4f6e-9a57-2f1c3d4e5f60";
    expect((await h.command("ok", h.telegramOwner(unknownId))).text).toBe(NOT_WAITING_TEXT);
    expect((await h.command("ok", h.whatsappOwner("000000"))).text).toBe(NOT_WAITING_TEXT);
    expect((await h.command("no", h.telegramOwner(""))).text).toBe(TELEGRAM_TAP_TEXT);
    expect((await h.command("no", h.whatsappOwner(""))).text).toBe(
      "Send /no with the 6-digit code from the approval message.",
    );
  });

  it("takes only button taps on Telegram and only typed codes on WhatsApp", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();
    const id = h.lastId();
    // A code the model saw in a quoted WhatsApp prompt, put into a Telegram button it sent.
    expect((await h.command("ok", h.telegramOwner(code))).text).toBe(TELEGRAM_TAP_TEXT);
    expect((await h.command("ok", h.whatsappOwner(id))).text).toBe(
      "Send /ok with the 6-digit code from the approval message.",
    );
    expect(h.dispatchReply).not.toHaveBeenCalled();
    expect((await h.click("e8"))?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram).toHaveBeenCalledTimes(1);
    expect((await h.command("ok", h.whatsappOwner(code))).text).toContain("Allowed:");
  });

  it("counts a code only in a chat the request was sent to", async () => {
    // Asked while only Telegram was set up; WhatsApp was added before the owner answered.
    const first = createHarness({
      pluginConfig: { ...PLUGIN_CONFIG, owners: { telegram: [OWNER_TG], whatsapp: [] } },
    });
    first.snapshot(CHECKOUT_SNAPSHOT);
    await first.click("e8");
    expect(first.sendMessageWhatsApp).not.toHaveBeenCalled();
    const saved = JSON.parse(
      fs.readFileSync(path.join(first.stateDir, "muse-sentinel", "state.json"), "utf8"),
    ) as { entries: Array<{ code: string; notifiedVia?: string[] }> };
    const entry = saved.entries[0];
    expect(entry?.notifiedVia).toEqual(["telegram"]);
    const second = createHarness({ stateDir: first.stateDir });
    expect((await second.command("ok", second.whatsappOwner(entry?.code ?? ""))).text).toBe(
      NOT_WAITING_TEXT,
    );
    expect((await second.command("ok", second.telegramOwner(first.lastId()))).text).toContain(
      "Allowed:",
    );
  });

  it("/no denies, resumes with the denial and blocks every retry", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const id = h.lastId();
    expect((await h.command("no", h.telegramOwner(id))).text).toBe("Okay, Muse will not do that.");
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(1));
    expect(h.finalizeInboundContext.mock.calls[0]?.[0].Body).toBe(
      deniedText('Click "Place order" on shop.example.com'),
    );
    // The request is decided; its buttons do nothing now.
    expect((await h.command("ok", h.telegramOwner(id))).text).toBe(NOT_WAITING_TEXT);
    h.snapshot(CHECKOUT_SNAPSHOT_RENUMBERED);
    expect(await h.click("e18")).toEqual({ block: true, blockReason: DENIED_BLOCK_REASON });
    expect(await h.click("e18")).toEqual({ block: true, blockReason: DENIED_BLOCK_REASON });
    expect(h.sendMessageTelegram.mock.calls.filter((c) => c[2]?.buttons)).toHaveLength(1);
  });

  it("/no takes back an approval Muse has not used yet; after use it is too late", async () => {
    const h = createHarness();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const id = h.lastId();
    await h.command("ok", h.telegramOwner(id));
    // The owner changes their mind (taps "Don't" on the same prompt) before the retry.
    expect((await h.command("no", h.telegramOwner(id))).text).toBe("Okay, Muse will not do that.");
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(2));
    expect(h.finalizeInboundContext.mock.calls[1]?.[0].Body).toBe(
      deniedText('Click "Place order" on shop.example.com'),
    );
    expect(await h.click("e8")).toEqual({ block: true, blockReason: DENIED_BLOCK_REASON });

    // A second action, approved and used: a later /no cannot undo it.
    h.snapshot(buttonsSnapshot([["button", "Subscribe"]]), "TAB1", "https://news.example.com/");
    await h.click("e1");
    const second = h.lastId();
    await h.command("ok", h.telegramOwner(second));
    expect((await h.click("e1"))?.block).toBeUndefined();
    expect((await h.command("no", h.telegramOwner(second))).text).toBe(ALREADY_USED_TEXT);
  });

  it("asks before editing, deleting or pinning a message, even in the owner's chat", async () => {
    const h = createHarness();
    // The approval prompt's message id is easy to guess; editing it keeps its buttons.
    const edit = {
      action: "edit",
      messageId: 813,
      message: "**Muse wants to:** Click Next page on news.example.com",
    };
    for (const params of [
      edit,
      { ...edit, channel: "telegram", chatId: OWNER_TG },
      { ...edit, channel: "telegram", target: `telegram:${OWNER_TG}` },
      { action: "delete", messageId: 813 },
      { action: "unsend", messageId: 813 },
      { action: "pin", messageId: 813, channel: "telegram", target: OWNER_TG },
      { action: "unpin", messageId: 813 },
    ]) {
      const result = await h.call("message", params);
      expect(result?.block).toBe(true);
      expect(result?.blockReason).toContain("needs the owner's approval");
    }
    expect(h.sendMessageTelegram.mock.calls[0]?.[1]).toContain(
      'Edit a chat message in the current chat to "**Muse wants to:** Click Next page on news.example.com"',
    );
    // Reacting in the owner's chat changes nothing the owner relies on.
    const react = { action: "react", messageId: 813, emoji: "👍" };
    expect(await h.call("message", react)).toEqual({ params: react });
    // Money mode only asks about money, but still about edits.
    const money = createHarness({ pluginConfig: { ...PLUGIN_CONFIG, mode: "money" } });
    expect((await money.call("message", edit))?.block).toBe(true);
    const plain = { action: "send", target: "+15550001111", message: "See you at 5" };
    expect(await money.call("message", plain)).toEqual({ params: plain });
  });

  it("binds a message approval to the attached file's contents, not just its path", async () => {
    const h = createHarness();
    const file = path.join(h.stateDir, "workspace", "photo.jpg");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "holiday photo");
    const send = {
      action: "send",
      channel: "whatsapp",
      target: "+15550001111",
      media: file,
    };
    expect((await h.call("message", send))?.block).toBe(true);
    await h.command("ok", h.telegramOwner(h.lastId()));

    // The file is swapped after the approval: the retry needs a new one.
    fs.writeFileSync(file, "screenshot of the bank account");
    const swapped = await h.call("message", send);
    expect(swapped?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram.mock.calls.filter((c) => c[2]?.buttons)).toHaveLength(2);
    // The approved bytes are back: the first approval is used, once, with the original params.
    fs.writeFileSync(file, "holiday photo");
    expect(await h.call("message", send)).toEqual({ params: send });
    expect((await h.call("message", send))?.block).toBe(true);
    // A digest the model passes in itself is ignored.
    const forged = await h.call("message", { ...send, mediaSha256: { [file]: "sha256:00" } });
    expect(forged?.block).toBe(true);
  });

  it("splits a long resumed reply into several messages", async () => {
    const h = createHarness();
    const long = "word ".repeat(1000).trim();
    h.dispatchReply.mockImplementationOnce(async (params: DispatchParams) => {
      await params.dispatcherOptions.deliver({ text: long }, { kind: "final" });
      return { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
    });
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const prompts = h.sendMessageTelegram.mock.calls.length;
    await h.command("ok", h.telegramOwner(h.lastId()));
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(h.sendMessageTelegram.mock.calls.length).toBeGreaterThanOrEqual(prompts + 2),
    );
    const sent = h.sendMessageTelegram.mock.calls.slice(prompts);
    expect(sent.every(([to, text]) => to === `telegram:${OWNER_TG}` && text.length <= 4000)).toBe(
      true,
    );
    expect(sent.map(([, text]) => text).join("")).toBe(long);
    expect(h.resolveTextChunkLimit).toHaveBeenCalledWith({}, "telegram", undefined);
  });

  it("blocks browser use while paused, keeps looking allowed, and nudges the agent on /resume", async () => {
    const h = createHarness();
    h.snapshot(buttonsSnapshot([["link", "Home"]]), "TAB1", "https://news.example.com/");
    expect((await h.command("pause", h.telegramOwner(""))).text).toContain("Paused");
    expect(await h.click("e1")).toEqual({ block: true, blockReason: PAUSED_BLOCK_REASON });
    expect(
      await h.call("browser", { action: "navigate", targetUrl: "https://example.com" }),
    ).toEqual({ block: true, blockReason: PAUSED_BLOCK_REASON });
    const look = { action: "snapshot" };
    expect(await h.call("browser", look)).toEqual({ params: look });
    expect(await h.call("read", { path: "a.md" })).toEqual({ params: { path: "a.md" } });

    expect((await h.command("resume", h.telegramOwner(""))).text).toContain("Resumed");
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(1));
    expect(h.finalizeInboundContext.mock.calls[0]?.[0].Body).toBe(GIVE_BACK_TEXT);
    // The owner may have changed the tabs: nothing is judged until a new snapshot.
    expect(await h.click("e1")).toEqual({ block: true, blockReason: NO_SNAPSHOT_REASON });
    h.snapshot(buttonsSnapshot([["link", "Home"]]), "TAB1", "https://news.example.com/");
    expect(await h.click("e1")).toEqual({
      params: { action: "act", request: { kind: "click", ref: "e1", targetId: "TAB1" } },
    });
    // Resuming when not paused does not wake the agent again.
    await h.command("resume", h.telegramOwner(""));
    expect(h.dispatchReply).toHaveBeenCalledTimes(1);
    // Strangers cannot pause.
    expect((await h.command("pause", { channel: "webchat", senderId: "x" })).text).toBe(
      NOT_OWNER_TEXT,
    );
  });

  it("lets the guard model allow a harmless unclear click", async () => {
    const h = createHarness();
    h.judge.mockResolvedValueOnce({ decision: "allow", reason: "navigation", summary: "x" });
    h.snapshot(buttonsSnapshot([["button", "Show 20 more results on this page"]]));
    expect(await h.click("e1")).toEqual({
      params: { action: "act", request: { kind: "click", ref: "e1", targetId: "TAB1" } },
    });
    expect(h.sendMessageTelegram).not.toHaveBeenCalled();
  });

  it("asks the owner when the guard throws", async () => {
    const h = createHarness();
    h.judge.mockRejectedValueOnce(new Error("guard exploded"));
    h.snapshot(CHECKOUT_SNAPSHOT);
    const result = await h.click("e8");
    expect(result?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("guard model failed"));
  });

  it("fails closed on an internal error", async () => {
    const h = createHarness();
    h.resolveStateDir.mockImplementation(() => {
      throw new Error("disk gone");
    });
    h.snapshot(CHECKOUT_SNAPSHOT);
    expect(await h.click("e8")).toEqual({ block: true, blockReason: ERROR_BLOCK_REASON });
    expect(await h.call("browser", { action: "navigate", targetUrl: "https://a.example" })).toEqual(
      { block: true, blockReason: ERROR_BLOCK_REASON },
    );
    expect(h.logger.error).toHaveBeenCalled();
  });

  it("stays blocked when the owner notification fails", async () => {
    const h = createHarness();
    h.sendMessageTelegram.mockRejectedValueOnce(new Error("telegram down"));
    h.sendMessageWhatsApp.mockRejectedValueOnce(new Error("No active WhatsApp Web listener"));
    h.snapshot(CHECKOUT_SNAPSHOT);
    expect((await h.click("e8"))?.blockReason).toContain("needs the owner's approval");
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("on Telegram"));
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("on WhatsApp"));
  });

  it("allows messages to the owner and asks before messaging anyone else", async () => {
    const h = createHarness();
    const toOwner = { action: "send", channel: "telegram", target: OWNER_TG, message: "Done" };
    expect(await h.call("message", toOwner)).toEqual({ params: toOwner });
    const result = await h.call("message", {
      action: "send",
      channel: "whatsapp",
      target: "+15550001111",
      message: "Hello from Muse",
    });
    expect(result?.blockReason).toContain(
      'Send a WhatsApp message to +15550001111: "Hello from Muse"',
    );
    expect(h.judge).not.toHaveBeenCalled();
  });

  it("classifies an act against the tab the browser will use, not an ignored top-level targetId", async () => {
    const h = createHarness();
    h.snapshot(buttonsSnapshot([["link", "Home"]]), "TAB_A", "https://news.example.com/");
    h.snapshot(buttonsSnapshot([["button", "Buy now"]]), "TAB_B", "https://shop.example.com/");
    // The browser's current tab is TAB_B; the top-level targetId is not used by act.
    const sneaky = await h.call("browser", {
      action: "act",
      targetId: "TAB_A",
      request: { kind: "click", ref: "e1" },
    });
    expect(sneaky?.block).toBe(true);
    expect(h.judge.mock.calls.at(-1)?.[0].element?.name).toBe("Buy now");
    // Naming the tab in the request is honoured, but e1 is a different element on TAB_B: if the
    // browser fell back to that tab the click would land on "Buy now", so the guard decides.
    h.judge.mockResolvedValueOnce({ decision: "allow", reason: "navigation", summary: "x" });
    expect(await h.click("e1", { targetId: "TAB_A" })).toEqual({
      params: { action: "act", request: { kind: "click", ref: "e1", targetId: "TAB_A" } },
    });
    expect(h.judge.mock.calls.at(-1)?.[0].element?.name).toBe("Home");
    expect(h.judge.mock.calls.at(-1)?.[0].detail).toContain("different element on another");
    // After closing the current tab the browser picks some other tab: nothing is judged until a
    // new snapshot shows which one.
    h.after({
      toolName: "browser",
      params: { action: "close" },
      result: { content: [], details: { ok: true } },
    });
    expect(await h.click("e1")).toEqual({ block: true, blockReason: NO_SNAPSHOT_REASON });
  });
});

describe("after_tool_call", () => {
  it("ignores the truncated second emit (durationMs) and failed snapshots", async () => {
    const h = createHarness();
    h.after({
      toolName: "browser",
      params: { action: "snapshot" },
      result: {
        content: [{ type: "text", text: buttonsSnapshot([["link", "Home"]]) }],
        details: { ok: true, targetId: "TAB1", url: "https://example.com/" },
      },
      durationMs: 12,
    });
    h.after({ toolName: "browser", params: { action: "snapshot" }, error: "tab not found" });
    h.openTabs.add("TAB1");
    expect(await h.click("e1", { targetId: "TAB1" })).toEqual({
      block: true,
      blockReason: NO_SNAPSHOT_REASON,
    });
    expect(h.judge).not.toHaveBeenCalled();
  });

  it("keeps the page URL from navigate results, and wants a new snapshot after navigating", async () => {
    const h = createHarness();
    h.snapshot(buttonsSnapshot([["button", "Pay now"]]), "TAB1", "https://shop.example.com/cart");
    h.after({
      toolName: "browser",
      params: { action: "navigate", targetUrl: "https://pay.example.com/step2" },
      result: {
        content: [],
        details: { ok: true, targetId: "TAB1", url: "https://pay.example.com/step2" },
      },
    });
    // The old snapshot shows the old page.
    expect(await h.click("e1")).toEqual({ block: true, blockReason: STALE_SNAPSHOT_REASON });
    // A snapshot result without a URL of its own keeps the one navigate reported.
    h.after({
      toolName: "browser",
      params: { action: "snapshot" },
      result: {
        content: [{ type: "text", text: buttonsSnapshot([["button", "Pay now"]]) }],
        details: { ok: true, targetId: "TAB1" },
      },
    });
    const result = await h.click("e1");
    expect(result?.blockReason).toContain('Click "Pay now" on pay.example.com');
  });
});

describe("HTTP routes", () => {
  it("serves state without codes, decides by id and wakes the agent on the owner's last chat", async () => {
    const h = createHarness();
    const request = await h.server();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();

    const state = await request("GET", "state");
    expect(state.status).toBe(200);
    expect(state.text).not.toContain(code);
    expect(state.json).toMatchObject({ paused: false, mode: "outbound", recent: [] });
    const pending = state.json.pending as Array<Record<string, unknown>>;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      summary: 'Click "Place order" on shop.example.com',
      tool: "browser",
      url: CHECKOUT_URL,
    });
    expect(Object.keys(pending[0] ?? {}).toSorted()).toEqual(
      ["createdAt", "detail", "expiresAt", "id", "summary", "tool", "url"].toSorted(),
    );
    const id = String(pending[0]?.id);

    fs.mkdirSync(path.dirname(h.sessionStorePath), { recursive: true });
    fs.writeFileSync(
      h.sessionStorePath,
      JSON.stringify({ [SESSION]: { lastChannel: "telegram", lastTo: `telegram:${OWNER_TG}` } }),
    );
    const decided = await request("POST", "decide", JSON.stringify({ id, decision: "approve" }));
    expect(decided).toMatchObject({ status: 200, json: { ok: true, status: "approved" } });
    await vi.waitFor(() => expect(h.dispatchReply).toHaveBeenCalledTimes(1));
    expect(h.finalizeInboundContext.mock.calls[0]?.[0]).toMatchObject({
      Provider: "telegram",
      To: `telegram:${OWNER_TG}`,
      Body: approvedText('Click "Place order" on shop.example.com'),
    });

    const again = await request("POST", "decide", JSON.stringify({ id, decision: "approve" }));
    expect(again).toMatchObject({ status: 409, json: { ok: false, status: "approved" } });
    const after = await request("GET", "state");
    expect(after.json.pending).toEqual([]);
    expect(after.json.recent).toEqual([
      expect.objectContaining({ id, status: "approved", decidedVia: "web" }),
    ]);
    // The approval works for the agent's retry.
    expect((await h.click("e8"))?.block).toBeUndefined();
  });

  it("rejects bad requests with the right status codes", async () => {
    const h = createHarness();
    const request = await h.server();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const code = h.lastCode();

    expect(await request("POST", "state", "{}")).toMatchObject({ status: 405, allow: "GET" });
    expect(await request("GET", "decide")).toMatchObject({ status: 405, allow: "POST" });
    expect(await request("GET", "pause")).toMatchObject({ status: 405 });
    expect(await request("POST", "health", "{}")).toMatchObject({ status: 405 });
    expect((await request("POST", "decide", "{not json")).status).toBe(400);
    expect((await request("POST", "decide", "[]")).status).toBe(400);
    expect((await request("POST", "decide", JSON.stringify({ id: "x" }))).status).toBe(400);
    expect(
      (
        await request(
          "POST",
          "decide",
          JSON.stringify({ id: "x", decision: "approve", resume: "sms" }),
        )
      ).status,
    ).toBe(400);
    expect(
      await request("POST", "decide", JSON.stringify({ id: "nope", decision: "approve" })),
    ).toMatchObject({ status: 404, json: { ok: false, error: "not_found" } });
    // Codes are for chat replies only, never accepted as ids over HTTP.
    expect(
      (await request("POST", "decide", JSON.stringify({ id: code, decision: "approve" }))).status,
    ).toBe(404);
    // Too large: answered with 413 or, like the gateway's own body reader, by closing the socket.
    const tooLarge = await request("POST", "decide", "x".repeat(20_000)).catch(() => undefined);
    expect([undefined, 413]).toContain(tooLarge?.status);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("denies without resuming when asked, pauses, resumes and reports health", async () => {
    const h = createHarness();
    const request = await h.server();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const id = String(
      ((await request("GET", "state")).json.pending as Array<{ id: string }>)[0]?.id,
    );

    expect(await request("GET", "health")).toMatchObject({
      status: 200,
      json: { ok: true, mode: "outbound", guardModel: "claude-haiku-5-5", pending: 1 },
    });
    const denied = await request(
      "POST",
      "decide",
      JSON.stringify({ id, decision: "deny", resume: "none" }),
    );
    expect(denied).toMatchObject({ status: 200, json: { ok: true, status: "denied" } });
    expect((await h.click("e8"))?.blockReason).toBe(DENIED_BLOCK_REASON);

    expect(await request("POST", "pause", "{}")).toMatchObject({
      status: 200,
      json: { paused: true },
    });
    expect((await request("GET", "state")).json.paused).toBe(true);
    expect(await h.click("e3")).toEqual({ block: true, blockReason: PAUSED_BLOCK_REASON });
    expect(await request("POST", "resume", "{}")).toMatchObject({
      status: 200,
      json: { paused: false },
    });
    // Given back: the owner may have changed the tabs, so a new snapshot is needed first.
    expect(await h.click("e3")).toEqual({ block: true, blockReason: NO_SNAPSHOT_REASON });
    expect((await request("GET", "health")).json.pending).toBe(0);
    expect(h.dispatchReply).not.toHaveBeenCalled();
  });

  it("does not resume when the session's last chat is not an owner's", async () => {
    const h = createHarness();
    const request = await h.server();
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const id = String(
      ((await request("GET", "state")).json.pending as Array<{ id: string }>)[0]?.id,
    );
    fs.mkdirSync(path.dirname(h.sessionStorePath), { recursive: true });
    fs.writeFileSync(
      h.sessionStorePath,
      JSON.stringify({ [SESSION]: { lastChannel: "telegram", lastTo: "telegram:555" } }),
    );
    expect(
      (await request("POST", "decide", JSON.stringify({ id, decision: "approve" }))).status,
    ).toBe(200);
    expect(h.dispatchReply).not.toHaveBeenCalled();
  });
});

describe("service", () => {
  it("warns loudly about unsafe config and stays quiet about a safe one", async () => {
    const h = createHarness();
    await h.startService({ tools: { deny: ["browser"] } });
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining("UNSAFE CONFIG"));
    const message = String(h.logger.error.mock.calls[0]?.[0]);
    expect(message).toContain('"exec"');
    expect(message).toContain("workspaceOnly");

    const safe = createHarness();
    await safe.startService({
      tools: { deny: ["group:runtime", "gateway", "cron"], fs: { workspaceOnly: true } },
    });
    expect(safe.logger.error).not.toHaveBeenCalled();
  });

  it("expires old requests on a timer and stops the timer", async () => {
    let now = Date.parse("2026-10-17T10:00:00Z");
    const h = createHarness({ deps: { now: () => now, expiryIntervalMs: 60_000 } });
    h.snapshot(CHECKOUT_SNAPSHOT);
    await h.click("e8");
    const readStatus = () =>
      (
        JSON.parse(
          fs.readFileSync(path.join(h.stateDir, "muse-sentinel", "state.json"), "utf8"),
        ) as {
          entries: Array<{ status: string }>;
        }
      ).entries[0]?.status;
    expect(readStatus()).toBe("pending");

    vi.useFakeTimers();
    await h.startService({
      tools: { deny: ["exec", "process", "gateway"], fs: { workspaceOnly: true } },
    });
    now += 31 * 60_000;
    vi.advanceTimersByTime(60_000);
    expect(readStatus()).toBe("expired");
    expect((await h.command("ok", h.telegramOwner(h.lastId()))).text).toBe(NOT_WAITING_TEXT);
    expect((await h.command("ok", h.whatsappOwner(h.lastCode()))).text).toBe(NOT_WAITING_TEXT);

    await h.services[0]?.stop?.({});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shared state", () => {
  it("survives a second registration in the same process", async () => {
    const first = createHarness();
    first.snapshot(CHECKOUT_SNAPSHOT);
    await first.click("e8");
    const id = first.lastId();
    const second = createHarness({ stateDir: first.stateDir });
    expect((await second.command("ok", second.telegramOwner(id))).text).toContain("Allowed:");
    // The snapshot remembered by the first registration still resolves refs.
    second.openTabs.add("TAB1");
    expect((await second.click("e8"))?.block).toBeUndefined();
  });
});

describe("browser tab integrity", () => {
  const actOn = (request: Record<string, unknown>) => ({ action: "act", request });
  const ok = (params: Record<string, unknown>, details: Record<string, unknown>) => ({
    toolName: "browser",
    params,
    result: { content: [], details: { ok: true, ...details } },
  });

  it("never judges a click against a closed tab's snapshot (the browser would use another tab)", async () => {
    const h = createHarness();
    const links = Array.from({ length: 45 }, (_, i): [string, string] => ["link", `Article ${i}`]);
    h.snapshot(buttonsSnapshot(links), "XTAB", "https://en.wikipedia.org/wiki/Cat");
    const shop = Array.from({ length: 45 }, (_, i): [string, string] =>
      i === 41 ? ["button", "Place order"] : ["generic", ""],
    );
    h.snapshot(buttonsSnapshot(shop), "YTAB", "https://shop.example.com/checkout");
    expect((await h.click("e42", { targetId: "YTAB" }))?.blockReason).toContain("Place order");

    // The agent closes X; the sentinel forgets it.
    expect(await h.call("browser", { action: "close", targetId: "XTAB" })).toBeDefined();
    h.openTabs.delete("XTAB");
    h.after(ok({ action: "close", targetId: "XTAB" }, {}));
    expect(await h.click("e42", { targetId: "XTAB" })).toEqual({
      block: true,
      blockReason: NO_SNAPSHOT_REASON,
    });

    // A tab closed behind the sentinel's back (the owner, or window.close()) is caught live.
    h.snapshot(buttonsSnapshot(links), "ZTAB", "https://en.wikipedia.org/wiki/Dog");
    h.openTabs.delete("ZTAB");
    expect(await h.click("e1", { targetId: "ZTAB" })).toEqual({
      block: true,
      blockReason: TAB_CLOSED_REASON,
    });
    // An id prefix the browser would resolve to a different tab is refused too.
    h.openTabs.add("ZTAB-other");
    expect(await h.click("e1", { targetId: "ZTAB" })).toEqual({
      block: true,
      blockReason: TAB_CLOSED_REASON,
    });
  });

  it("fails closed when the open tabs cannot be listed", async () => {
    const h = createHarness({
      deps: {
        openPageIds: async () => {
          throw new Error("CDP down");
        },
      },
    });
    h.snapshot(buttonsSnapshot([["link", "Home"]]));
    expect(await h.click("e1")).toEqual({ block: true, blockReason: TAB_CHECK_FAILED_REASON });
    // Calls that do not depend on a tab are not held up.
    const look = { action: "snapshot" };
    expect(await h.call("browser", look)).toEqual({ params: look });
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining("CDP down"));
  });

  it("asks again when the form changed after an approval", async () => {
    const h = createHarness();
    const form = (to: string) =>
      buttonsSnapshot([
        ["textbox", `To: ${to}`],
        ["textbox", "Message: hi"],
        ["button", "Send"],
      ]);
    h.snapshot(form("alice@example.com"), "MAIL", "https://mail.example.com/compose?draft=1");
    expect((await h.click("e3"))?.blockReason).toContain('Click "Send"');
    expect((await h.command("ok", h.telegramOwner(h.lastId()))).text).toContain("Allowed:");

    // The agent changes the recipient (allowed), then clicks Send with the old snapshot.
    const fill = actOn({ kind: "fill", fields: [{ ref: "e1", type: "textbox", value: "x" }] });
    expect(await h.call("browser", fill)).toEqual({
      params: actOn({ ...fill.request, targetId: "MAIL" }),
    });
    h.after(ok(fill, { targetId: "MAIL" }));
    expect(await h.click("e3")).toEqual({ block: true, blockReason: STALE_SNAPSHOT_REASON });
    // With a new snapshot the click is a new request; the old approval does not cover it.
    h.snapshot(form("mallory@evil.test"), "MAIL", "https://mail.example.com/compose?draft=1");
    const again = await h.click("e3");
    expect(again?.blockReason).toContain("needs the owner's approval");
    expect(h.sendMessageTelegram.mock.calls.filter((c) => c[2]?.buttons)).toHaveLength(2);
    expect(String(h.sendMessageTelegram.mock.calls.at(-1)?.[1])).toContain("mallory@evil.test");
  });

  it("binds Enter to the focused field and its text, and wants a snapshot after typing", async () => {
    const h = createHarness();
    const chat = (text: string) =>
      wrapSnapshot(
        [
          '- searchbox "Search chats" [ref=e2]',
          `- textbox "Type a message" [active] [ref=e4]: ${text}`,
        ].join("\n"),
      );
    h.snapshot(chat("hello"), "CHAT", "https://web.whatsapp.com/");
    // The ref is ignored for press: the guard sees the focused composer and its text.
    await h.call("browser", actOn({ kind: "press", key: "Enter", ref: "e2" }));
    expect(h.judge.mock.calls.at(-1)?.[0].element).toMatchObject({
      role: "textbox",
      name: "Type a message",
    });
    expect(h.judge.mock.calls.at(-1)?.[0].element?.line).toContain("hello");
    expect((await h.command("ok", h.telegramOwner(h.lastId()))).text).toContain("Allowed:");

    // New text typed after the approval: Enter needs a new snapshot and a new approval.
    const type = actOn({ kind: "type", ref: "e4", text: "my bank PIN is 1234" });
    expect(await h.call("browser", type)).toEqual({
      params: actOn({ ...type.request, targetId: "CHAT" }),
    });
    h.after(ok(type, { targetId: "CHAT" }));
    expect(await h.call("browser", actOn({ kind: "press", key: "Enter" }))).toEqual({
      block: true,
      blockReason: STALE_SNAPSHOT_REASON,
    });
    h.snapshot(chat("my bank PIN is 1234"), "CHAT", "https://web.whatsapp.com/");
    const again = await h.call("browser", actOn({ kind: "press", key: "Enter" }));
    expect(again?.blockReason).toContain("needs the owner's approval");
    expect(h.judge.mock.calls.at(-1)?.[0].element?.line).toContain("my bank PIN is 1234");
  });

  it("checks uploads against the tab the browser will use", async () => {
    const h = createHarness();
    h.snapshot(buttonsSnapshot([["button", "Choose file"]]), "EVIL", "https://evil.example.net/up");
    h.snapshot(
      buttonsSnapshot([["button", "Choose file"]]),
      "GOOD",
      "https://bank.example.com/docs",
    );
    h.after(ok({ action: "focus", targetId: "EVIL" }, {}));
    await h.call("browser", { action: "upload", paths: ["/tmp/uploads/passport.pdf"], ref: "e1" });
    expect(String(h.sendMessageTelegram.mock.calls.at(-1)?.[1])).toContain("evil.example.net");
    expect(String(h.sendMessageTelegram.mock.calls.at(-1)?.[1])).not.toContain("bank.example.com");
  });
});
