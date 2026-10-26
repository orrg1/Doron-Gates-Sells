// ─── Priority from the browser: diagnostics only ─────────────────────
// Syncing runs on the server (Edge Function "priority-sync", shared logic in
// src/core/priorityPull.js). The browser only asks the read-only proxy
// ("priority") for the field lists, for troubleshooting.
import { supabase } from './cloud.js';
import { SYNC_FORMS } from './core/priorityPull.js';

const call = async (body) => {
  const { data, error } = await supabase.functions.invoke('priority', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

export const pingPriority = () => call({ action: 'ping' });
// The real field lists of every form the sync uses.
export const describeAll = async () => (await call({ action: 'describe', forms: SYNC_FORMS })).forms;
