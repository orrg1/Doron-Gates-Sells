// ─── Cloud sync (Supabase) ──────────────────────────────────────────
// The app keeps working exactly as before against localStorage + IndexedDB.
// This module mirrors those two stores to Supabase:
//   • localStorage keys  → table app_state (one row per key)
//   • IndexedDB datasets → gzip files in the private "datasets" bucket,
//                          indexed by table datasets (so a device only
//                          downloads what actually changed)
// On sign-in, hydrate() pulls the server copy into the local stores BEFORE
// the app mounts; after that, every local write is queued and pushed.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://nrkdncrzvmlmjsnbxrgx.supabase.co';
// Publishable key — safe to ship in the browser; access is enforced by
// row-level security (only emails in allowed_users can read or write).
export const SUPABASE_KEY = 'sb_publishable_EcMpumpF4BKVOQPADjjU7w_58TTB5L6';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// Keys that must stay on this device only.
const LOCAL_ONLY = new Set(['geminiApiKey', 'theme', 'procurementColWidths', 'backupReminderSnoozedUntil', 'lastBackupDate', 'cloudLocalMode']);
const isSyncedKey = (k) => typeof k === 'string' && !LOCAL_ONLY.has(k) && !k.startsWith('sb-') && !k.startsWith('__cloud');
const isSyncedDataset = (k) => typeof k === 'string' && !k.startsWith('_trash_');

const IDB_NAME = 'BizDataProDB', IDB_STORE = 'kv';
const idb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(IDB_NAME, 1);
  req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const idbTx = async (mode, fn) => {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const out = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });
};
const idbPutRaw = (k, v) => idbTx('readwrite', s => s.put(v, k));
const idbKeysRaw = () => idbTx('readonly', s => s.getAllKeys());
const idbGetRaw = (k) => idbTx('readonly', s => s.get(k));

// ── status, for the small indicator in the corner ──
let status = { state: 'off', pending: 0, lastSaved: null, message: '' };
const listeners = new Set();
const setStatus = (patch) => { status = { ...status, ...patch }; listeners.forEach(fn => fn(status)); };
export const subscribeStatus = (fn) => { listeners.add(fn); fn(status); return () => listeners.delete(fn); };

let enabled = false;
let userEmail = '';
const origSet = Storage.prototype.setItem;
const origRemove = Storage.prototype.removeItem;
const lsSetRaw = (k, v) => origSet.call(window.localStorage, k, v);
const lsRemoveRaw = (k) => origRemove.call(window.localStorage, k);

// cheap content fingerprint, so re-saving identical data never re-uploads
const fingerprint = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ':' + str.length; };

// ── small state (localStorage) ──
const lastCloudValue = new Map();
const pendingState = new Map();
let stateTimer = null;
const updatePending = () => setStatus({ pending: pendingState.size + pendingSets.size, state: (pendingState.size + pendingSets.size) ? 'saving' : status.state === 'saving' ? 'saved' : status.state });
const queueState = (key, value) => {
  if (!enabled || !isSyncedKey(key)) return;
  if (value !== null && lastCloudValue.get(key) === value) return;
  if (value === null && !lastCloudValue.has(key)) return;
  pendingState.set(key, value); updatePending();
  clearTimeout(stateTimer); stateTimer = setTimeout(flushState, 800);
};
async function flushState() {
  const entries = [...pendingState]; pendingState.clear();
  if (!entries.length) return;
  const now = new Date().toISOString();
  const ups = entries.filter(([, v]) => v !== null).map(([key, value]) => ({ key, value, updated_at: now, updated_by: userEmail }));
  const dels = entries.filter(([, v]) => v === null).map(([k]) => k);
  try {
    if (ups.length) { const { error } = await supabase.from('app_state').upsert(ups); if (error) throw error; }
    if (dels.length) { const { error } = await supabase.from('app_state').delete().in('key', dels); if (error) throw error; }
    ups.forEach(u => lastCloudValue.set(u.key, u.value)); dels.forEach(k => lastCloudValue.delete(k));
    setStatus({ state: 'saved', lastSaved: Date.now(), message: '' }); updatePending();
  } catch (e) {
    entries.forEach(([k, v]) => { if (!pendingState.has(k)) pendingState.set(k, v); });
    setStatus({ state: 'error', message: e.message || 'שמירה לשרת נכשלה' }); updatePending();
    clearTimeout(stateTimer); stateTimer = setTimeout(flushState, 15000);
  }
}

// ── big datasets (IndexedDB) ──
const pendingSets = new Map();
const dsTimers = new Map();
export const queueDataset = (key, value) => {
  if (!enabled || !isSyncedDataset(key)) return;
  pendingSets.set(key, value); updatePending();
  clearTimeout(dsTimers.get(key));
  dsTimers.set(key, setTimeout(() => flushDataset(key), 1500));
};
const gzip = async (str) => {
  if (typeof CompressionStream === 'undefined') return { blob: new Blob([str], { type: 'application/json' }), gz: false };
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(cs).blob(), gz: true };
};
const gunzipText = async (blob, gz) => {
  if (!gz) return blob.text();
  const ds = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).text();
};
async function flushDataset(key) {
  if (!pendingSets.has(key)) return;
  const value = pendingSets.get(key); pendingSets.delete(key);
  try {
    if (value === null || value === undefined) {
      const { data } = await supabase.from('datasets').select('path').eq('key', key).maybeSingle();
      if (data) { await supabase.storage.from('datasets').remove([data.path]); await supabase.from('datasets').delete().eq('key', key); }
      lsRemoveRaw('__cloudVer:' + key); lsRemoveRaw('__cloudHash:' + key);
    } else {
      const json = JSON.stringify(value);
      const fp = fingerprint(json);
      if (window.localStorage.getItem('__cloudHash:' + key) !== fp) {
        const { blob, gz } = await gzip(json);
        const path = `${key}.json${gz ? '.gz' : ''}`;
        const up = await supabase.storage.from('datasets').upload(path, blob, { upsert: true, contentType: gz ? 'application/gzip' : 'application/json', cacheControl: '0' });
        if (up.error) throw up.error;
        const updated_at = new Date().toISOString();
        const { error } = await supabase.from('datasets').upsert({ key, path, bytes: blob.size, rows: Array.isArray(value) ? value.length : null, updated_at, updated_by: userEmail });
        if (error) throw error;
        lsSetRaw('__cloudVer:' + key, updated_at); lsSetRaw('__cloudHash:' + key, fp);
      }
    }
    lsSetRaw('lastBackupDate', new Date().toISOString()); // the server copy is the backup now
    setStatus({ state: 'saved', lastSaved: Date.now(), message: '' }); updatePending();
  } catch (e) {
    if (!pendingSets.has(key)) pendingSets.set(key, value);
    setStatus({ state: 'error', message: e.message || 'העלאה לשרת נכשלה' }); updatePending();
    clearTimeout(dsTimers.get(key)); dsTimers.set(key, setTimeout(() => flushDataset(key), 20000));
  }
}

// Intercept localStorage writes (only for window.localStorage, never sessionStorage).
let patched = false;
const patchStorage = () => {
  if (patched) return; patched = true;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === window.localStorage) queueState(k, String(v)); };
  Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === window.localStorage) queueState(k, null); };
};

// Pull the server copy into this browser (server wins), or — on first use when
// the server is still empty — upload what this browser already has.
export async function hydrate(email, onProgress = () => {}) {
  userEmail = email || '';
  enabled = false;
  onProgress('בודק נתונים בשרת…');
  const [{ data: rows, error: e1 }, { data: sets, error: e2 }] = await Promise.all([
    supabase.from('app_state').select('key,value'),
    supabase.from('datasets').select('key,path,updated_at,bytes'),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const localKeys = Object.keys(window.localStorage).filter(isSyncedKey);
  let idbKeys = [];
  try { idbKeys = (await idbKeysRaw()).filter(isSyncedDataset); } catch { /* no IndexedDB */ }

  if (!rows.length && !sets.length) {
    // First sign-in: move this browser's data to the server.
    patchStorage(); enabled = true;
    if (localKeys.length || idbKeys.length) onProgress('מעביר את הנתונים מהדפדפן לשרת…');
    localKeys.forEach(k => queueState(k, window.localStorage.getItem(k)));
    for (const k of idbKeys) { const v = await idbGetRaw(k); if (v != null) queueDataset(k, v); }
    setStatus({ state: (localKeys.length || idbKeys.length) ? 'saving' : 'saved', lastSaved: Date.now() });
    return { migrated: localKeys.length + idbKeys.length };
  }

  // Server has data — it wins.
  const cloudKeys = new Set(rows.map(r => r.key));
  rows.forEach(r => { lastCloudValue.set(r.key, r.value); lsSetRaw(r.key, r.value); });
  // Data that exists only in this browser is kept and uploaded — never deleted.
  const localOnlyKeys = localKeys.filter(k => !cloudKeys.has(k));
  const cloudSets = new Set(sets.map(s => s.key));
  let i = 0;
  for (const s of sets) {
    i++;
    if (window.localStorage.getItem('__cloudVer:' + s.key) === s.updated_at && idbKeys.includes(s.key)) continue;
    onProgress(`מוריד נתונים מהשרת (${i}/${sets.length})…`);
    const { data: blob, error } = await supabase.storage.from('datasets').download(s.path);
    if (error) throw error;
    const text = await gunzipText(blob, s.path.endsWith('.gz'));
    await idbPutRaw(s.key, JSON.parse(text));
    lsSetRaw('__cloudVer:' + s.key, s.updated_at); lsSetRaw('__cloudHash:' + s.key, fingerprint(text));
  }
  patchStorage(); enabled = true;
  localOnlyKeys.forEach(k => queueState(k, window.localStorage.getItem(k)));
  for (const k of idbKeys) if (!cloudSets.has(k)) { const v = await idbGetRaw(k); if (v != null && !(Array.isArray(v) && !v.length)) queueDataset(k, v); }
  lsSetRaw('lastBackupDate', new Date().toISOString());
  setStatus({ state: 'saved', lastSaved: Date.now(), message: '' });
  return { migrated: 0 };
}

export const stopSync = () => { enabled = false; setStatus({ state: 'off' }); };
// Flush anything queued (used before sign-out / page hide).
export const flushAll = async () => {
  clearTimeout(stateTimer); await flushState();
  for (const k of [...pendingSets.keys()]) { clearTimeout(dsTimers.get(k)); await flushDataset(k); }
};
