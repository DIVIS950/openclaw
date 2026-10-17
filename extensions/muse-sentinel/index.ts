// Muse Sentinel: asks the owner on their phone before the agent does anything that leaves the
// machine (sending, posting, submitting forms, booking, buying, deleting).
// This file wires the pure modules in src/ to OpenClaw's plugin API. It imports only types from
// OpenClaw, so tests drive it with a mock api and never load the gateway.
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { classify } from "./src/classify.js";
import { judge as guardJudge, type GuardOptions, type GuardVerdict } from "./src/guard.js";
import { cdpUrlForProfile, fetchOpenPageIds } from "./src/live-tabs.js";
import { withMediaDigests } from "./src/message.js";
import { approvalKeyFromArgs, notifyChannels, notifyOwner } from "./src/notify.js";
import {
  approvedText,
  DEFAULT_SESSION_KEY,
  deniedText,
  GIVE_BACK_TEXT,
  isOwnerAddress,
  readLastRoute,
  resumeInBackground,
  type ResumeTarget,
} from "./src/resume.js";
import { createRoutes, type ResumeMode } from "./src/routes.js";
import { captureSnapshotFromToolResult, resolveTabId, SnapshotCache } from "./src/snapshot.js";
import { ApprovalStore, resolveStoreDir } from "./src/store.js";
import {
  browserEffect,
  navigatedTab,
  nextCurrentTab,
  paramsForClassification,
  pinToTab,
  tabToVerify,
} from "./src/tabs.js";
import { readString } from "./src/text.js";
import type { ActionDescriptor, PendingEntry, SentinelConfig } from "./src/types.js";
import { normalizeWhatsAppNumber, resolveSentinelConfig } from "./src/types.js";

const PLUGIN_ID = "muse-sentinel";

// Everything the model can read. None of these ever contains an approval code.
export const ERROR_BLOCK_REASON = "Muse Sentinel error; blocked for safety.";
export const PAUSED_BLOCK_REASON =
  "BLOCKED: the owner has taken over the cloud browser. Do not use the browser until they give it back. Tell them you will wait.";
export const DENIED_BLOCK_REASON =
  "BLOCKED: the owner said no to this. Do not try it again or another way.";
export const TAB_CLOSED_REASON =
  "BLOCKED by Muse Sentinel: that tab is not open any more. Take a new snapshot of the tab you want to use, then retry.";
export const TAB_CHECK_FAILED_REASON =
  "BLOCKED by Muse Sentinel: could not check which browser tabs are open. Try again in a moment.";
export function approvalBlockReason(summary: string): string {
  return `BLOCKED by Muse Sentinel: this needs the owner's approval: ${summary}. The owner has been asked on their phone. Do not retry this action and do not try another way to do it. Tell the owner in one short sentence what you are waiting for, then stop. If they approve, you will be told to continue.`;
}

// Command replies (on webchat these are written to the transcript, so they never hold codes).
export const NOT_OWNER_TEXT =
  "Approvals only work from the owner's WhatsApp or Telegram, the desktop page, or Pineapple.";
export const NOT_WAITING_TEXT = "That code is not waiting for approval (it may have expired).";
export const TELEGRAM_TAP_TEXT =
  "On Telegram, tap Allow or Don't on the approval message (typed codes only work on WhatsApp).";
export const ALREADY_USED_TEXT = "Too late: Muse already did that.";
const SAVE_FAILED_TEXT = "Muse Sentinel could not save that. Please try again.";

/** Browser actions that still run while the owner has taken over the browser. */
const PAUSE_ALLOWED_BROWSER_ACTIONS: ReadonlySet<string> = new Set([
  "status",
  "tabs",
  "snapshot",
  "screenshot",
  "profiles",
]);

type CommandDefinition = Parameters<OpenClawPluginApi["registerCommand"]>[0];
type CommandContext = Parameters<CommandDefinition["handler"]>[0];
type ToolCallResult = { block: true; blockReason: string } | { params: Record<string, unknown> };

/** Injectable for tests; the plugin uses the defaults. */
export type SentinelDeps = {
  judge: (action: ActionDescriptor, opts: GuardOptions) => Promise<GuardVerdict>;
  now: () => number;
  /** How long a blocked tool call waits for the owner notification to go out. */
  notifyTimeoutMs: number;
  /** How often expired requests are swept. */
  expiryIntervalMs: number;
  /**
   * Ids of the open page tabs of a browser profile (default: CDP /json/list of the profile's
   * cdpUrl in the gateway config). Throws when they cannot be listed.
   */
  openPageIds?: (profile: string | undefined) => Promise<string[]>;
};

const DEFAULT_DEPS: SentinelDeps = {
  judge: guardJudge,
  now: Date.now,
  notifyTimeoutMs: 8_000,
  expiryIntervalMs: 60_000,
};

/** Process-wide state. register() can run more than once per process (config reloads). */
type SharedState = {
  snapshots: SnapshotCache;
  store?: ApprovalStore;
  storeDir?: string;
  /** The tab the browser acts on when a call names none; undefined when not known. */
  currentTab?: string;
  /** Session of the latest tool call, for nudging the agent after the browser is given back. */
  lastSessionKey?: string;
  expiryTimer?: ReturnType<typeof setInterval>;
};

const STATE_KEY = Symbol.for("muse-sentinel");

function sharedState(): SharedState {
  const holder = globalThis as unknown as Record<symbol, SharedState | undefined>;
  let state = holder[STATE_KEY];
  if (!state) {
    state = { snapshots: new SnapshotCache() };
    holder[STATE_KEY] = state;
  }
  return state;
}

function isOwnBlock(error: string): boolean {
  return error.startsWith("BLOCKED") || error === ERROR_BLOCK_REASON;
}

function browserAction(params: Record<string, unknown>): string {
  return (readString(params.action) ?? "").trim().toLowerCase();
}

/** Resolves after `promise` settles or after `ms`, whichever comes first. */
async function waitAtMost(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The owner's chat a command came from, or undefined when the sender is not an owner.
 * Telegram: a DM from an owner id (`from` is `telegram:<id>`). WhatsApp: an owner number whose
 * `from` is that same number. Webchat and everything else never count.
 */
export function ownerTargetFromCommand(
  ctx: CommandContext,
  owners: SentinelConfig["owners"],
): ResumeTarget | undefined {
  if (ctx.channel === "telegram") {
    const id = (ctx.senderId ?? "").trim();
    if (id && owners.telegram.includes(id) && ctx.from === `telegram:${id}`) {
      return { channel: "telegram", to: ctx.from, accountId: ctx.accountId };
    }
    return undefined;
  }
  if (ctx.channel === "whatsapp") {
    const id = normalizeWhatsAppNumber(ctx.senderId);
    if (id && owners.whatsapp.includes(id) && normalizeWhatsAppNumber(ctx.from) === id) {
      return { channel: "whatsapp", to: id, accountId: ctx.accountId };
    }
  }
  return undefined;
}

/** Config settings the sentinel relies on; each missing one is a way around it. */
export function unsafeConfigProblems(cfg: OpenClawConfig | undefined): string[] {
  const deny = new Set((cfg?.tools?.deny ?? []).map((entry) => entry.trim().toLowerCase()));
  const covered = (names: string[]) => deny.has("*") || names.some((name) => deny.has(name));
  const problems: string[] = [];
  const required: Array<[string, string[]]> = [
    ["exec", ["exec", "bash", "group:runtime"]],
    ["process", ["process", "group:runtime"]],
    ["gateway", ["gateway", "group:automation"]],
  ];
  for (const [tool, names] of required) {
    if (!covered(names)) {
      problems.push(`tools.deny does not include "${tool}"`);
    }
  }
  if (cfg?.tools?.fs?.workspaceOnly !== true) {
    problems.push("tools.fs.workspaceOnly is not true");
  }
  return problems;
}

/** Registers the sentinel. `overrides` replace the guard, clock and timings in tests. */
export function registerMuseSentinel(
  api: OpenClawPluginApi,
  overrides: Partial<SentinelDeps> = {},
): void {
  const deps: SentinelDeps = { ...DEFAULT_DEPS, ...overrides };
  const config = resolveSentinelConfig(api.pluginConfig);
  const state = sharedState();
  const log = api.logger;

  const getStore = (): ApprovalStore => {
    const dir = resolveStoreDir(api.runtime.state.resolveStateDir());
    if (!state.store || state.storeDir !== dir) {
      state.store = new ApprovalStore(dir, deps.now, { ttlMinutes: config.approvalTtlMinutes });
      state.storeDir = dir;
    } else {
      state.store.setTtlMinutes(config.approvalTtlMinutes);
    }
    return state.store;
  };

  const runGuard = async (action: ActionDescriptor): Promise<GuardVerdict> => {
    try {
      return await deps.judge(action, { model: config.guardModel });
    } catch (err) {
      log.warn(`muse-sentinel: guard model failed, asking the owner: ${String(err)}`);
      return { decision: "ask", reason: "guard unavailable", summary: action.summary };
    }
  };

  const block = (blockReason: string): ToolCallResult => ({ block: true, blockReason });
  // Allowing returns the params this hook classified, so a handler that ran earlier cannot
  // swap in different ones (the runner keeps the last handler's params).
  const allow = (params: Record<string, unknown>): ToolCallResult => ({ params });

  const openPageIds =
    deps.openPageIds ??
    (async (profile: string | undefined): Promise<string[]> => {
      const cdpUrl = cdpUrlForProfile(api.config?.browser, profile);
      if (!cdpUrl) {
        throw new Error(`no CDP URL for browser profile ${profile ?? "(default)"}`);
      }
      return await fetchOpenPageIds(cdpUrl);
    });

  /**
   * The tab a browser call was judged against must still be open and be the tab the browser
   * will use: for a closed tab the browser quietly runs the call on another one.
   */
  const checkLiveTab = async (
    params: Record<string, unknown>,
    classified: Record<string, unknown>,
  ): Promise<ToolCallResult | undefined> => {
    const tab = tabToVerify(classified);
    if (!tab || config.mode === "off") {
      return undefined;
    }
    let open: string[];
    try {
      open = await openPageIds(readString(params.profile)?.trim());
    } catch (err) {
      log.warn(`muse-sentinel: could not list the browser tabs: ${String(err)}`);
      return block(TAB_CHECK_FAILED_REASON);
    }
    // Both resolved the way core resolves tab ids: exact, else a unique prefix.
    const live = resolveTabId(tab, open);
    const judged = state.snapshots.knownId(tab);
    return !live || (judged !== undefined && judged !== live)
      ? block(TAB_CLOSED_REASON)
      : undefined;
  };

  const checkToolCall = async (
    toolName: string,
    params: Record<string, unknown>,
    sessionKey: string,
  ): Promise<ToolCallResult> => {
    const tool = toolName.trim().toLowerCase();
    const isBrowser = tool === "browser";
    // The tab this call is judged against; an allowed call is pinned to it (see pinToTab).
    const currentTab = state.currentTab;
    // Classify a copy; an allowed call runs with the params it came with.
    let classified = params;
    if (isBrowser) {
      classified = paramsForClassification(params, currentTab);
    } else if (tool === "message") {
      // Re-hashed on every call, so a file changed after an approval needs a new one.
      classified = await withMediaDigests(params);
    }
    const decision = classify(toolName, classified, { config, snapshots: state.snapshots });
    if (decision.kind === "deny") {
      return block(decision.reason);
    }
    if (isBrowser && !PAUSE_ALLOWED_BROWSER_ACTIONS.has(browserAction(params))) {
      if (getStore().paused) {
        return block(PAUSED_BLOCK_REASON);
      }
    }
    // Before anything is allowed, used up or asked for.
    const tabProblem = isBrowser ? await checkLiveTab(params, classified) : undefined;
    if (tabProblem) {
      return tabProblem;
    }
    // Without a tab of its own, a browser call runs on the tab it was judged against or fails;
    // it never falls back to another tab whose refs point at different elements.
    const runParams = isBrowser ? pinToTab(params, currentTab) : params;
    if (decision.kind === "allow") {
      return allow(runParams);
    }
    const action = decision.action;
    const store = getStore();
    if (store.consume(action.semanticKey, sessionKey)) {
      log.info(`muse-sentinel: approved action used: ${action.summary}`);
      return allow(runParams);
    }
    if (store.recentDenial(action.semanticKey, sessionKey)) {
      return block(DENIED_BLOCK_REASON);
    }
    if (decision.kind === "judge") {
      const verdict = await runGuard(action);
      if (verdict.decision === "allow") {
        log.debug?.(`muse-sentinel: guard allowed: ${action.summary} (${verdict.reason})`);
        return allow(runParams);
      }
    }
    const { entry, isNew } = store.create(action, sessionKey, notifyChannels(config));
    if (isNew) {
      log.info(`muse-sentinel: asking the owner (request ${entry.id}): ${entry.summary}`);
      await waitAtMost(notifyOwner(api.runtime, log, config, entry), deps.notifyTimeoutMs);
    }
    return block(approvalBlockReason(entry.summary));
  };

  api.on(
    "before_tool_call",
    async (event, ctx) => {
      try {
        const sessionKey = ctx.sessionKey?.trim() || DEFAULT_SESSION_KEY;
        state.lastSessionKey = sessionKey;
        return await checkToolCall(event.toolName, event.params, sessionKey);
      } catch (err) {
        // The hook runner lets a call through when a handler throws, so never throw.
        log.error(
          `muse-sentinel: blocked ${event.toolName} after an internal error: ${String(err)}`,
        );
        return block(ERROR_BLOCK_REASON);
      }
    },
    // Lowest priority runs last, so this handler's block is the one that counts.
    { priority: -1000 },
  );

  api.on("after_tool_call", (event) => {
    // Only the adapter's emit (no durationMs key) carries the full snapshot text.
    if (event.toolName !== "browser" || "durationMs" in event) {
      return;
    }
    try {
      const before = state.currentTab;
      captureSnapshotFromToolResult(state.snapshots, event);
      const moved = navigatedTab(event);
      if (moved) {
        state.snapshots.noteUrl(moved.targetId, moved.url);
      }
      // A closed tab is forgotten; a changed one needs a new snapshot before the next judgement.
      const effect = browserEffect(event, before, isOwnBlock);
      if (effect.closed) {
        state.snapshots.forget(effect.closed);
      }
      if (effect.changed) {
        state.snapshots.noteChange(effect.changed);
      }
      state.currentTab = nextCurrentTab(before, event, isOwnBlock);
    } catch (err) {
      // Unsure what happened: trust no snapshot until new ones are taken.
      state.currentTab = undefined;
      state.snapshots.clear();
      log.warn(`muse-sentinel: could not read a browser result: ${String(err)}`);
    }
  });

  /**
   * After the owner gives the browser back: they may have opened, closed or changed tabs, so
   * neither the current tab nor any snapshot is trusted until new ones are taken.
   */
  const forgetBrowserState = () => {
    state.currentTab = undefined;
    state.snapshots.clear();
  };

  // ------------------------------------------------------------------ owner commands

  const resumeOwner = (target: ResumeTarget, sessionKey: string, text: string) => {
    void resumeInBackground(api, { sessionKey, target, text });
  };

  const decideCommand =
    (decision: "approve" | "deny") =>
    (ctx: CommandContext): { text: string } => {
      const owner = ownerTargetFromCommand(ctx, config.owners);
      if (!owner) {
        return { text: NOT_OWNER_TEXT };
      }
      // Telegram takes only the entry id its buttons send, WhatsApp only the typed code.
      const key = approvalKeyFromArgs(owner.channel, ctx.args);
      if (!key) {
        const name = decision === "approve" ? "/ok" : "/no";
        return {
          text:
            owner.channel === "telegram"
              ? TELEGRAM_TAP_TEXT
              : `Send ${name} with the 6-digit code from the approval message.`,
        };
      }
      let result: ReturnType<ApprovalStore["decide"]>;
      try {
        result = getStore().decide(key, decision, owner.channel, { channel: owner.channel });
      } catch (err) {
        log.error(`muse-sentinel: could not save a decision: ${String(err)}`);
        return { text: SAVE_FAILED_TEXT };
      }
      if (!result.ok) {
        const used = result.reason === "not_pending" && result.entry.status === "used";
        return { text: used ? ALREADY_USED_TEXT : NOT_WAITING_TEXT };
      }
      const { entry } = result;
      log.info(`muse-sentinel: owner ${entry.status} request ${entry.id} on ${owner.channel}`);
      if (decision === "approve") {
        resumeOwner(owner, entry.sessionKey, approvedText(entry.summary));
        return { text: `Allowed: ${entry.summary}. Muse will continue.` };
      }
      resumeOwner(owner, entry.sessionKey, deniedText(entry.summary));
      return { text: "Okay, Muse will not do that." };
    };

  const pauseCommand =
    (paused: boolean) =>
    (ctx: CommandContext): { text: string } => {
      const owner = ownerTargetFromCommand(ctx, config.owners);
      if (!owner) {
        return { text: NOT_OWNER_TEXT };
      }
      let wasPaused: boolean;
      try {
        const store = getStore();
        wasPaused = store.paused;
        store.setPaused(paused);
      } catch (err) {
        log.error(`muse-sentinel: could not save the paused state: ${String(err)}`);
        return { text: SAVE_FAILED_TEXT };
      }
      if (paused) {
        return {
          text: "Paused: Muse will not use the cloud browser until you send /resume.",
        };
      }
      if (wasPaused) {
        forgetBrowserState();
        resumeOwner(owner, state.lastSessionKey ?? DEFAULT_SESSION_KEY, GIVE_BACK_TEXT);
      }
      return { text: "Resumed: Muse can use the cloud browser again." };
    };

  const commands: CommandDefinition[] = [
    {
      name: "ok",
      description: "Allow an action Muse is waiting on: /ok CODE",
      handler: decideCommand("approve"),
    },
    {
      name: "no",
      description: "Stop an action Muse is waiting on: /no CODE",
      handler: decideCommand("deny"),
    },
    {
      name: "pause",
      description: "Take over the cloud browser; Muse waits",
      handler: pauseCommand(true),
    },
    {
      name: "resume",
      description: "Give the cloud browser back to Muse",
      handler: pauseCommand(false),
    },
  ];
  for (const command of commands) {
    api.registerCommand({ ...command, acceptsArgs: true, requireAuth: true });
  }

  // ------------------------------------------------------------------ HTTP API

  /** Wakes the agent on the session's last Telegram/WhatsApp chat, if that chat is an owner's. */
  const resumeOnLastChannel = (sessionKey: string, text: string) => {
    try {
      const target = readLastRoute(api, sessionKey);
      if (!target || !isOwnerAddress(target, config.owners)) {
        log.info("muse-sentinel: no owner Telegram/WhatsApp chat to continue on; not resuming");
        return;
      }
      resumeOwner(target, sessionKey, text);
    } catch (err) {
      log.warn(`muse-sentinel: could not resume on the last channel: ${String(err)}`);
    }
  };

  const routes = createRoutes({
    config,
    store: getStore,
    logger: log,
    afterDecide: (entry: PendingEntry, resume: ResumeMode) => {
      if (resume === "channel") {
        const text =
          entry.status === "approved" ? approvedText(entry.summary) : deniedText(entry.summary);
        resumeOnLastChannel(entry.sessionKey, text);
      }
    },
    afterGiveBack: (resume: ResumeMode) => {
      forgetBrowserState();
      if (resume === "channel") {
        resumeOnLastChannel(state.lastSessionKey ?? DEFAULT_SESSION_KEY, GIVE_BACK_TEXT);
      }
    },
  });
  for (const route of routes) {
    api.registerHttpRoute(route);
  }

  // ------------------------------------------------------------------ service

  api.registerService({
    id: PLUGIN_ID,
    start: (svc) => {
      const problems = unsafeConfigProblems(svc.config);
      if (problems.length > 0) {
        log.error(
          `muse-sentinel: UNSAFE CONFIG, the agent can get around the sentinel: ${problems.join("; ")}.`,
        );
      }
      if (config.mode === "off") {
        log.warn("muse-sentinel: mode is off; only the always-denied tools are blocked");
      }
      if (config.owners.telegram.length === 0 && config.owners.whatsapp.length === 0) {
        log.warn(
          "muse-sentinel: no owners configured; approvals only work on the desktop page or in Pineapple",
        );
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        log.warn(
          "muse-sentinel: ANTHROPIC_API_KEY is not set; every unclear click goes to the owner",
        );
      }
      if (state.expiryTimer) {
        clearInterval(state.expiryTimer);
      }
      state.expiryTimer = setInterval(() => {
        try {
          getStore().expire();
        } catch (err) {
          log.warn(`muse-sentinel: could not expire old requests: ${String(err)}`);
        }
      }, deps.expiryIntervalMs);
      state.expiryTimer.unref?.();
      log.info(
        `muse-sentinel: active (mode ${config.mode}, guard ${config.guardModel}, ${config.owners.telegram.length} Telegram and ${config.owners.whatsapp.length} WhatsApp owners)`,
      );
    },
    stop: () => {
      if (state.expiryTimer) {
        clearInterval(state.expiryTimer);
        state.expiryTimer = undefined;
      }
    },
  });
}

const plugin = {
  id: PLUGIN_ID,
  name: "Muse Sentinel",
  description:
    "Asks the owner on their phone before the agent does anything that leaves the machine.",
  register(api: OpenClawPluginApi): void {
    registerMuseSentinel(api);
  },
};

export default plugin;
