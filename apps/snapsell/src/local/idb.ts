/** Tiny IndexedDB key-value store: keeps listings, settings and photos on this device. */
const DB = "snapsell";
const STORE = "kv";

let db: Promise<IDBDatabase> | null = null;
function open() {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  get: <T>(key: string) => run<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run("readwrite", (s) => s.put(value, key)),
  del: (key: string) => run("readwrite", (s) => s.delete(key)),
  keys: () => run<IDBValidKey[]>("readonly", (s) => s.getAllKeys()),
};
