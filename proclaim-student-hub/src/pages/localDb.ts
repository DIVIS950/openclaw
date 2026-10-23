import type { CollectionRef, Db, DocRef, DocSnapshot } from "../lib/claudeRuntime.ts";

// The claude.ai page database, rebuilt on this phone's own storage for the
// GitHub Pages version. Nothing leaves the phone.

const PREFIX = "psh.db/";

function read(path: string): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function write(path: string, value: Record<string, unknown>) {
  try {
    localStorage.setItem(PREFIX + path, JSON.stringify(value));
  } catch {
    throw new Error("This phone is out of space, so it wasn't saved.");
  }
}

const snapshot = (path: string): DocSnapshot => {
  const data = read(path);
  return { id: path.split("/").pop() ?? "", exists: data !== undefined, data: () => data };
};

let counter = 0;
const newId = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function doc(path: string): DocRef {
  return {
    id: path.split("/").pop() ?? "",
    get: async () => snapshot(path),
    set: async (data) => write(path, { ...data }),
    update: async (data) => write(path, { ...read(path), ...data }),
    delete: async () => {
      try {
        localStorage.removeItem(PREFIX + path);
      } catch {
        // Nothing to remove.
      }
    },
    collection: (name) => collection(`${path}/${name}`),
  };
}

function collection(path: string): CollectionRef {
  return {
    doc: (id) => doc(`${path}/${id ?? newId()}`),
    get: async () => {
      const docs: DocSnapshot[] = [];
      const start = `${PREFIX}${path}/`;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(start) && !key.slice(start.length).includes("/")) {
          docs.push(snapshot(key.slice(PREFIX.length)));
        }
      }
      return { docs };
    },
  };
}

export const localDb: Db = { doc };
