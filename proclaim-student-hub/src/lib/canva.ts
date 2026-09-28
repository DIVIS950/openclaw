import { useCapability } from "./claudeRuntime.ts";

// Making a visual in the student's own Canva, through their claude.ai Canva
// connector (the page never sees their Canva login). Canva designs are made
// as a background job, so we start one and check back until it's ready.

const CANVA = "Canva";
const MAX_WAIT_MS = 150_000;

/** Depth-first search for the first value under `key` anywhere in a reply. */
export function findKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findKey(v, key);
      if (hit !== undefined) {
        return hit;
      }
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (key in obj) {
      return obj[key];
    }
    for (const v of Object.values(obj)) {
      const hit = findKey(v, key);
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return undefined;
}

/** The first canva.com design link anywhere in a reply (edit link preferred). */
export function findDesignLink(value: unknown): string | null {
  const links: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (/^https:\/\/(www\.)?canva\.com\/design\//.test(v)) {
        links.push(v);
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object" && v !== null) {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return links.find((l) => l.includes("/edit")) ?? links[0] ?? null;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");

export async function makeCanvaDesign(brief: string, format: string): Promise<string> {
  const mcp = await useCapability("mcp");
  if (!mcp) {
    throw new Error("Canva works when this app is open on claude.ai with the Canva connector on.");
  }
  const intent = "Student making a visual for their homework";
  let payload: unknown;
  try {
    ({ payload } = await mcp.callTool(CANVA, "create-design", {
      brief: brief.slice(0, 2000),
      format,
      user_intent: intent,
    }));
  } catch (err) {
    throw new Error("Couldn't reach Canva. Check the Canva connector is connected on claude.ai.", {
      cause: err,
    });
  }
  const jobId = text(findKey(payload, "job_id"));
  let token = text(findKey(payload, "continuation_token"));
  const started = Date.now();
  let link = findDesignLink(payload);
  while (!link && jobId && token && Date.now() - started < MAX_WAIT_MS) {
    const wait = Number(findKey(payload, "wait_seconds")) || 3;
    await new Promise((r) => setTimeout(r, Math.min(15, Math.max(2, wait)) * 1000));
    ({ payload } = await mcp.callTool(CANVA, "get-create-design-async-job", {
      job_id: jobId,
      continuation_token: token,
      user_intent: intent,
    }));
    token = text(findKey(payload, "continuation_token")) || token;
    link = findDesignLink(payload);
    const status = text(findKey(payload, "status")).toLowerCase();
    if (!link && (status === "failed" || status === "error")) {
      break;
    }
  }
  if (!link) {
    throw new Error("Canva didn't finish the design. Try again in a minute.");
  }
  return link;
}
