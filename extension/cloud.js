// Talks to the same Supabase project as the phone app, over plain REST (no build step needed).
// Sign-in uses the team email and password from the app; the database only lets team members read or write.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { normName, digits } from './extract.js';

const KEY = 'monarch-session';
const store = {
  get: async () => (await chrome.storage.local.get(KEY))[KEY] || null,
  set: v => chrome.storage.local.set({ [KEY]: v }),
  clear: () => chrome.storage.local.remove(KEY),
};

async function auth(grant, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || `Sign-in failed (${r.status})`);
  const s = { access: j.access_token, refresh: j.refresh_token, expires: (j.expires_at || Date.now() / 1000 + (j.expires_in || 3600)) * 1000, email: (j.user?.email || '').toLowerCase() };
  await store.set(s);
  return s;
}

export async function signIn(email, password) {
  try { await auth('password', { email: email.trim().toLowerCase(), password }); }
  catch (e) { throw new Error(/invalid login/i.test(e.message) ? 'Wrong email or password. Use the same ones as the phone app.' : e.message); }
  const me = await loadMe();
  if (!me) { await signOut(); throw new Error("This email isn't on the Monarch team."); }
  return me;
}
export const signOut = () => store.clear();

async function session() {
  let s = await store.get();
  if (!s) return null;
  if (s.expires - Date.now() < 60000) {
    try { s = await auth('refresh_token', { refresh_token: s.refresh }); } catch { await store.clear(); return null; }
  }
  return s;
}

async function rest(path, opts = {}) {
  const s = await session();
  if (!s) throw new Error('SIGNED_OUT');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) { await store.clear(); throw new Error('SIGNED_OUT'); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `Server error ${r.status}`); }
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json();
}

/** { email, name, role } for the signed-in person, or null when signed out / not on the team. */
export async function loadMe() {
  const s = await session();
  if (!s) return null;
  const rows = await rest(`team?select=email,name,role&email=eq.${encodeURIComponent(s.email)}`);
  return rows[0] || null;
}

/** Company, phone and city of everyone on the team list, for matching. */
export async function loadIndex() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await rest('prospects?select=id,company:data->>company,phone:data->>phone,city:data->>city&order=id', { headers: { Range: `${from}-${from + 999}` } });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export function findMatch(index, company, phone) {
  const k = normName(company), d = digits(phone);
  return index.find(p => k && normName(p.company) === k) || (d.length === 10 ? index.find(p => digits(p.phone) === d) : null) || null;
}

const upsert = rows => rest('prospects', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });

/** Adds a new prospect in the same shape the phone app uses. Returns its id. */
export async function addProspect(lead, byName) {
  const index = await loadIndex();
  // The owner's first sign-in on the phone uploads the starting list only when the team list is empty.
  if (!index.length) throw new Error('The team list is empty. Sign in on the phone app first so your prospects are uploaded, then try again.');
  const now = Date.now();
  const data = {
    id: now, company: lead.company.trim(), contact: '', title: '', phone: digits(lead.phone), email: '',
    type: lead.category, city: lead.city.trim(), address: '', interest: lead.interest, status: 'new', next: null,
    score: lead.score, size: '', top: lead.top, lead: lead.lead.trim(), notes: lead.notes.trim(),
    source: `Lead Finder (${byName || 'Chrome'})`, pinned: lead.top ? now : null, addedAt: now,
  };
  await upsert([{ id: now, data, updated_at: new Date().toISOString() }]);
  return now;
}

/** Puts new work on a prospect that is already on the list, the same way the daily briefing does. */
export async function updateProspect(id, lead) {
  const rows = await rest(`prospects?select=id,data&id=eq.${id}`);
  if (!rows.length) throw new Error('That prospect was removed from the list.');
  const p = rows[0].data;
  const notes = [p.notes, lead.notes.trim()].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' ');
  const data = {
    ...p, lead: lead.lead.trim() || p.lead, notes, phone: p.phone || digits(lead.phone), city: p.city || lead.city.trim(),
    score: Math.max(p.score || 0, lead.score || 0), top: !!(p.top || lead.top), pinned: lead.top ? Date.now() : p.pinned ?? null,
  };
  await upsert([{ id, data, updated_at: new Date().toISOString() }]);
}
