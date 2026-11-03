import { describe, expect, it } from "vitest";
import { ClaudeData } from "../src/lib/claudeData.ts";
import { type Mcp, takeTurns } from "../src/lib/claudeRuntime.ts";

// 1.5.1: "Gmail is not connected". Two causes: Today asked for Gmail and
// Google Calendar at the same moment (one question fails), and Gmail's search
// previews no longer carry the date or snippet.

describe("connector calls take turns", () => {
  it("runs the first call to each connector one at a time", async () => {
    const log: string[] = [];
    let open = 0;
    const mcp: Mcp = {
      async callTool(server) {
        open++;
        log.push(`${server}:${open}`);
        await new Promise((r) => setTimeout(r, 5));
        open--;
        return { payload: {} };
      },
    };
    const polite = takeTurns(mcp);
    await Promise.all([
      polite.callTool("Gmail", "search_threads", {}),
      polite.callTool("Google Calendar", "list_events", {}),
    ]);
    // Never two first questions at once.
    expect(log).toEqual(["Gmail:1", "Google Calendar:1"]);
  });

  it("tries a read once more when the answer says it may work", async () => {
    let calls = 0;
    const mcp: Mcp = {
      callTool: () =>
        ++calls === 1
          ? Promise.reject({ code: "upstream_error", message: "busy", retryable: true })
          : Promise.resolve({ payload: { ok: true } }),
    };
    const waits: number[] = [];
    const polite = takeTurns(mcp, async (ms) => void waits.push(ms));
    await expect(polite.callTool("Gmail", "search_threads", {})).resolves.toEqual({
      payload: { ok: true },
    });
    expect(calls).toBe(2);
    expect(waits).toEqual([1500]);
  });

  it("never sends a write twice", async () => {
    let calls = 0;
    const mcp: Mcp = {
      callTool: () => {
        calls++;
        return Promise.reject({ code: "server_unavailable", message: "x", retryable: true });
      },
    };
    const polite = takeTurns(mcp, async () => {});
    await expect(polite.callTool("Gmail", "reply", {})).rejects.toMatchObject({
      code: "server_unavailable",
    });
    expect(calls).toBe(1);
  });
});

describe("Gmail previews without a date or snippet", () => {
  const preview = {
    threads: [
      {
        id: "t1",
        messageCount: 1,
        messages: [
          { id: "m1", sender: "no-reply@classroom.google.com", subject: 'Due tomorrow: "Essay"' },
        ],
      },
    ],
  };
  const full = {
    id: "t1",
    viewUrl: "https://mail.example/t1",
    messages: [
      {
        id: "m1",
        sender: "no-reply@classroom.google.com",
        subject: 'Due tomorrow: "Essay"',
        snippet: "Notification settings 9i English Due tomorrow Essay Due Nov 4",
        date: "2026-11-03T18:00:00Z",
        labelIds: ["UNREAD", "INBOX"],
      },
    ],
  };

  it("reads the thread for them, once", async () => {
    const tools: string[] = [];
    const mcp: Mcp = {
      async callTool(_server, tool) {
        tools.push(tool);
        return { payload: tool === "search_threads" ? preview : full };
      },
    };
    const data = new ClaudeData(mcp, null, null, null);
    const [email] = await data.searchEmails("from:classroom.google.com");
    expect(email).toMatchObject({
      snippet: "Notification settings 9i English Due tomorrow Essay Due Nov 4",
      date: "2026-11-03T18:00:00Z",
      unread: true,
      link: "https://mail.example/t1",
    });
    await data.searchEmails("from:classroom.google.com");
    expect(tools).toEqual(["search_threads", "get_thread", "search_threads"]);
  });

  it("keeps the preview when the thread can't be read", async () => {
    const mcp: Mcp = {
      callTool: (_server, tool) =>
        tool === "search_threads"
          ? Promise.resolve({ payload: preview })
          : Promise.reject({ code: "server_unavailable", message: "x" }),
    };
    const [email] = await new ClaudeData(mcp, null, null, null).searchEmails("x");
    expect(email.subject).toBe('Due tomorrow: "Essay"');
  });
});

describe("Gmail error words", () => {
  const fail = (err: object) =>
    new ClaudeData({ callTool: () => Promise.reject(err) }, null, null, null);

  it("says where to allow Gmail again after a no", async () => {
    await expect(fail({ code: "not_in_manifest", message: "x" }).inbox()).rejects.toThrow(
      /Permissions/,
    );
  });

  it("asks to tap again when Claude couldn't ask just then", async () => {
    await expect(
      fail({ code: "upstream_error", message: "x", retryable: true }).inbox(),
    ).rejects.toThrow(/Tap Connect Gmail again/);
  });
});
