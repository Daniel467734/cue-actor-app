// Local-only persistence: IndexedDB for scripts/sessions/recordings, localStorage for settings.

const DB_NAME = 'cue-db';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('scripts', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('recordings', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const res = fn(t.objectStore(store));
    t.oncomplete = () => resolve(res && 'result' in res ? res.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  getAll: (store) => tx(store, 'readonly', (s) => s.getAll()),
  delete: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
};

export async function saveScript(script) {
  script.updatedAt = Date.now();
  await db.put('scripts', script);
  return script;
}
export const getScript = (id) => db.get('scripts', id);
export async function listScripts() {
  return (await db.getAll('scripts')).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteScript(id) {
  const sessions = await sessionsFor(id);
  await Promise.all(sessions.map((s) => deleteSession(s.id)));
  await db.delete('scripts', id);
}

export const saveSession = (s) => db.put('sessions', s);
export async function sessionsFor(scriptId) {
  return (await db.getAll('sessions')).filter((s) => s.scriptId === scriptId).sort((a, b) => a.startedAt - b.startedAt);
}
export async function deleteSession(id) {
  await db.delete('recordings', id);
  await db.delete('sessions', id);
}
export const saveRecording = (id, blob) => db.put('recordings', { id, blob });
export async function getRecording(id) {
  return (await db.get('recordings', id))?.blob;
}

const DEFAULTS = {
  strictness: 2,
  promptDelay: 6,
  hideMode: 'show', // show | first | hidden | learn
  selftape: false,
  speechRate: 1,
  readDirections: false,
  record: true,
  sttEngine: 'auto',
  cueGap: 0,
  lang: 'en-US',
  narratorURI: '',
  expressive: true,
  sound: true,
};

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('cue-settings') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem('cue-settings', JSON.stringify(next));
  return next;
}

export async function exportBackup() {
  const [scripts, sessions] = await Promise.all([db.getAll('scripts'), db.getAll('sessions')]);
  return JSON.stringify({ app: 'cue', version: 1, exportedAt: Date.now(), settings: getSettings(), scripts, sessions }, null, 1);
}

export async function importBackup(json) {
  const data = JSON.parse(json);
  if (data.app !== 'cue') throw new Error('This is not a Cue backup file.');
  for (const s of data.scripts || []) await db.put('scripts', s);
  for (const s of data.sessions || []) await db.put('sessions', { ...s, hasRecording: false });
  if (data.settings) localStorage.setItem('cue-settings', JSON.stringify(data.settings));
  return { scripts: (data.scripts || []).length, sessions: (data.sessions || []).length };
}
