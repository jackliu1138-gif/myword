// Persistence: worlds (seed, player, edits...) in IndexedDB, one record per world, with a small
// list of them (name, mode, seed, when last played) and settings in localStorage.
// Storage can be unavailable (private windows, sandboxed frames); every call degrades quietly.

const DB_NAME = 'lumencraft';
const STORE = 'worlds';
const SETTINGS_KEY = 'lumencraft.settings.v1';
const INDEX_KEY = 'lumencraft.worlds.v1';
const CURRENT_KEY = 'lumencraft.currentWorld';

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadWorld(id = 'default') {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch (e) {
    try {
      const raw = localStorage.getItem('lumencraft.world.' + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e2) {
      return null;
    }
  }
}

export async function saveWorld(data, id = 'default') {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    try {
      localStorage.setItem('lumencraft.world.' + id, JSON.stringify(data));
      return true;
    } catch (e2) {
      return false;
    }
  }
}

export async function deleteWorld(id = 'default') {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) { /* ignore */ }
  try { localStorage.removeItem('lumencraft.world.' + id); } catch (e) { /* ignore */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- the list of worlds
// [{ id, name, mode, seed, savedAt }], newest first. Saves from before there was a list live
// under the id 'default' and are picked up the first time.
export async function listWorlds() {
  let list = readIndex();
  if (!list) {
    list = [];
    const old = await loadWorld('default');
    if (old && old.seed !== undefined) list.push({ id: 'default', name: '', mode: old.mode || 'creative', seed: old.seed, savedAt: old.savedAt || Date.now() });
    writeIndex(list);
  }
  return list.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((w) => w && typeof w.id === 'string') : null;
  } catch (e) {
    return null;
  }
}

function writeIndex(list) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

// Adds or updates a world in the list (after saving it).
export function noteWorld(entry) {
  const list = readIndex() || [];
  const i = list.findIndex((w) => w.id === entry.id);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  writeIndex(list);
}

export function forgetWorld(id) {
  writeIndex((readIndex() || []).filter((w) => w.id !== id));
}

export function newWorldId() {
  return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

// The world played last (it opens on the title screen).
export function currentWorldId() {
  try { return localStorage.getItem(CURRENT_KEY) || 'default'; } catch (e) { return 'default'; }
}

export function setCurrentWorldId(id) {
  try { localStorage.setItem(CURRENT_KEY, id); } catch (e) { /* ignore */ }
}
