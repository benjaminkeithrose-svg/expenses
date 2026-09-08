// Everything lives on the phone, in IndexedDB. Nothing is sent anywhere.

const DB = "receipts";
const VERSION = 1;

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("img")) db.createObjectStore("img");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getState = () => tx("kv", "readonly", (s) => s.get("state"));
export const putState = (v) => tx("kv", "readwrite", (s) => s.put(v, "state"));

export const putImage = (id, rec) => tx("img", "readwrite", (s) => s.put(rec, id));
export const getImage = (id) => tx("img", "readonly", (s) => s.get(id));
export const delImage = (id) => tx("img", "readwrite", (s) => s.delete(id));
export const clearImages = () => tx("img", "readwrite", (s) => s.clear());

/**
 * Ask the browser not to evict this data when storage runs low. Without it,
 * a phone under pressure can quietly bin the receipts before you export.
 */
export async function persist() {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usedMB: usage / 1e6, quotaMB: quota / 1e6 };
}
