/* ------------------------------------------------------------------
   Storage bootstrap.

   CreatorTools persists everything in IndexedDB. Some contexts block it
   entirely (sandboxed iframes with an opaque origin, strict private
   modes, some managed browsers). Rather than showing a dead screen, we
   fall back to an in-memory IndexedDB implementation and tell the user
   plainly that nothing will be saved.
   ------------------------------------------------------------------ */

export type StorageMode = 'persistent' | 'memory' | 'unknown';

let mode: StorageMode = 'unknown';
let initialised = false;

export const storageMode = () => mode;
export const isEphemeral = () => mode === 'memory';

async function nativeIndexedDbWorks(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (value: boolean) => { if (!done) { done = true; resolve(value); } };
    try {
      const req = indexedDB.open('__creatortools_probe__');
      req.onsuccess = () => {
        try { req.result.close(); indexedDB.deleteDatabase('__creatortools_probe__'); } catch { /* ignore */ }
        finish(true);
      };
      req.onerror = () => finish(false);
      req.onblocked = () => finish(false);
      setTimeout(() => finish(false), 3000);
    } catch {
      finish(false);
    }
  });
}

/** Must run before any Dexie database is opened. */
export async function bootstrapStorage(): Promise<StorageMode> {
  if (initialised) return mode;
  initialised = true;
  if (await nativeIndexedDbWorks()) {
    mode = 'persistent';
    return mode;
  }
  try {
    await import('fake-indexeddb/auto');
    // Some environments expose a `window` distinct from `globalThis`
    // (test harnesses, certain embedded webviews) — mirror the shim across.
    const keys = ['indexedDB', 'IDBKeyRange', 'IDBTransaction', 'IDBDatabase', 'IDBFactory', 'IDBOpenDBRequest', 'IDBRequest', 'IDBCursor', 'IDBCursorWithValue', 'IDBIndex', 'IDBObjectStore', 'IDBVersionChangeEvent'];
    {
      const w = (typeof window !== 'undefined' ? window : {}) as any;
      const gt = globalThis as any;
      keys.forEach((k) => {
        // Dexie resolves its dependencies from globalThis at import time; the
        // shim installs onto `window`. Keep both sides populated.
        if (!gt[k] && w[k]) gt[k] = w[k];
        if (!w[k] && gt[k]) w[k] = gt[k];
      });
    }
    mode = 'memory';
  } catch {
    mode = 'memory';
  }
  return mode;
}
