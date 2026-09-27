// Shared team list on Supabase. The app keeps working from its on-phone copy; every change is
// queued in an outbox and uploaded when there is signal, so calls logged while driving are never lost.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import type { Call, Prospect } from './lib';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb: SupabaseClient | null = cloudEnabled ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export interface Member { email: string; name: string; role: 'owner' | 'caller' }

type Op =
  | { t: 'up'; id: number; data: Omit<Prospect, 'calls'> }
  | { t: 'del'; id: number }
  | { t: 'call'; id: number; prospect_id: number; at: number; data: Omit<Call, 'id' | 'by' | 'at'>; by_name: string };

const OUTBOX_KEY = 'monarch-outbox';
const readOutbox = (): Op[] => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } };
const writeOutbox = (ops: Op[]) => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops)); } catch { /* ignore */ } };
export const pendingCount = () => readOutbox().length;

export const callId = (c: Call) => c.id ?? c.at;
const stripCalls = ({ calls: _calls, ...rest }: Prospect) => rest;

/** Turns the difference between two versions of the list into upload operations. */
export function diffOps(prev: Prospect[], next: Prospect[], byName: string): Op[] {
  const ops: Op[] = [];
  const before = new Map(prev.map(p => [p.id, p]));
  const nextIds = new Set(next.map(p => p.id));
  for (const p of prev) if (!nextIds.has(p.id)) ops.push({ t: 'del', id: p.id });
  for (const p of next) {
    const old = before.get(p.id);
    if (!old || JSON.stringify(stripCalls(old)) !== JSON.stringify(stripCalls(p))) ops.push({ t: 'up', id: p.id, data: stripCalls(p) });
    const known = new Set((old?.calls || []).map(callId));
    for (const c of p.calls) {
      if (known.has(callId(c))) continue;
      const { id: _id, by: _by, at, ...data } = c;
      ops.push({ t: 'call', id: callId(c), prospect_id: p.id, at, data, by_name: c.by || byName });
    }
  }
  return ops;
}

export function enqueue(ops: Op[]) { if (ops.length) writeOutbox([...readOutbox(), ...ops]); }

let flushing: Promise<string | null> | null = null;
/** Uploads queued changes in order. Stops at the first network failure and keeps the rest for later. Returns an error message for rejected changes. */
export function flush(): Promise<string | null> {
  if (!sb) return Promise.resolve(null);
  if (!flushing) flushing = (async () => {
    let rejected: string | null = null;
    for (;;) {
      const box = readOutbox(); if (!box.length) break;
      // Consecutive prospect saves (or call logs) go up together in one request.
      const t = box[0].t;
      let n = 1;
      if (t !== 'del') while (n < box.length && n < 200 && box[n].t === t) n++;
      const batch = box.slice(0, n);
      const { error } = t === 'del' ? await sb.from('prospects').delete().eq('id', batch[0].id)
        : t === 'up' ? await sb.from('prospects').upsert(dedupe(batch as Extract<Op, { t: 'up' }>[]).map(o => ({ id: o.id, data: o.data, updated_at: new Date().toISOString() })))
        : await sb.from('calls').upsert(dedupe(batch as Extract<Op, { t: 'call' }>[]).map(o => ({ id: o.id, prospect_id: o.prospect_id, at: o.at, data: o.data, by_name: o.by_name })), { onConflict: 'id', ignoreDuplicates: true });
      if (error && /fetch|network|timeout/i.test(error.message)) break;
      if (error) rejected = error.message;
      writeOutbox(readOutbox().slice(n));
    }
    flushing = null;
    return rejected;
  })();
  return flushing;
}

/** Postgres rejects an upsert that touches the same row twice, so keep only the latest op per id. */
function dedupe<T extends { id: number }>(ops: T[]): T[] {
  const last = new Map(ops.map(o => [o.id, o]));
  return [...last.values()];
}

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb!.from(table).select(cols).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** The whole team list from the server, with any changes still waiting in this phone's outbox applied on top. */
export async function loadTeamList(): Promise<Prospect[]> {
  const [rows, calls] = await Promise.all([
    fetchAll<{ id: number; data: Omit<Prospect, 'calls'> }>('prospects', 'id,data'),
    fetchAll<{ id: number; prospect_id: number; at: number; data: Omit<Call, 'id' | 'by' | 'at'>; by_name: string }>('calls', 'id,prospect_id,at,data,by_name'),
  ]);
  const byProspect = new Map<number, Call[]>();
  for (const c of calls) {
    const list = byProspect.get(c.prospect_id) || [];
    list.push({ ...c.data, id: c.id, at: c.at, by: c.by_name });
    byProspect.set(c.prospect_id, list);
  }
  const list: Prospect[] = rows.map(r => ({ ...r.data, id: r.id, calls: (byProspect.get(r.id) || []).sort((a, b) => b.at - a.at) }));
  return applyPending(list);
}

function applyPending(list: Prospect[]): Prospect[] {
  const map = new Map(list.map(p => [p.id, p]));
  for (const op of readOutbox()) {
    if (op.t === 'del') map.delete(op.id);
    else if (op.t === 'up') map.set(op.id, { ...op.data, id: op.id, calls: map.get(op.id)?.calls || [] });
    else {
      const p = map.get(op.prospect_id);
      if (p && !p.calls.some(c => callId(c) === op.id)) map.set(p.id, { ...p, calls: [{ ...op.data, id: op.id, at: op.at, by: op.by_name }, ...p.calls].sort((a, b) => b.at - a.at) });
    }
  }
  const order = new Map(list.map((p, i) => [p.id, i]));
  return [...map.values()].sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
}

// ---- auth & team ----
export const getSession = async (): Promise<Session | null> => (sb ? (await sb.auth.getSession()).data.session : null);
export const onAuth = (cb: (s: Session | null) => void) => sb?.auth.onAuthStateChange((_e, s) => cb(s)).data.subscription;

const friendly = (msg: string) =>
  /NOT_ON_TEAM|Database error saving new user/i.test(msg) ? "This email isn't on the team yet. Ask Larry to add you."
  : /Invalid login/i.test(msg) ? 'Wrong email or password.'
  : /already registered/i.test(msg) ? 'You already have a password. Use Sign in instead.'
  : /Email not confirmed/i.test(msg) ? 'Open the confirmation email we sent you, then sign in.'
  : /Password should be/i.test(msg) ? 'Use a password with at least 6 characters.'
  : /fetch|network/i.test(msg) ? 'No connection. Try again when you have signal.'
  : msg;

export async function signIn(email: string, password: string, create: boolean): Promise<string | null> {
  if (!sb) return null;
  const e = email.trim().toLowerCase();
  const { data, error } = create ? await sb.auth.signUp({ email: e, password }) : await sb.auth.signInWithPassword({ email: e, password });
  if (error) return friendly(error.message);
  if (create && !data.session) return 'Check your email and tap the confirmation link, then sign in.';
  return null;
}
export const signOut = async () => { await sb?.auth.signOut(); };

export async function loadMe(email: string): Promise<Member | null> {
  const { data } = await sb!.from('team').select('email,name,role').eq('email', email.toLowerCase()).maybeSingle();
  return (data as Member) || null;
}
export async function loadTeam(): Promise<Member[]> {
  const { data, error } = await sb!.from('team').select('email,name,role').order('added_at');
  if (error) throw error;
  return data as Member[];
}
export async function addMember(name: string, email: string): Promise<string | null> {
  const { error } = await sb!.from('team').insert({ name: name.trim(), email: email.trim().toLowerCase(), role: 'caller' });
  return error ? (/duplicate/i.test(error.message) ? 'That email is already on the team.' : friendly(error.message)) : null;
}
export async function removeMember(email: string): Promise<string | null> {
  const { error } = await sb!.from('team').delete().eq('email', email);
  return error ? friendly(error.message) : null;
}
