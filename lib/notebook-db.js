const DB_NAME = "geo-meta-trainer";
const STORE = "rounds";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    fn(store, (v) => { out = v; });
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

export function putRound(round) {
  return tx("readwrite", (s) => s.put(round));
}

export function getRound(id) {
  return tx("readonly", (s, set) => { const r = s.get(id); r.onsuccess = () => set(r.result); });
}

export function allRounds() {
  return tx("readonly", (s, set) => {
    const r = s.getAll();
    r.onsuccess = () => set([...r.result].sort((a, b) => b.ts - a.ts));
  });
}

export function deleteRound(id) {
  return tx("readwrite", (s) => s.delete(id));
}

export function clearRounds() {
  return tx("readwrite", (s) => s.clear());
}

export function importRounds(rounds) {
  return tx("readwrite", (s) => { for (const r of rounds) s.put(r); });
}
