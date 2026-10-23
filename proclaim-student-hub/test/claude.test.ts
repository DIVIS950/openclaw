import { describe, expect, it } from "vitest";
import { coercePack } from "../shared/pack.ts";
import { ClaudeData } from "../src/lib/claudeData.ts";
import type { CollectionRef, Db, DocRef, Mcp } from "../src/lib/claudeRuntime.ts";

// In-memory stand-in for the page's document store.
function fakeDb(): Db {
  const docs = new Map<string, Record<string, unknown>>();
  let n = 0;
  const docRef = (path: string): DocRef => ({
    id: path.split("/").pop() ?? "",
    get: async () => ({
      id: path.split("/").pop() ?? "",
      exists: docs.has(path),
      data: () => docs.get(path),
    }),
    set: async (d) => void docs.set(path, { ...d }),
    update: async (d) => {
      if (!docs.has(path)) {
        throw new Error("missing");
      }
      docs.set(path, { ...docs.get(path), ...d });
    },
    delete: async () => void docs.delete(path),
    collection: (sub) => collection(`${path}/${sub}`),
  });
  const collection = (path: string): CollectionRef => ({
    doc: (id) => docRef(`${path}/${id ?? `auto${++n}`}`),
    get: async () => ({
      docs: [...docs.keys()]
        .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/"))
        .map((k) => ({ id: k.split("/").pop() ?? "", exists: true, data: () => docs.get(k) })),
    }),
  });
  return { doc: docRef };
}

function fakeGmail(calls: { tool: string; input: unknown }[]): Mcp {
  return {
    async callTool(server, tool, input) {
      calls.push({ tool, input });
      expect(server).toBe("Gmail");
      if (tool === "search_threads") {
        return {
          payload: {
            threads: [
              {
                id: "t1",
                viewUrl: "https://mail.example/t1",
                messages: [
                  {
                    id: "m1",
                    sender: "Form Tutor <tutor@school.example>",
                    subject: "Trip form",
                    snippet: "Please sign &amp; return",
                    date: "2026-09-25T10:00:00Z",
                    labelIds: ["INBOX", "UNREAD"],
                  },
                ],
              },
              { id: "empty", messages: [] },
            ],
          },
        };
      }
      if (tool === "get_thread") {
        return { payload: { id: "t1", messages: [{ id: "m1" }, { id: "m2" }] } };
      }
      return { payload: { id: "sent" } };
    },
  };
}

describe("ClaudeData", () => {
  it("reads the Gmail inbox into emails", async () => {
    const calls: { tool: string; input: unknown }[] = [];
    const data = new ClaudeData(fakeGmail(calls), null, null, null);
    const inbox = await data.inbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      id: "t1",
      from: "Form Tutor",
      fromEmail: "tutor@school.example",
      snippet: "Please sign & return",
      unread: true,
      link: "https://mail.example/t1",
    });
  });

  it("replies to the newest message in the thread", async () => {
    const calls: { tool: string; input: unknown }[] = [];
    const data = new ClaudeData(fakeGmail(calls), null, null, null);
    const [email] = await data.inbox();
    await data.sendReply(email, "Thanks!");
    expect(calls.at(-1)).toEqual({ tool: "reply", input: { messageId: "m2", body: "Thanks!" } });
  });

  it("explains how to fix a missing Gmail connector", async () => {
    const mcp: Mcp = {
      callTool: () => Promise.reject({ code: "server_not_connected", message: "x" }),
    };
    await expect(new ClaudeData(mcp, null, null, null).inbox()).rejects.toThrow(
      /Settings → Connectors/,
    );
  });

  it("keeps homework and drafts in the viewer's private store", async () => {
    const data = new ClaudeData(null, fakeDb(), "u1", null);
    const hw = await data.addHomework({
      title: "Macbeth essay",
      source: "Classroom",
      due: "2026-10-01",
    });
    await data.addHomework({ title: "Task 12", source: "Dr Frost" });
    let list = await data.homework();
    expect(list.map((h) => h.title)).toEqual(["Macbeth essay", "Task 12"]);

    await data.setDone(hw, true);
    list = await data.homework();
    expect(list.find((h) => h.id === hw.id)?.done).toBe(true);

    expect((await data.loadDraft(hw)).text).toBe("");
    await data.saveDraft(hw, "My essay");
    expect((await data.loadDraft(hw)).text).toBe("My essay");
  });

  it("works without storage: empty list, and a clear error on save", async () => {
    const data = new ClaudeData(null, null, null, null);
    expect(await data.homework()).toEqual([]);
    await expect(data.addHomework({ title: "x", source: "Other" })).rejects.toThrow(
      /signed in to Claude/,
    );
  });
});

describe("coercePack", () => {
  it("fills gaps in a loosely shaped reply", () => {
    const pack = coercePack({
      topic: "Rivers",
      summary: ["Water flows downhill", 7],
      quiz: [{ question: "Q", options: ["a", "b"], answer: "1", explanation: "" }],
      trueFalse: [{ statement: "S", answer: "true", why: "" }],
      match: "not a list",
    });
    expect(pack.topic).toBe("Rivers");
    expect(pack.summary).toEqual(["Water flows downhill", "7"]);
    expect(pack.quiz[0].answer).toBe(1);
    expect(pack.trueFalse[0].answer).toBe(true);
    expect(pack.match).toEqual([]);
    expect(pack.flashcards).toEqual([]);
  });

  it("rejects a reply that isn't an object", () => {
    expect(() => coercePack(["nope"])).toThrow(/revision pack/);
  });
});
