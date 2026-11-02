// Local storage on the phone (IndexedDB). Nothing leaves the device from here.

const DB_NAME = "kapsa";
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.addEventListener("upgradeneeded", () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cards")) {
        db.createObjectStore("cards", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
      if (!db.objectStoreNames.contains("osm")) {
        db.createObjectStore("osm");
      }
    });
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
  return dbPromise;
}

/**
 * Run one request in a transaction and resolve with its result.
 * @param {string} store
 * @param {IDBTransactionMode} mode
 * @param {(s: IDBObjectStore) => IDBRequest} fn
 */
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.addEventListener("complete", () => resolve(req.result));
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () => reject(tx.error));
  });
}

export const cardsStore = {
  all: () => run("cards", "readonly", (s) => s.getAll()),
  put: (card) => run("cards", "readwrite", (s) => s.put(card)),
  remove: (id) => run("cards", "readwrite", (s) => s.delete(id)),
  clear: () => run("cards", "readwrite", (s) => s.clear()),
};

export const kv = {
  get: (key) => run("kv", "readonly", (s) => s.get(key)),
  set: (key, value) => run("kv", "readwrite", (s) => s.put(value, key)),
  clear: () => run("kv", "readwrite", (s) => s.clear()),
};

export const osmCache = {
  get: (key) => run("osm", "readonly", (s) => s.get(key)),
  set: (key, value) => run("osm", "readwrite", (s) => s.put(value, key)),
  clear: () => run("osm", "readwrite", (s) => s.clear()),
};

/** Ask the browser not to evict our data when storage runs low. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported: data is still kept, just with normal eviction rules.
  }
}

/** Short random id. */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
