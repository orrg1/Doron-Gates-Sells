import React, { useEffect, useState } from 'react';
import App from './App.jsx';
import { supabase, hydrate, subscribeStatus, flushAll, stopSync } from './cloud.js';

// Sign-in with Google → check the email is allowed → pull the server data into
// this browser → mount the app. "Local mode" keeps the old browser-only behaviour.
const dark = () => { try { return localStorage.getItem('theme') === 'dark'; } catch { return false; } };

const Shell = ({ children }) => (
  <div dir="rtl" className={`min-h-screen flex items-center justify-center p-6 ${dark() ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-800'}`}>
    <div className={`w-full max-w-md rounded-2xl border p-8 shadow-sm ${dark() ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold">B</div>
        <div><p className="font-bold text-lg leading-tight">BizData</p><p className="text-sm opacity-60">דורון שערים</p></div>
      </div>
      {children}
    </div>
  </div>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
);

function CloudBadge({ email, isAdmin, onSignOut }) {
  const [st, setSt] = useState({ state: 'off' });
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => subscribeStatus(setSt), []);
  useEffect(() => {
    const warn = (e) => { if (st.pending > 0) { e.preventDefault(); e.returnValue = ''; } };
    const hide = () => { if (document.visibilityState === 'hidden') flushAll(); };
    window.addEventListener('beforeunload', warn); document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', hide); };
  }, [st.pending]);
  const loadUsers = async () => { const { data, error } = await supabase.from('allowed_users').select('email,role').order('email'); if (error) setErr(error.message); else setUsers(data); };
  const addUser = async (e) => {
    e.preventDefault(); setErr('');
    const em = newEmail.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setErr('כתובת מייל לא תקינה'); return; }
    const { error } = await supabase.from('allowed_users').insert({ email: em, role: 'member' });
    if (error) setErr(error.message); else { setNewEmail(''); loadUsers(); }
  };
  const removeUser = async (em) => { if (em === email) return; const { error } = await supabase.from('allowed_users').delete().eq('email', em); if (error) setErr(error.message); else loadUsers(); };
  const label = st.state === 'saving' ? 'שומר לשרת…' : st.state === 'error' ? 'שמירה לשרת נכשלה — ינסה שוב' : st.state === 'saved' ? `נשמר בשרת${st.lastSaved ? ' · ' + new Date(st.lastSaved).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : ''}` : 'מחובר';
  const dot = st.state === 'saving' ? '#D9822B' : st.state === 'error' ? '#C8322B' : st.state === 'saved' ? '#2E8B57' : '#8A919E';
  const d = dark();
  return (
    <div dir="rtl" className="fixed bottom-7 left-24 z-40 max-w-[220px]">
      <button type="button" onClick={() => { setOpen(o => !o); if (!open && isAdmin) loadUsers(); }} aria-expanded={open} aria-label={`מצב שמירה: ${label}`} title={st.message || label}
        className={`flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-semibold shadow-sm ${d ? 'bg-slate-800 border-slate-600 text-slate-200' : 'bg-white border-slate-200 text-slate-700'}`}>
        <span className="w-2 h-2 rounded-full" style={{ background: dot }} />{label}
      </button>
      {open && (
        <div className={`absolute bottom-12 left-0 w-80 rounded-xl border shadow-2xl p-4 space-y-3 text-sm ${d ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-700'}`}>
          <div>
            <p className="font-bold">{email}</p>
            <p className="text-xs opacity-70">הנתונים נשמרים בשרת ומסונכרנים בין המחשבים</p>
            {st.state === 'error' && <p className="text-xs mt-1 font-semibold text-red-600">{st.message}</p>}
          </div>
          {isAdmin && users && (
            <div className="space-y-2">
              <p className="font-semibold text-xs">מי יכול להיכנס</p>
              {users.map(u => (
                <div key={u.email} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate">{u.email}</span>
                  <span className="opacity-60">{u.role === 'admin' ? 'מנהל' : 'משתמש'}</span>
                  {u.email !== email && <button type="button" onClick={() => removeUser(u.email)} className="text-red-600 font-semibold hover:underline">הסר</button>}
                </div>
              ))}
              <form onSubmit={addUser} className="flex gap-2">
                <label htmlFor="new-user-email" className="sr-only">מייל להוספה</label>
                <input id="new-user-email" type="email" dir="ltr" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="name@gmail.com"
                  className={`flex-1 px-2 py-1.5 rounded-lg border text-xs ${d ? 'bg-slate-900 border-slate-600' : 'border-slate-300'}`} />
                <button type="submit" className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold">הוסף</button>
              </form>
              {err && <p className="text-xs text-red-600">{err}</p>}
            </div>
          )}
          <button type="button" onClick={onSignOut} className={`w-full py-2 rounded-lg border text-xs font-semibold ${d ? 'border-slate-600 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-50'}`}>{email ? 'התנתק' : 'התחבר עם Google'}</button>
        </div>
      )}
    </div>
  );
}

// The server sync (nightly, or started on another computer) finished after this
// page loaded: offer a refresh — or just refresh when the person comes back to the tab.
function NewDataNotice() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const loadedAt = Date.now();
    let pendingReload = false;
    const check = async () => {
      const { data } = await supabase.from('sync_jobs').select('finished_at').eq('status', 'done').order('finished_at', { ascending: false }).limit(1);
      const t = data?.[0]?.finished_at ? new Date(data[0].finished_at).getTime() : 0;
      if (t > loadedAt + 5000) {
        if (document.visibilityState === 'hidden') pendingReload = true; else setFresh(true);
      }
    };
    const onVis = async () => { if (document.visibilityState === 'visible' && pendingReload) { await flushAll(); window.location.reload(); } };
    const id = setInterval(() => { check().catch(() => {}); }, 180000);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!fresh) return null;
  return (
    <div dir="rtl" role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg bg-blue-600 text-white text-sm">
      <span>יש נתונים חדשים מ-Priority</span>
      <button type="button" onClick={async () => { await flushAll(); window.location.reload(); }} className="px-3 py-1 rounded-lg bg-white text-blue-700 font-semibold">רענן</button>
    </div>
  );
}

export default function AuthGate() {
  const [phase, setPhase] = useState('checking'); // checking | login | denied | hydrating | ready | error
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.removeItem('cloudLocalMode'); } catch { /* old local-mode flag */ }
    let done = false;
    const start = async (session) => {
      if (done) return;
      if (!session) { setPhase('login'); return; }
      done = true;
      const em = (session.user?.email || '').toLowerCase();
      setEmail(em);
      try {
        const { data, error: e } = await supabase.from('allowed_users').select('role').eq('email', em).maybeSingle();
        if (e) throw e;
        if (!data) { setPhase('denied'); return; }
        setIsAdmin(data.role === 'admin');
        setPhase('hydrating');
        const res = await hydrate(em, setProgress);
        if (res.migrated) setProgress('');
        setPhase('ready');
      } catch (err) { setError(err.message || String(err)); setPhase('error'); }
    };
    supabase.auth.getSession().then(({ data }) => start(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => { if (evt === 'SIGNED_IN') start(session); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    setError('');
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
    if (e) setError(e.message);
  };
  const signOut = async () => {
    await flushAll(); stopSync(); await supabase.auth.signOut(); window.location.reload();
  };

  if (phase === 'ready') return (<><App /><CloudBadge email={email} isAdmin={isAdmin} onSignOut={signOut} /><NewDataNotice /></>);

  if (phase === 'checking' || phase === 'hydrating') return (
    <Shell>
      <p className="font-semibold">{phase === 'checking' ? 'מתחבר…' : 'טוען את הנתונים שלך…'}</p>
      <p className="text-sm opacity-70 mt-1">{progress}</p>
      <div className="mt-4 h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full w-1/3 bg-blue-600 animate-pulse rounded-full" /></div>
    </Shell>
  );

  if (phase === 'denied') return (
    <Shell>
      <p className="font-bold text-lg">אין הרשאה</p>
      <p className="text-sm mt-2 opacity-80">החשבון <b dir="ltr">{email}</b> לא ברשימת המורשים. בקש ממנהל המערכת להוסיף אותו.</p>
      <button type="button" onClick={signOut} className="mt-5 w-full py-2.5 rounded-xl border border-slate-300 font-semibold">התחבר עם חשבון אחר</button>
    </Shell>
  );

  if (phase === 'error') return (
    <Shell>
      <p className="font-bold text-lg">לא הצלחתי לטעון מהשרת</p>
      <p className="text-sm mt-2 opacity-80 break-words" dir="auto">{error}</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-5 w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold">נסה שוב</button>
    </Shell>
  );

  return (
    <Shell>
      <h1 className="text-xl font-bold">כניסה</h1>
      <p className="text-sm mt-1 opacity-70">הנתונים נשמרים בשרת — אותו מידע בכל מחשב, בלי להעלות קבצים מחדש.</p>
      <button type="button" onClick={signIn} className="mt-6 w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-slate-300 bg-white text-slate-800 font-semibold hover:bg-slate-50">
        <GoogleIcon /> התחבר עם Google
      </button>
      {error && <p className="text-sm mt-3 text-red-600" dir="auto">{error}</p>}
    </Shell>
  );
}
