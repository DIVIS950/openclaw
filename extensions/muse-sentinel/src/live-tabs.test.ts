import { describe, expect, it, vi } from "vitest";
import { cdpUrlForProfile, fetchOpenPageIds, type TabsFetch } from "./live-tabs.js";

const MUSE_BROWSER = {
  defaultProfile: "openclaw",
  profiles: { openclaw: { cdpUrl: "http://172.30.0.10:9222" } },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cdpUrlForProfile", () => {
  it("resolves the profile's CDP URL like core does", () => {
    expect(cdpUrlForProfile(MUSE_BROWSER)).toBe("http://172.30.0.10:9222");
    expect(cdpUrlForProfile(MUSE_BROWSER, " openclaw ")).toBe("http://172.30.0.10:9222");
    // An unknown profile has no URL: the caller fails closed.
    expect(cdpUrlForProfile(MUSE_BROWSER, "chrome")).toBeUndefined();
    expect(cdpUrlForProfile(undefined)).toBeUndefined();
    // Legacy top-level cdpUrl serves the openclaw profile; cdpPort uses its host.
    expect(cdpUrlForProfile({ cdpUrl: "http://10.0.0.5:9333" })).toBe("http://10.0.0.5:9333");
    expect(
      cdpUrlForProfile(
        { cdpUrl: "https://10.0.0.5:9333", profiles: { work: { cdpPort: 9444 } } },
        "work",
      ),
    ).toBe("https://10.0.0.5:9444");
    expect(cdpUrlForProfile({ profiles: { work: { cdpPort: 9444 } } }, "work")).toBe(
      "http://127.0.0.1:9444",
    );
  });
});

describe("fetchOpenPageIds", () => {
  it("lists only page targets", async () => {
    const fetch = vi.fn<TabsFetch>(async () =>
      jsonResponse([
        { id: "A", type: "page", url: "https://a.example/" },
        { id: "SW", type: "service_worker" },
        { id: "B", type: "page" },
        "junk",
      ]),
    );
    expect(await fetchOpenPageIds("http://172.30.0.10:9222/", { fetch })).toEqual(["A", "B"]);
    expect(fetch.mock.calls[0]?.[0]).toBe("http://172.30.0.10:9222/json/list");
  });

  it("sends URL credentials as Basic auth, as core does", async () => {
    const fetch = vi.fn<TabsFetch>(async () => jsonResponse([]));
    await fetchOpenPageIds("http://muse:s%40cret@172.30.0.10:9222", { fetch });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://172.30.0.10:9222/json/list");
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      `Basic ${Buffer.from("muse:s@cret").toString("base64")}`,
    );
  });

  it("throws when it cannot tell which tabs are open", async () => {
    await expect(
      fetchOpenPageIds("http://h:1", { fetch: async () => jsonResponse({}, 500) }),
    ).rejects.toThrow("HTTP 500");
    await expect(
      fetchOpenPageIds("http://h:1", { fetch: async () => jsonResponse({ id: "A" }) }),
    ).rejects.toThrow("did not return a list");
    await expect(fetchOpenPageIds("not a url")).rejects.toThrow();
    // A browser that does not answer in time.
    const hang: TabsFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(fetchOpenPageIds("http://h:1", { fetch: hang, timeoutMs: 10 })).rejects.toThrow(
      "aborted",
    );
  });
});
