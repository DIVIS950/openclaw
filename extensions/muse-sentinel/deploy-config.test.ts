import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadAgentIdentityFromWorkspace } from "../../src/agents/identity-file.js";
import { ensureAgentWorkspace } from "../../src/agents/workspace.js";
import { resolveBrowserConfig } from "../../src/browser/config.js";
import { assertBrowserNavigationAllowed } from "../../src/browser/navigation-guard.js";
import type { OpenClawConfig } from "../../src/config/config.js";
import { resolveConfigEnvVars } from "../../src/config/env-substitution.js";
import { applyPluginAutoEnable } from "../../src/config/plugin-auto-enable.js";
import { validateConfigObjectWithPlugins } from "../../src/config/validation.js";
import type { LookupFn } from "../../src/infra/net/ssrf.js";
import { loadOpenClawPlugins } from "../../src/plugins/loader.js";

// Runs deploy/muse/make-config.py the way install.sh does and checks the result with
// OpenClaw's own config validator, using this folder's real plugin manifest.
const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const extensionsDir = path.dirname(pluginDir);
const script = path.resolve(pluginDir, "../../deploy/muse/make-config.py");
const hasPython = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;

const SECRETS = {
  ANTHROPIC_API_KEY: "sk-ant-test-0123456789abcdef",
  OPENCLAW_GATEWAY_TOKEN: "0123456789abcdef0123456789abcdef",
  TELEGRAM_BOT_TOKEN: "123456789:test-telegram-bot-token",
};

const BASE_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY,
  OPENCLAW_GATEWAY_TOKEN: SECRETS.OPENCLAW_GATEWAY_TOKEN,
  MUSE_SITE: "muse.example.com",
  MUSE_DOMAIN: "",
  MUSE_WATCH_KEY: "0123456789abcdef",
  MUSE_VNC_PASSWORD: "abcd1234",
  TELEGRAM_BOT_TOKEN: "",
  MUSE_TELEGRAM_OWNER: "",
  MUSE_WHATSAPP_OWNER: "",
  MUSE_MODEL: "anthropic/claude-opus-5-5",
};

type SentinelConfig = {
  owners: { telegram?: string[]; whatsapp?: string[] };
  notify: { telegram?: string; whatsapp?: string };
  guardModel: string;
  mode: string;
};

let tmpRoot = "";
let caseIndex = 0;

function writeEnvFile(env: Record<string, string>): { dir: string; envFile: string } {
  const dir = path.join(tmpRoot, `case-${caseIndex++}`);
  fs.mkdirSync(dir, { recursive: true });
  const envFile = path.join(dir, "muse.env");
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(envFile, `# test env\n${lines.join("\n")}\n`);
  return { dir, envFile };
}

function runMakeConfig(env: Record<string, string>, extraArgs: string[] = []) {
  const { dir, envFile } = writeEnvFile(env);
  const out = path.join(dir, "openclaw", "openclaw.json");
  // A later --extensions-dir in extraArgs wins (argparse keeps the last value).
  const result = spawnSync(
    "python3",
    [script, "--env-file", envFile, "--out", out, "--extensions-dir", extensionsDir, ...extraArgs],
    { encoding: "utf8" },
  );
  return { dir, out, result };
}

function generate(overrides: Record<string, string>, extraArgs: string[] = []) {
  const env = { ...BASE_ENV, ...overrides };
  const { dir, out, result } = runMakeConfig(env, extraArgs);
  expect(result.status, result.stderr).toBe(0);
  const text = fs.readFileSync(out, "utf8");
  // The gateway resolves ${VAR} references with the container env (the same env file).
  const resolved = resolveConfigEnvVars(JSON.parse(text), env);
  const validation = validateConfigObjectWithPlugins(resolved);
  if (!validation.ok) {
    throw new Error(`config rejected: ${JSON.stringify(validation.issues, null, 2)}`);
  }
  expect(validation.warnings).toEqual([]);
  return { dir, out, text, env, config: validation.config };
}

function sentinelConfig(config: OpenClawConfig): SentinelConfig {
  return config.plugins?.entries?.["muse-sentinel"]?.config as SentinelConfig;
}

// Writes a minimal plugin: the real manifest of extensions/<id> and an entry point that
// records its id in globalThis.__museImported when the loader imports it.
function writePluginStub(root: string, id: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(extensionsDir, id, "openclaw.plugin.json");
  fs.copyFileSync(manifest, path.join(dir, "openclaw.plugin.json"));
  const label = JSON.stringify(`${path.basename(root)}:${id}`);
  fs.writeFileSync(
    path.join(dir, "index.ts"),
    [
      "const g = globalThis as { __museImported?: string[] };",
      `(g.__museImported ??= []).push(${label});`,
      `export default { id: ${JSON.stringify(id)}, register() {} };`,
      "",
    ].join("\n"),
  );
}

function importedPlugins(): string[] {
  return [...((globalThis as { __museImported?: string[] }).__museImported ?? [])].toSorted();
}

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!hasPython)("deploy/muse/make-config.py", () => {
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muse-make-config-"));
  });

  afterAll(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("writes a valid config with only the Anthropic key", () => {
    const { out, text, env, config } = generate({});

    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("${");
    if (process.platform !== "win32") {
      expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    }

    expect(config.gateway?.mode).toBe("local");
    expect(config.gateway?.bind).toBe("lan");
    expect(config.gateway?.auth?.mode).toBe("token");
    expect(config.gateway?.auth?.token).toBeUndefined();
    expect(config.gateway?.trustedProxies).toEqual(["172.30.0.3/32"]);
    expect(config.gateway?.controlUi?.allowedOrigins).toEqual(["https://muse.example.com"]);
    expect(config.gateway?.tools?.deny).toEqual(
      expect.arrayContaining(["browser", "message", "exec", "write", "edit", "apply_patch"]),
    );
    expect(config.tools?.deny).toEqual(
      expect.arrayContaining(["exec", "process", "gateway", "cron", "nodes", "lobster"]),
    );
    expect(config.tools?.fs?.workspaceOnly).toBe(true);
    expect(config.commands?.config).toBe(false);
    expect(config.commands?.restart).toBe(false);
    expect(config.hooks?.internal?.enabled).toBe(false);
    expect(config.session?.dmScope).toBe("main");
    expect(config.agents?.defaults?.workspace).toBe("/home/node/.openclaw/workspace");
    expect(config.agents?.defaults?.model).toEqual({
      primary: "anthropic/claude-opus-5-5",
      fallbacks: ["anthropic/claude-opus-4-6"],
    });
    expect(config.models?.providers?.anthropic?.apiKey).toBeUndefined();
    expect(config.browser?.defaultProfile).toBe("openclaw");
    expect(config.browser?.evaluateEnabled).toBe(false);
    expect(config.browser?.profiles?.openclaw?.cdpUrl).toBe("http://172.30.0.10:9222");
    expect(config.browser?.ssrfPolicy).toEqual({ dangerouslyAllowPrivateNetwork: false });

    expect(config.channels?.telegram).toBeUndefined();
    expect(config.channels?.whatsapp).toBeUndefined();
    expect(config.plugins?.allow).toEqual(["muse-sentinel"]);
    expect(config.plugins?.load?.paths).toEqual([pluginDir]);
    expect(config.plugins?.slots?.memory).toBe("none");
    expect(sentinelConfig(config)).toEqual({
      owners: {},
      notify: {},
      guardModel: "claude-haiku-5-5",
      mode: "outbound",
    });

    // Nothing for the gateway to auto-enable, so it never rewrites the file at startup.
    expect(applyPluginAutoEnable({ config, env }).changes).toEqual([]);
  });

  it("adds Telegram with the owner on the allowlist and never writes the bot token", () => {
    const { text, env, config } = generate({
      TELEGRAM_BOT_TOKEN: SECRETS.TELEGRAM_BOT_TOKEN,
      MUSE_TELEGRAM_OWNER: "123456789",
    });

    expect(text).not.toContain(SECRETS.TELEGRAM_BOT_TOKEN);
    expect(config.channels?.telegram).toMatchObject({
      enabled: true,
      dmPolicy: "allowlist",
      allowFrom: ["123456789"],
      groupPolicy: "disabled",
      configWrites: false,
      // The owner's chat holds the approval requests; the agent may not delete them.
      actions: { deleteMessage: false },
    });
    expect(config.channels?.telegram?.botToken).toBeUndefined();
    expect(config.channels?.whatsapp).toBeUndefined();
    expect(config.plugins?.allow).toEqual(["muse-sentinel", "telegram"]);
    expect(config.plugins?.load?.paths).toEqual([pluginDir, path.join(extensionsDir, "telegram")]);
    expect(config.plugins?.entries?.telegram?.enabled).toBe(true);
    expect(sentinelConfig(config).owners).toEqual({ telegram: ["123456789"] });
    expect(sentinelConfig(config).notify).toEqual({ telegram: "123456789" });
    expect(applyPluginAutoEnable({ config, env }).changes).toEqual([]);
  });

  it("uses Telegram pairing until the owner id is known", () => {
    const { config } = generate({ TELEGRAM_BOT_TOKEN: SECRETS.TELEGRAM_BOT_TOKEN });

    expect(config.channels?.telegram?.dmPolicy).toBe("pairing");
    expect(config.channels?.telegram?.allowFrom).toBeUndefined();
    expect(sentinelConfig(config).owners).toEqual({});
  });

  it("adds WhatsApp in self-chat mode for the owner's number", () => {
    const { env, config } = generate({ MUSE_WHATSAPP_OWNER: "+420 123 456 789" });

    expect(config.channels?.whatsapp).toMatchObject({
      enabled: true,
      dmPolicy: "allowlist",
      allowFrom: ["+420123456789"],
      selfChatMode: true,
      groupPolicy: "disabled",
      configWrites: false,
    });
    expect(config.channels?.telegram).toBeUndefined();
    expect(config.plugins?.allow).toEqual(["muse-sentinel", "whatsapp"]);
    expect(config.plugins?.load?.paths).toEqual([pluginDir, path.join(extensionsDir, "whatsapp")]);
    expect(sentinelConfig(config).owners).toEqual({ whatsapp: ["+420123456789"] });
    expect(sentinelConfig(config).notify).toEqual({ whatsapp: "+420123456789" });
    expect(applyPluginAutoEnable({ config, env }).changes).toEqual([]);
  });

  it("adds both channels and drops the fallback when it is the primary model", () => {
    const { env, config } = generate({
      TELEGRAM_BOT_TOKEN: SECRETS.TELEGRAM_BOT_TOKEN,
      MUSE_TELEGRAM_OWNER: "telegram:123456789",
      MUSE_WHATSAPP_OWNER: "00420123456789",
      MUSE_MODEL: "anthropic/claude-opus-4-6",
    });

    expect(config.plugins?.allow).toEqual(["muse-sentinel", "telegram", "whatsapp"]);
    expect(config.plugins?.load?.paths).toEqual(
      config.plugins?.allow?.map((id) => path.join(extensionsDir, id)),
    );
    expect(config.channels?.telegram?.allowFrom).toEqual(["123456789"]);
    expect(config.channels?.whatsapp?.allowFrom).toEqual(["+420123456789"]);
    expect(sentinelConfig(config).owners).toEqual({
      telegram: ["123456789"],
      whatsapp: ["+420123456789"],
    });
    expect(config.agents?.defaults?.model).toEqual({ primary: "anthropic/claude-opus-4-6" });
    expect(applyPluginAutoEnable({ config, env }).changes).toEqual([]);
  });

  it("keeps the browser away from private and link-local addresses", async () => {
    const { config } = generate({});
    const { ssrfPolicy } = resolveBrowserConfig(config.browser, config);
    const publicLookup = vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]);

    for (const url of [
      "http://169.254.169.254/hetzner/v1/userdata",
      "http://172.30.0.2:18789/",
      "http://localhost:6080/",
    ]) {
      await expect(assertBrowserNavigationAllowed({ url, ssrfPolicy }), url).rejects.toThrow();
    }
    await expect(
      assertBrowserNavigationAllowed({
        url: "https://shop.example.com/",
        ssrfPolicy,
        lookupFn: publicLookup as unknown as LookupFn,
      }),
    ).resolves.toBeUndefined();
  });

  it("loads every allowed plugin from the image so a workspace copy cannot replace it", () => {
    // Stand-in for the image: /app/extensions is the bundled folder and the load paths point
    // into it. The workspace holds what a prompt-injected agent could write there.
    const imageDir = path.join(tmpRoot, "image");
    const workspace = path.join(tmpRoot, "agent-workspace");
    const planted = path.join(workspace, ".openclaw", "extensions");
    for (const id of ["muse-sentinel", "telegram", "whatsapp"]) {
      writePluginStub(imageDir, id);
      writePluginStub(planted, id);
    }
    writePluginStub(planted, "device-pair");
    vi.stubEnv("OPENCLAW_BUNDLED_PLUGINS_DIR", imageDir);

    const { config } = generate(
      {
        TELEGRAM_BOT_TOKEN: SECRETS.TELEGRAM_BOT_TOKEN,
        MUSE_TELEGRAM_OWNER: "123456789",
        MUSE_WHATSAPP_OWNER: "+420123456789",
      },
      ["--extensions-dir", imageDir],
    );
    const statusByOrigin = (registry: ReturnType<typeof loadOpenClawPlugins>, origin: string) =>
      registry.plugins
        .filter((plugin) => plugin.origin === origin)
        .map(
          (plugin) => `${plugin.id}: ${plugin.status}${plugin.error ? ` (${plugin.error})` : ""}`,
        )
        .toSorted();

    const registry = loadOpenClawPlugins({
      config,
      workspaceDir: workspace,
      cache: false,
      logger: quietLogger,
    });
    expect(statusByOrigin(registry, "config")).toEqual([
      "muse-sentinel: loaded",
      "telegram: loaded",
      "whatsapp: loaded",
    ]);
    expect(statusByOrigin(registry, "workspace")).toEqual([
      "device-pair: disabled (not in allowlist)",
      "muse-sentinel: disabled (overridden by config plugin)",
      "telegram: disabled (overridden by config plugin)",
      "whatsapp: disabled (overridden by config plugin)",
    ]);
    expect(importedPlugins()).toEqual(["image:muse-sentinel", "image:telegram", "image:whatsapp"]);

    // Control: with only the Sentinel pinned, the planted channel plugins win and run.
    const sentinelOnly: OpenClawConfig = {
      ...config,
      plugins: { ...config.plugins, load: { paths: [path.join(imageDir, "muse-sentinel")] } },
    };
    const unpinned = loadOpenClawPlugins({
      config: sentinelOnly,
      workspaceDir: workspace,
      cache: false,
      logger: quietLogger,
    });
    expect(statusByOrigin(unpinned, "workspace")).toContain("telegram: loaded");
    expect(importedPlugins()).toContain("extensions:telegram");
  });

  it.runIf(process.getuid?.() === 0)("locks the workspace plugin folder when run as root", () => {
    // After install.sh the workspace belongs to the gateway user (uid 1000).
    const workspace = path.join(tmpRoot, "locked-workspace");
    fs.mkdirSync(workspace);
    fs.chownSync(workspace, 1000, 1000);
    const { result } = runMakeConfig(BASE_ENV, ["--workspace", workspace]);
    expect(result.status, result.stderr).toBe(0);

    const stateDir = fs.statSync(path.join(workspace, ".openclaw"));
    const workspacePlugins = fs.statSync(path.join(workspace, ".openclaw", "extensions"));
    expect([stateDir.uid, stateDir.gid]).toEqual([1000, 1000]);
    expect([workspacePlugins.uid, workspacePlugins.mode & 0o777]).toEqual([0, 0o755]);
  });

  it.each([
    ["MUSE_SITE is missing", { MUSE_SITE: "" }, "MUSE_SITE"],
    ["MUSE_SITE has a scheme", { MUSE_SITE: "https://muse.example.com/" }, "MUSE_SITE"],
    ["the gateway token is missing", { OPENCLAW_GATEWAY_TOKEN: "" }, "OPENCLAW_GATEWAY_TOKEN"],
    ["the Anthropic key is missing", { ANTHROPIC_API_KEY: "" }, "ANTHROPIC_API_KEY"],
    ["the WhatsApp number is malformed", { MUSE_WHATSAPP_OWNER: "12345" }, "MUSE_WHATSAPP_OWNER"],
    ["the Telegram id is not numeric", { MUSE_TELEGRAM_OWNER: "@me" }, "MUSE_TELEGRAM_OWNER"],
    ["the sentinel mode is unknown", { MUSE_SENTINEL_MODE: "yolo" }, "MUSE_SENTINEL_MODE"],
    ["the model has no provider", { MUSE_MODEL: "claude-opus-5-5" }, "MUSE_MODEL"],
  ])("fails without writing a config when %s", (_label, overrides, key) => {
    const { out, result } = runMakeConfig({ ...BASE_ENV, ...overrides });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(key);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("writes the Muse persona into the workspace and OpenClaw keeps it", async () => {
    const workspace = path.join(tmpRoot, "workspace");
    const first = runMakeConfig(BASE_ENV, ["--workspace", workspace]);
    expect(first.result.status, first.result.stderr).toBe(0);
    const agentsPath = path.join(workspace, "AGENTS.md");
    const agentsMd = fs.readFileSync(agentsPath, "utf8");
    expect(agentsMd).toContain("Muse Sentinel");
    expect(loadAgentIdentityFromWorkspace(workspace)?.name).toBe("Muse");

    // OpenClaw seeds only missing files: the persona stays and no first-run BOOTSTRAP.md appears.
    await ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(agentsMd);
    expect(fs.existsSync(path.join(workspace, "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "BOOTSTRAP.md"))).toBe(false);

    // A later run keeps edits the agent made.
    fs.writeFileSync(agentsPath, "# edited by the agent\n");
    const again = runMakeConfig(BASE_ENV, ["--workspace", workspace]);
    expect(again.result.status, again.result.stderr).toBe(0);
    expect(fs.readFileSync(agentsPath, "utf8")).toBe("# edited by the agent\n");
  });
});
