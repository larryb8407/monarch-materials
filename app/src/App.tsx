import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  BRIEF_AT_KEY, BRIEF_SEEN_KEY, CLAUDE_BRIEF_PROMPT, DRIVE_AUTO_NEXT, OUTCOME, STATUS, STORAGE_KEY, callingNow, isReserved, recentlyCalled,
  ROUTE_HOME_KEY, ROUTE_KEY, OWNER_NAME, decorate, fetchAutoBrief, fmtPhone, placeOf, routeLegs, fmtTime, fmtWhen, isMobile, normName, parseCSV, queueList, rel, seedProspects, startOfToday, toProspect,
  type BriefItem, type Line, type StatusKey, type OutcomeKey, type Prospect,
} from './lib';
import { speechSupported, startRec, stopRec } from './speech';
import { addMember, reservedMatch, loadUserState, saveUserState, watchTeamChanges, cloudEnabled, diffOps, downloadBackup, enqueue, flush, mergeLocalOnce, snapshotLocal, getSession, loadMe, loadTeam, loadTeamList, onAuth, pendingCount, removeMember, signIn, signOut, type Member } from './cloud';
import bundledProspects from './prospects.json';
import logoUrl from './monarch-logo.webp';

type Screen = 'today' | 'prospects' | 'detail' | 'log' | 'route' | 'teamday' | 'mylist' | 'call' | 'wrap' | 'drive';
type Filter = 'all' | 'mine' | 'top' | 'new' | 'follow' | 'customer';
interface LiveCall { start: number; secs: number; lines: Line[] }
interface Wrap { outcome: OutcomeKey | null; follow: number | null; note: string; summary: string; attention?: boolean; attentionNote?: string; assignTo?: string; assignNote?: string }
interface Brief { step: 'input' | 'review'; text: string; busy: boolean; error: string; auto?: string; added?: BriefItem[]; updated?: (BriefItem & { id: number })[] }
interface AddForm { company?: string; contact?: string; phone?: string; city?: string; type: string; interest: string }

const loadProspects = (): Prospect[] => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(s)) return s;
  } catch { /* fall through to bundled list */ }
  return bundledProspects as Prospect[];
};
// A call that hasn't been saved yet survives the app being closed (e.g. Android unloading it while the dialer is up).
const DRAFT_KEY = 'monarch-call-draft';
interface Draft { activeId: number; call: LiveCall; wrap: Wrap | null; prev: Screen; wasDrive: boolean; savedAt: number }
const readDraft = (): Draft | null => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.call && d.activeId ? d : null; } catch { return null; } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
const draft0 = readDraft();

const readBriefAt = () => { try { return localStorage.getItem(BRIEF_AT_KEY); } catch { return null; } };
const readRoute = (): number[] => { try { const r = JSON.parse(localStorage.getItem(ROUTE_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
const MYLIST_KEY = 'monarch-mylist';
const readMyList = (): number[] => { try { const r = JSON.parse(localStorage.getItem(MYLIST_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
/** "Update without calling" panel on the prospect page. */
interface Upd { status: StatusKey; next: string | null; note: string; attention: boolean; attentionNote: string; assignTo: string; assignNote: string }
const readRouteHome = () => { try { return localStorage.getItem(ROUTE_HOME_KEY) !== '0'; } catch { return true; } };
const readSeen = () => { try { return localStorage.getItem(BRIEF_SEEN_KEY); } catch { return null; } };

const selBg = (on: boolean) => (on ? '#C9A45C' : '#1A1815');
const selFg = (on: boolean) => (on ? '#0E0D0B' : '#F2EEE6');

const PinIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>;

const Chip = ({ bg, fg, label }: { bg: string; fg: string; label: string }) => <span className="chip" style={{ background: bg, color: fg }}>{label}</span>;

const ProspectRow = ({ p, compact, onOpen, onCall, onRoute, routed, starred }: { p: Prospect; compact?: boolean; onOpen: (id: number) => void; onCall: (id: number) => void; onRoute: (id: number) => void; routed: boolean; starred?: boolean }) => {
  const d = decorate(p);
  return (
    <div className="prow card">
      <button className="btn prow-main" onClick={() => onOpen(p.id)}>
        <span className="prow-name" style={compact ? { fontSize: 17 } : undefined}>{starred && <span style={{ color: '#C9A45C' }}>★ </span>}{p.company}</span>
        <span className="prow-sub">{compact ? `${d.contact} · ${p.type} · ${p.city}` : `${d.contact} · ${p.city}`}</span>
        {compact
          ? <div className="row" style={{ gap: 8 }}><Chip bg={d.chipBg} fg={d.chipFg} label={d.statusLabel} /><span style={{ font: "500 12px/1 'Barlow',sans-serif", color: '#8A8276' }}>{d.lastLabel}</span></div>
          : <Chip bg={d.chipBg} fg={d.chipFg} label={d.statusLabel} />}
      </button>
      <button className="btn pin" aria-pressed={routed} aria-label={routed ? `Remove ${p.company} from route` : `Add ${p.company} to route`} onClick={() => onRoute(p.id)}><PinIcon /></button>
      <button className="btn call-dot" aria-label="Call" onClick={() => onCall(p.id)} style={compact ? { width: 54, height: 54 } : undefined}>CALL</button>
    </div>
  );
};


export default function App() {
  const [prospects, setProspects] = useState<Prospect[]>(loadProspects);
  const [screen, setScreen] = useState<Screen>(draft0 ? 'wrap' : 'today');
  const [prev, setPrev] = useState<Screen>(draft0 ? draft0.prev : 'today');
  const [activeId, setActiveId] = useState<number | null>(draft0 ? draft0.activeId : null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [call, setCall] = useState<LiveCall | null>(draft0 ? { ...draft0.call, secs: draft0.wrap ? draft0.call.secs : Math.round((draft0.savedAt - draft0.call.start) / 1000) } : null);
  const [interim, setInterim] = useState('');
  const [wrap, setWrap] = useState<Wrap | null>(draft0 ? draft0.wrap || { outcome: null, follow: null, note: '', summary: '' } : null);
  const [dictating, setDictating] = useState(false);
  const [driveIdx, setDriveIdx] = useState(0);
  const [voice, setVoice] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [add, setAdd] = useState<AddForm | null>(null);
  const [edit, setEdit] = useState<Prospect | null>(null);
  const [addMsg, setAddMsg] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefAt, setBriefAt] = useState<string | null>(readBriefAt);
  const [route, setRoute] = useState<number[]>(readRoute);
  const [upd, setUpd] = useState<Upd | null>(null);
  const [backToYard, setBackToYard] = useState(readRouteHome);
  const [candCity, setCandCity] = useState('');
  const [candMin, setCandMin] = useState(70);
  const [autoBrief, setAutoBrief] = useState<{ text: string; hash: string } | null>(null);
  // Team sign-in (only when a Supabase project is configured).
  const [authReady, setAuthReady] = useState(!cloudEnabled);
  const [email, setEmail] = useState<string | null>(null);
  const [me, setMe] = useState<Member | null>(null);
  const [meChecked, setMeChecked] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [account, setAccount] = useState(false);
  const [team, setTeam] = useState<Member[] | null>(null);
  const [logWho, setLogWho] = useState('');
  const [syncing, setSyncing] = useState(false);

  const timer = useRef<number | undefined>(undefined);
  const wasDrive = useRef(!!draft0?.wasDrive);
  const driveQueue = useRef<Prospect[] | null>(null);
  const driveIdxRef = useRef(0);
  driveIdxRef.current = driveIdx;

  const prospectsRef = useRef(prospects);
  const meRef = useRef<Member | null>(null);
  meRef.current = me;
  const isOwner = !cloudEnabled || me?.role === 'owner';

  // First launch on this phone: save the bundled list so edits persist from here on.
  useEffect(() => { if (!cloudEnabled) persist(prospects); }, []);

  // ---- team sign-in and sync ----
  useEffect(() => {
    if (!cloudEnabled) return;
    getSession().then(s => { setEmail(s?.user.email || null); setAuthReady(true); });
    const sub = onAuth(s => setEmail(s?.user.email || null));
    return () => sub?.unsubscribe();
  }, []);

  function showServerList(list: Prospect[]) {
    prospectsRef.current = list;
    setProspects(list);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }

  async function sync() {
    if (!meRef.current) return;
    const err = await flush();
    setPending(pendingCount());
    if (err) reportSyncError(err);
    try { await adopt(await loadTeamList(), meRef.current); } catch { /* offline: keep the on-phone copy */ }
    if (meRef.current.role === 'owner') loadTeam().then(setTeam).catch(() => {});
  }

  // Shows the team list; the first time, this phone's own earlier work (calls, added prospects) is merged in and uploaded.
  async function adopt(list: Prospect[], m: Member) {
    const merged = mergeLocalOnce(list, m, bundledProspects as Prospect[], normName);
    showServerList(merged || list);
    if (merged) { await flush(); setPending(pendingCount()); }
  }

  useEffect(() => {
    if (!cloudEnabled) return;
    if (!email) { setMe(null); setMeChecked(false); return; }
    snapshotLocal(STORAGE_KEY);
    let live = true;
    (async () => {
      const m = await loadMe(email).catch(() => null);
      if (!live) return;
      setMe(m); meRef.current = m; setMeChecked(true);
      if (!m) return;
      try {
        const list = await loadTeamList();
        await adopt(list, m);
        const st = await loadUserState();
        // Older versions kept the priority list in user_state; move it onto the prospects (once).
        if (live && st && Array.isArray(st.myList) && st.myList.length) setLegacyMine(st.myList);
        if (live && st && Array.isArray(st.route)) {
          setRoute(st.route); setBackToYard(st.backToYard !== false);
          try { localStorage.setItem(ROUTE_KEY, JSON.stringify(st.route)); localStorage.setItem(ROUTE_HOME_KEY, st.backToYard === false ? '0' : '1'); } catch { /* ignore */ }
        }
      } catch { /* offline: keep the on-phone copy until the next sync */ }
    })();
    return () => { live = false; };
  }, [email]);

  useEffect(() => {
    if (!cloudEnabled) return;
    const onShow = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', onShow);
    const every = window.setInterval(onShow, 20000);
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('online', onShow); clearInterval(every); };
  }, []);
  useEffect(() => () => { clearInterval(timer.current); stopRec(); }, []);

  // Keep the call in progress (outcome, follow-up, notes) on the phone until it is saved.
  useEffect(() => {
    if ((screen !== 'call' && screen !== 'wrap') || !call || activeId == null) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ activeId, call, wrap: screen === 'wrap' ? wrap : null, prev, wasDrive: wasDrive.current, savedAt: Date.now() })); } catch { /* ignore */ }
  }, [screen, call, wrap, activeId, prev]);

  // Pick up the morning briefing that the scheduled Claude run publishes, whenever the app comes to the front.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      fetchAutoBrief().then(b => setAutoBrief(b && b.hash !== readSeen() ? b : null));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  // Live updates: refresh as soon as anyone on the team changes a prospect or logs a call.
  useEffect(() => {
    if (!cloudEnabled || !me) return;
    return watchTeamChanges(() => { if (document.visibilityState === 'visible') sync(); });
  }, [me]);

  // Owner's Team list: needed for the Team sheet and for assigning follow-ups; (re)load whenever it was reset.
  useEffect(() => {
    if (me?.role === 'owner' && team === null) loadTeam().then(setTeam).catch(() => setSyncError('Could not load the team. Check your connection.'));
  }, [me, team]);

  function reportSyncError(err: string) {
    if (/RESERVED/.test(err)) { window.alert(`A company you added is already on ${OWNER_NAME}'s priority list, so it wasn't added.`); return; }
    setSyncError(err);
  }

  function persist(ps: Prospect[]) {
    // Becoming a customer takes a prospect off the priority list, so the team sees it again.
    ps = ps.map(p => (p.status === 'customer' && p.reservedAt ? { ...p, reservedAt: null } : p));
    if (cloudEnabled && meRef.current) {
      enqueue(diffOps(prospectsRef.current, ps, meRef.current.name));
      setPending(pendingCount());
      flush().then(err => { setPending(pendingCount()); if (err) reportSyncError(err); });
    }
    prospectsRef.current = ps;
    setProspects(ps);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ps)); } catch { /* storage full or blocked */ }
  }

  const cur = prospects.find(p => p.id === activeId);

  // ---- drive route ----
  // Route and the private priority list are per person: kept on the phone and in the person's own user_state row.
  const pushUserState = (st: { route: number[]; backToYard: boolean }) => { if (cloudEnabled && meRef.current) saveUserState(meRef.current.email, { ...st, myList: [] }); };
  const saveRoute = (ids: number[], home = backToYard) => {
    setRoute(ids);
    try { localStorage.setItem(ROUTE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
    pushUserState({ route: ids, backToYard: home });
  };
  // The owner's private priority list lives on the prospects themselves (reservedAt), so the database can hide them from the team.
  const toggleMine = (id: number) => persist(prospects.map(p => (p.id === id ? { ...p, reservedAt: isReserved(p) ? null : Date.now() } : p)));
  const myStops = isOwner ? prospects.filter(isReserved).sort((a, b) => (b.reservedAt || 0) - (a.reservedAt || 0)) : [];
  const [legacyMine, setLegacyMine] = useState<number[]>(readMyList);
  useEffect(() => {
    if (!isOwner || !legacyMine.length || !prospects.length) return;
    const ids = new Set(legacyMine), now = Date.now();
    persist(prospects.map(p => (ids.has(p.id) && !p.reservedAt && p.status !== 'customer' ? { ...p, reservedAt: now } : p)));
    try { localStorage.removeItem(MYLIST_KEY); } catch { /* ignore */ }
    pushUserState({ route, backToYard });
    setLegacyMine([]);
  }, [isOwner, legacyMine, prospects.length]);
  const toggleRoute = (id: number) => saveRoute(route.includes(id) ? route.filter(x => x !== id) : [...route, id]);
  const routeStops = route.map(id => prospects.find(p => p.id === id)).filter((p): p is Prospect => !!p);

  const queue = queueList(prospects, cloudEnabled && isOwner, me?.email);
  const assignedToMe = cloudEnabled && me ? prospects.filter(p => p.assigned?.toEmail === me.email).sort((a, b) => b.assigned!.at - a.assigned!.at) : [];
  const callers = (team || []).filter(m => m.role === 'caller');
  /** The owner assigning a follow-up: who, with an optional note. Assigning takes it off the private priority list so they can see it. */
  const assignment = (p: Prospect, toEmail: string | undefined, note: string | undefined) => {
    if (!isOwner || toEmail === undefined) return {};
    if (toEmail === '') return { assigned: null };
    const m = callers.find(c => c.email === toEmail); if (!m) return {};
    return { assigned: { to: m.name || m.email, toEmail: m.email, by: me?.name || OWNER_NAME, at: Date.now(), note: (note || '').trim() }, reservedAt: null };
  };
  const attention = cloudEnabled && isOwner ? prospects.filter(p => p.attention).sort((a, b) => b.attention!.at - a.attention!.at) : [];
  const today = rel(0);
  const T0 = startOfToday();
  const callsToday = prospects.reduce((n, p) => n + p.calls.filter(c => c.at >= T0 && (isOwner || c.by === me?.name)).length, 0);

  const open = (id: number) => { setActiveId(id); setPrev(screen); setScreen('detail'); setUpd(null); };
  const leaveDetail = () => setScreen(prev === 'detail' ? 'today' : prev);

  // ---- phone back button: step back inside the app instead of closing it ----
  // While anything other than the Today screen is showing, one extra history entry is kept; pressing back pops it
  // and we go back one step in the app (close a sheet, prospect → list, tab → Today).
  const isRoot = screen === 'today' && !brief && !add && !edit && !account && !upd;
  const goBack = () => {
    if (brief) return setBrief(null);
    if (add) return setAdd(null);
    if (edit) return setEdit(null);
    if (account) return setAccount(false);
    if (upd) return setUpd(null);
    if (screen === 'detail') return leaveDetail();
    if (screen === 'drive') return exitDrive();
    if (screen === 'call' || screen === 'wrap') return; // finish or discard the call first
    if (screen !== 'today') setScreen('today');
  };
  const backRef = useRef(goBack);
  backRef.current = goBack;
  const isRootRef = useRef(isRoot);
  isRootRef.current = isRoot;
  const pushed = useRef(false);
  const ignorePop = useRef(false);
  const syncHistory = () => {
    if (!isRootRef.current && !pushed.current) { history.pushState({ monarch: 1 }, ''); pushed.current = true; }
    else if (isRootRef.current && pushed.current) { pushed.current = false; ignorePop.current = true; history.back(); }
  };
  useEffect(syncHistory, [isRoot]);
  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      pushed.current = false;
      backRef.current();
      setTimeout(syncHistory, 0);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- keep each list's scroll position when you open a prospect and come back ----
  const mainRef = useRef<HTMLElement>(null);
  const scrollPos = useRef<Record<string, number>>({});
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useLayoutEffect(() => {
    const el = mainRef.current; if (!el) return;
    el.scrollTop = screen === 'detail' ? 0 : scrollPos.current[screen] ?? 0;
  }, [screen, activeId]);

  // ---- calls ----
  function placeCall(id: number) {
    const p = prospects.find(x => x.id === id); if (!p) return;
    if (!p.phone) { open(id); return; }
    stopRec();
    const start = Date.now();
    setActiveId(id); setScreen('call'); setCall({ start, secs: 0, lines: [] }); setInterim(''); setVoice(false);
    // Tell the rest of the team right away that this prospect is being called.
    if (cloudEnabled && me) persist(prospects.map(x => (x.id === id ? { ...x, calling: { by: me.name, at: start } } : x)));
    clearInterval(timer.current);
    timer.current = window.setInterval(() => setCall(c => (c ? { ...c, secs: Math.round((Date.now() - c.start) / 1000) } : c)), 1000);
    if (isMobile) { const a = document.createElement('a'); a.href = 'tel:' + p.phone; a.click(); }
  }

  /** Warns before calling a prospect someone else is calling now or called in the last week. */
  function okToCall(id: number) {
    const p = prospects.find(x => x.id === id); if (!p || !cloudEnabled) return true;
    const c = callingNow(p);
    if (c && c.by !== me?.name) return window.confirm(`${c.by} started calling ${p.company} at ${new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} and hasn't saved the call yet.\n\nCall anyway?`);
    if (p.assigned && p.assigned.toEmail !== me?.email && !isOwner) return window.confirm(`${p.assigned.by} assigned ${p.company} to ${p.assigned.to}.\n\nCall anyway?`);
    const last = p.calls[0];
    if (last && recentlyCalled(p) && last.by && last.by !== me?.name) return window.confirm(`${last.by} already called ${p.company} ${fmtWhen(last.at)} (${(OUTCOME[last.outcome] || OUTCOME.none).label}).\n\nCall anyway?`);
    return true;
  }
  const callFrom = (id: number) => { if (!okToCall(id)) return; wasDrive.current = false; setPrev(screen); placeCall(id); };

  const endCall = () => {
    clearInterval(timer.current); stopRec();
    setScreen('wrap'); setInterim('');
    setWrap({ outcome: null, follow: null, note: '', summary: '' });
  };

  const toggleDictate = () => {
    if (dictating) { stopRec(); setDictating(false); setInterim(''); return; }
    setDictating(startRec(t => setWrap(w => (w ? { ...w, note: (w.note ? w.note + ' ' : '') + t } : w)), setInterim));
  };

  const saveWrap = () => {
    if (!wrap || !call) return;
    stopRec();
    const oc = wrap.outcome || 'none';
    const summary = wrap.note.trim() || 'Call logged, no notes.';
    const next = wrap.follow == null ? undefined : wrap.follow === -1 ? null : rel(wrap.follow);
    persist(prospects.map(p => p.id !== activeId ? p : {
      ...p, pinned: null, calling: null,
      // The owner calling it back clears the flag; a team member can raise it.
      attention: isOwner ? null : wrap.attention ? { by: me?.name || 'Team', at: Date.now(), note: (wrap.attentionNote || '').trim() } : p.attention ?? null,
      // An assignment is done once the assignee logs the call; the owner can (re)assign here.
      ...(p.assigned && p.assigned.toEmail === me?.email ? { assigned: null } : {}),
      ...assignment(p, wrap.assignTo, wrap.assignNote),
      status: OUTCOME[oc].status || ((wrap.follow ?? 0) > 0 ? 'follow' : p.status),
      next: next === undefined ? (p.next && p.next <= today ? null : p.next) : next,
      calls: [{ id: call.start * 1000 + Math.floor(Math.random() * 1000), at: call.start, secs: call.secs, outcome: oc, summary, lines: [], by: me?.name, ...(wrap.attention && !isOwner ? { attention: true } : {}) }, ...p.calls],
    }));
    const fromDrive = prev === 'drive' || wasDrive.current;
    setWrap(null); setCall(null); setDictating(false);
    clearDraft();
    if (fromDrive) {
      wasDrive.current = false;
      setScreen('drive');
      if (DRIVE_AUTO_NEXT) setDriveIdx(i => i + 1);
    } else setScreen('detail');
  };

  // ---- drive mode ----
  const dq = driveQueue.current || queue;
  const drvRaw = dq[driveIdx];
  const drvP = drvRaw ? prospects.find(p => p.id === drvRaw.id) || drvRaw : null;

  const startDrive = () => { driveQueue.current = queueList(prospects, cloudEnabled && isOwner, me?.email); setScreen('drive'); setDriveIdx(0); };
  const driveCall = (p: Prospect | undefined) => { if (!p || !okToCall(p.id)) return; wasDrive.current = true; setPrev('drive'); placeCall(p.id); };
  const driveNext = () => setDriveIdx(i => Math.min(i + 1, dq.length));
  const drivePrev = () => setDriveIdx(i => Math.max(i - 1, 0));
  const exitDrive = () => { stopRec(); setScreen('today'); setVoice(false); };

  const toggleVoice = () => {
    if (voice) { stopRec(); setVoice(false); return; }
    setVoice(startRec(t => {
      const w = t.toLowerCase();
      if (/\bcall\b|\bdial\b/.test(w)) driveCall(dq[driveIdxRef.current]);
      else if (/next|skip/.test(w)) driveNext();
      else if (/back|previous/.test(w)) drivePrev();
      else if (/exit|stop/.test(w)) exitDrive();
    }, () => {}));
  };

  // ---- daily briefing ----
  function processBrief(brief: Brief | null) {
    if (!brief || !brief.text.trim()) return;
    const first = brief.text.split(/\r?\n/)[0].toLowerCase();
    if (!(first.includes('company') && first.includes(','))) {
      setBrief({ ...brief, error: "Paste the briefing as CSV with a company column. Ask Claude for today's briefing to get the right format." });
      return;
    }
    const items = parseCSV(brief.text).map(toProspect).filter(p => p.company);
    if (!items.length) { setBrief({ ...brief, error: 'No companies found in that briefing.' }); return; }
    const idx = new Map(prospects.map(p => [normName(p.company), p]));
    const added: BriefItem[] = [], updated: (BriefItem & { id: number })[] = [];
    items.forEach(n => {
      const ex = idx.get(normName(n.company));
      if (!ex) added.push(n);
      else if ((n.lead && n.lead !== ex.lead) || (n.top && !ex.top) || n.score > (ex.score || 0)) updated.push({ ...n, id: ex.id });
    });
    setBrief({ ...brief, busy: false, error: '', step: 'review', added, updated });
  }

  function applyBrief() {
    if (!brief?.added || !brief.updated) return;
    const now = Date.now();
    const up = new Map(brief.updated.map(u => [u.id, u]));
    const ps = prospects.map(p => {
      const u = up.get(p.id); if (!u) return p;
      return { ...p,
        lead: u.lead || p.lead, notes: [p.notes, u.notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' '),
        phone: p.phone || u.phone, email: p.email || u.email, contact: p.contact || u.contact, address: p.address || u.address,
        score: Math.max(p.score || 0, u.score || 0), top: p.top || u.top, pinned: u.top ? now : p.pinned };
    });
    const fresh: Prospect[] = brief.added.map((n, i) => ({ ...n, id: now + i, status: 'new', next: null, calls: [], pinned: n.top ? now : null, addedAt: now }));
    persist([...fresh, ...ps]);
    try { localStorage.setItem(BRIEF_AT_KEY, String(now)); } catch { /* ignore */ }
    markSeen(brief);
    setBrief(null); setBriefAt(String(now)); setFilter('all');
  }

  function markSeen(b: Brief | null) {
    if (!b?.auto) return;
    try { localStorage.setItem(BRIEF_SEEN_KEY, b.auto); } catch { /* ignore */ }
    setAutoBrief(null);
  }
  const reviewAutoBrief = () => { if (autoBrief) processBrief({ step: 'input', text: autoBrief.text, busy: false, error: '', auto: autoBrief.hash }); };

  const pasteBrief = () => {
    navigator.clipboard?.readText?.()
      .then(t => setBrief(b => b && { ...b, text: t, error: '' }))
      .catch(() => setBrief(b => b && { ...b, error: 'Clipboard blocked — long-press the box below and choose Paste.' }));
  };

  // ---- rendering ----
  const showChrome = !['call', 'wrap', 'drive'].includes(screen);
  const underToday = (s: Screen) => (s === 'teamday' || s === 'mylist' ? 'today' : s);
  const tabKey = underToday(screen === 'detail' ? prev : screen);
  const briefLabel = briefAt ? 'Last updated ' + fmtWhen(+briefAt) : 'Not updated yet';

  const q = search.toLowerCase();
  const inF = (p: Prospect, k: Filter) => k === 'all' || (k === 'mine' ? isReserved(p) : (k === 'top' ? !!p.top : k === 'follow' ? ['follow', 'interested'].includes(p.status) : p.status === k));
  const filtered = prospects.filter(p => inF(p, filter) && (!q || [p.company, p.contact, p.city, p.type, p.lead, p.notes, p.address].join(' ').toLowerCase().includes(q)));
  const filterDefs: [Filter, string][] = [['all', 'All'], ...(isOwner ? [['mine', '★ My list']] as [Filter, string][] : []), ['top', 'Top priority'], ['new', 'New'], ['follow', 'Follow-up'], ['customer', 'Customers']];

  const log = prospects.flatMap(p => p.calls.map(c => ({ ...c, pid: p.id, company: p.company }))).sort((a, b) => b.at - a.at);

  const renderToday = () => (
    <div className="today">
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <h1>{queue.length} calls in today's queue</h1>
      </div>
      <div className="grid2">
        {cloudEnabled && isOwner
          ? <button className="btn stat card" onClick={() => setScreen('teamday')} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b>{callsToday}</b><span>Team calls today ›</span>
            </button>
          : <div className="stat card"><b>{callsToday}</b><span>Calls made today</span></div>}
        <div className="stat card"><b style={{ color: '#D9B872' }}>{prospects.filter(p => p.next && p.next <= today).length}</b><span>Follow-ups due</span></div>
      </div>
      {assignedToMe.length > 0 && (
        <div className="card col" style={{ borderRadius: 16, padding: '14px 14px 6px 16px', gap: 10, border: '1.5px solid #5B4FA8', background: '#1C1830' }}>
          <span style={{ font: "800 20px/1 'Barlow Condensed',sans-serif", letterSpacing: '.04em', textTransform: 'uppercase', color: '#A99BF0' }}>Assigned to you · {assignedToMe.length}</span>
          {assignedToMe.map(p => (
            <div key={p.id} className="row" style={{ gap: 12, paddingBottom: 8, borderTop: '1px solid #2E2850', paddingTop: 10 }}>
              <button className="btn col" onClick={() => open(p.id)} style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <span className="prow-name" style={{ fontSize: 17 }}>{p.company}</span>
                <span style={{ font: "600 13px/1.3 'Barlow',sans-serif", color: '#A99BF0' }}>From {p.assigned!.by} · {fmtWhen(p.assigned!.at)}{p.next ? ` · follow up ${new Date(p.next + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</span>
                {p.assigned!.note && <span className="pretty" style={{ font: "600 15px/1.35 'Barlow',sans-serif", color: '#F2EEE6' }}>“{p.assigned!.note}”</span>}
              </button>
              <button className="btn call-dot" aria-label={`Call ${p.company}`} onClick={() => callFrom(p.id)} style={{ width: 54, height: 54 }}>CALL</button>
            </div>
          ))}
        </div>
      )}
      {attention.length > 0 && (
        <div className="card col\" style={{ borderRadius: 16, padding: '14px 14px 6px 16px', gap: 10, border: '1.5px solid #E07B24', background: '#2A1A10' }}>
          <span style={{ font: "800 20px/1 'Barlow Condensed',sans-serif", letterSpacing: '.04em', textTransform: 'uppercase', color: '#E07B24' }}>Attention {OWNER_NAME} · {attention.length}</span>
          {attention.map(p => (
            <div key={p.id} className="row" style={{ gap: 12, paddingBottom: 8, borderTop: '1px solid #3A2A1E', paddingTop: 10 }}>
              <button className="btn col" onClick={() => open(p.id)} style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <span className="prow-name" style={{ fontSize: 17 }}>{p.company}</span>
                <span style={{ font: "600 13px/1.3 'Barlow',sans-serif", color: '#E8A86A' }}>{p.attention!.by} · {fmtWhen(p.attention!.at)}</span>
                {p.attention!.note && <span className="pretty" style={{ font: "600 15px/1.35 'Barlow',sans-serif", color: '#F2EEE6' }}>“{p.attention!.note}”</span>}
                {p.calls[0] && <span className="muted pretty" style={{ font: "500 14px/1.35 'Barlow',sans-serif" }}>{p.calls[0].summary}</span>}
              </button>
              <button className="btn call-dot" aria-label={`Call ${p.company}`} onClick={() => callFrom(p.id)} style={{ width: 54, height: 54 }}>CALL</button>
            </div>
          ))}
        </div>
      )}
      {isOwner && myStops.length > 0 && (
        <button className="btn brief-card card" onClick={() => setScreen('mylist')}>
          <span style={{ font: "800 20px/1 'Barlow Condensed',sans-serif", letterSpacing: '.04em', textTransform: 'uppercase', color: '#C9A45C' }}>★ My priority list · {myStops.length}</span>
          <span style={{ font: "800 22px/1 'Barlow Condensed',sans-serif", color: '#C9A45C' }}>›</span>
        </button>
      )}
      {isOwner && autoBrief && (
        <button className="btn brief-card" onClick={reviewAutoBrief} style={{ background: '#2A2316', border: '1.5px solid #C9A45C' }}>
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <span style={{ font: "700 17px/1.1 'Barlow',sans-serif", color: '#E2C27F' }}>New briefing ready</span>
            <span style={{ font: "500 13px/1.3 'Barlow',sans-serif", color: '#A39A8C' }}>This morning's new work from Claude</span>
          </div>
          <span className="pill" style={{ background: '#C9A45C', color: '#0E0D0B' }}>Review</span>
        </button>
      )}
      {isOwner && (
        <div className="brief-card card">
          <div className="col" style={{ gap: 4, minWidth: 0 }}>
            <span style={{ font: "700 17px/1.1 'Barlow',sans-serif", color: '#F2EEE6' }}>Daily briefing</span>
            <span className="muted" style={{ font: "500 13px/1.3 'Barlow',sans-serif" }}>{briefLabel} · {prospects.length} prospects</span>
          </div>
          <button className="btn pill" onClick={openBrief}>Update list</button>
        </div>
      )}
      {!prospects.length && (
        <div className="empty-card card">
          <span style={{ font: "700 22px/1.1 'Barlow Condensed',sans-serif", color: '#F2EEE6' }}>Add your first prospect</span>
          <span className="muted pretty" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>Enter company, contact, phone, type and materials. They'll show up here as your call queue.</span>
          <button className="btn btn-gold" onClick={openAdd} style={{ height: 58, borderRadius: 16, font: "800 22px/1 'Barlow Condensed',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase' }}>+ Add prospect</button>
          {!cloudEnabled && <button className="btn" onClick={() => persist(seedProspects())} style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 14px 'Barlow',sans-serif", color: '#D9B872' }}>Load sample prospects to try it out</button>}
        </div>
      )}
      <button className="btn drive-cta" onClick={startDrive}>
        <div className="col" style={{ gap: 4 }}>
          <span style={{ font: "800 28px/1 'Barlow Condensed',sans-serif", letterSpacing: '.02em', textTransform: 'uppercase' }}>Start Drive Mode</span>
          <span style={{ font: "500 15px/1.2 'Barlow',sans-serif" }}>Big buttons, voice commands, auto next call</span>
        </div>
        <div className="drive-cta-arrow">→</div>
      </button>
      <div className="between" style={{ alignItems: 'baseline' }}>
        <h2 className="h-section">Up next</h2>
        <button className="btn link-btn" onClick={() => setScreen('prospects')}>All prospects</button>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {queue.slice(0, 5).map(p => <ProspectRow key={p.id} p={p} onOpen={open} onCall={callFrom} onRoute={toggleRoute} routed={route.includes(p.id)} starred={isOwner && isReserved(p)} />)}
      </div>
    </div>
  );

  const renderProspects = () => (
    <div className="prospects">
      <div className="between" style={{ gap: 10 }}>
        <span className="muted" style={{ font: "500 14px/1.3 'Barlow',sans-serif" }}>{prospects.length} prospects · {briefLabel}</span>
        {isOwner && <button className="btn pill" onClick={openBrief} style={{ height: 44, padding: '0 16px', borderRadius: 22, fontSize: 14 }}>Update list</button>}
      </div>
      <input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company, contact, city" />
      <div className="filters">
        {filterDefs.map(([k, label]) => (
          <button key={k} className="btn toggle" onClick={() => setFilter(k)} style={{ height: 40, padding: '0 16px', borderRadius: 20, background: selBg(filter === k), color: selFg(filter === k) }}>
            {label} · {prospects.filter(p => inF(p, k)).length}
          </button>
        ))}
      </div>
      <div className="col" style={{ gap: 10 }}>
        {filtered.slice().sort((a, b) => (b.pinned || 0) - (a.pinned || 0)).map(p => <ProspectRow key={p.id} p={p} compact onOpen={open} onCall={callFrom} onRoute={toggleRoute} routed={route.includes(p.id)} starred={isOwner && isReserved(p)} />)}
        {!filtered.length && <p className="muted" style={{ margin: '24px 0', textAlign: 'center', font: "500 15px 'Barlow',sans-serif" }}>No prospects match.</p>}
      </div>
      <button className="btn fab" onClick={openAdd}>+ Add prospect</button>
    </div>
  );

  // Owner only: pick a team member to do this follow-up, with an optional note for them.
  const renderAssign = (p: Prospect | undefined, to: string | undefined, note: string | undefined, set: (to: string | undefined, note?: string) => void) => {
    if (!cloudEnabled || !isOwner) return null;
    const cur = p?.assigned;
    return (
      <>
        <span className="label" style={{ color: '#A99BF0' }}>Assign follow-up to</span>
        {!callers.length
          ? <span className="muted" style={{ font: "500 14px 'Barlow',sans-serif" }}>{team === null ? 'Loading team…' : 'Add team members under your name (top right) → Team.'}</span>
          : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {callers.map(m => {
                const on = to === m.email || (to === undefined && cur?.toEmail === m.email);
                return <button key={m.email} className="btn toggle opt" onClick={() => set(on && to !== undefined ? undefined : m.email)} style={{ background: on ? '#5B4FA8' : '#1A1815', color: on ? '#fff' : '#F2EEE6', borderColor: '#5B4FA8' }}>{on ? '✓ ' : ''}{m.name || m.email}</button>;
              })}
              {cur && <button className="btn toggle opt" onClick={() => set(to === '' ? undefined : '')} style={{ background: to === '' ? '#C9A45C' : '#1A1815', color: to === '' ? '#0E0D0B' : '#F2EEE6' }}>Unassign</button>}
            </div>}
        {to && (
          <label className="field" style={{ color: '#A99BF0' }}>Note for {(callers.find(c => c.email === to)?.name || 'them').split(' ')[0]} (optional)
            <textarea className="textarea" value={note || ''} onChange={e => set(to, e.target.value)} placeholder="What to say, who to ask for, when to call…"
              style={{ minHeight: 70, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0, borderColor: '#5B4FA8' }} />
          </label>
        )}
        {to && p && isReserved(p) && <span style={{ font: "500 13px/1.4 'Barlow',sans-serif", color: '#A39A8C' }}>Assigning takes it off your priority list so they can see it.</span>}
      </>
    );
  };

  // Change status / follow-up / notes without making a call.
  const renderUpdate = (p: Prospect) => {
    if (!upd || activeId !== p.id) {
      return (
        <button className="btn btn-outline" onClick={() => setUpd({ status: p.status, next: p.next, note: '', attention: false, attentionNote: '', assignTo: '', assignNote: '' })} style={{ height: 52, borderRadius: 14, borderColor: '#3A352E', color: '#F2EEE6' }}>
          Update status, follow-up or notes
        </button>
      );
    }
    const u = upd;
    const set = (patch: Partial<Upd>) => setUpd(x => x && { ...x, ...patch });
    const quick: [number, string][] = [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week'], [30, '1 month']];
    const statuses = (Object.keys(STATUS) as StatusKey[]);
    const save = () => {
      const stamp = `[${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}${me ? ' · ' + me.name : ''}] `;
      persist(prospects.map(x => x.id !== p.id ? x : {
        ...x, status: u.status, next: u.next,
        notes: u.note.trim() ? [x.notes, stamp + u.note.trim()].filter(Boolean).join('\n') : x.notes,
        attention: u.attention ? { by: me?.name || 'Team', at: Date.now(), note: u.attentionNote.trim() } : x.attention ?? null,
        ...(x.assigned && x.assigned.toEmail === me?.email ? { assigned: null } : {}),
        ...assignment(x, u.assignTo === '-' ? '' : u.assignTo || undefined, u.assignNote),
      }));
      setUpd(null);
    };
    return (
      <div className="card col" style={{ borderRadius: 16, padding: 16, gap: 12, borderColor: '#C9A45C' }}>
        <div className="between">
          <span style={{ font: "800 20px/1 'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.04em' }}>Update without calling</span>
          <button className="btn sheet-close" onClick={() => setUpd(null)}>Cancel</button>
        </div>
        <span className="label">Status</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {statuses.map(k => <button key={k} className="btn toggle opt" onClick={() => set({ status: k })} style={{ background: selBg(u.status === k), color: selFg(u.status === k) }}>{STATUS[k].label}</button>)}
        </div>
        <span className="label">Follow up</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {quick.map(([d, l]) => <button key={d} className="btn toggle opt" onClick={() => set({ next: rel(d), status: u.status === 'new' ? 'follow' : u.status })} style={{ background: selBg(u.next === rel(d)), color: selFg(u.next === rel(d)) }}>{l}</button>)}
          <button className="btn toggle opt" onClick={() => set({ next: null })} style={{ background: selBg(!u.next), color: selFg(!u.next) }}>None</button>
        </div>
        <label className="field">Or pick a date
          <input type="date" value={u.next || ''} onChange={e => set({ next: e.target.value || null })} style={{ colorScheme: 'dark' }} />
        </label>
        {renderAssign(p, u.assignTo === '-' ? '' : u.assignTo || undefined, u.assignNote, (to, note) => set({ assignTo: to === undefined ? '' : to === '' ? '-' : to, assignNote: note ?? (to ? u.assignNote : '') }))}
        {cloudEnabled && !isOwner && (
          <>
            <button className="btn toggle" onClick={() => set({ attention: !u.attention })} style={{ alignSelf: 'flex-start', height: 46, padding: '0 16px', borderRadius: 23, fontSize: 15, fontWeight: 700, background: u.attention ? '#E07B24' : '#1A1815', color: u.attention ? '#0E0D0B' : '#E07B24', borderColor: '#E07B24' }}>
              {u.attention ? '✓ ' : ''}Attention {OWNER_NAME}
            </button>
            {u.attention && (
              <label className="field" style={{ color: '#E07B24' }}>Note for {OWNER_NAME}
                <textarea className="textarea" value={u.attentionNote} onChange={e => set({ attentionNote: e.target.value })} style={{ minHeight: 70, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0, borderColor: '#E07B24' }} />
              </label>
            )}
          </>
        )}
        <label className="field">Add a note
          <textarea className="textarea" value={u.note} onChange={e => set({ note: e.target.value })} placeholder="Added to this prospect's notes with today's date" style={{ minHeight: 70, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0 }} />
        </label>
        <button className="btn btn-cta btn-gold" onClick={save}>Save update</button>
      </div>
    );
  };

  const renderDetail = () => {
    if (!cur) return null;
    const d = decorate(cur);
    const deleteCurrent = () => {
      if (!window.confirm('Delete ' + cur.company + '?')) return;
      persist(prospects.filter(p => p.id !== activeId));
      if (route.includes(cur.id)) saveRoute(route.filter(x => x !== cur.id));
      leaveDetail(); setActiveId(null);
    };
    return (
      <div className="detail">
        <div className="between">
          <button className="btn back" onClick={leaveDetail}>← Back</button>
          <button className="btn pill" onClick={() => setEdit({ ...cur, phone: cur.phone ? fmtPhone(cur.phone) : '' })} style={{ height: 40, padding: '0 16px', borderRadius: 20, fontSize: 14 }}>Edit details</button>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <Chip bg={d.chipBg} fg={d.chipFg} label={d.statusLabel} />
          <h1>{cur.company}</h1>
          <span style={{ font: "500 17px/1.3 'Barlow',sans-serif", color: '#CFC8BC' }}>{d.contact} · {d.phoneFmt}</span>
          <span className="muted" style={{ font: "500 15px/1.3 'Barlow',sans-serif" }}>{[cur.type, cur.city, cur.interest].filter(Boolean).join(' · ')}</span>
          {cur.top && <span style={{ font: "700 13px/1.3 'Barlow',sans-serif", color: '#C9A45C', letterSpacing: '.04em', textTransform: 'uppercase' }}>Top priority · {d.sizeLabel}</span>}
        </div>
        {cur.lead && <div className="info-card card"><span className="t" style={{ color: '#C9A45C' }}>Why call</span><span className="b">{cur.lead}</span></div>}
        {cur.notes && <div className="info-card card"><span className="t muted">Notes</span><span className="b" style={{ whiteSpace: 'pre-line' }}>{cur.notes}</span></div>}
        <button className="btn btn-gold press" onClick={() => { if (!okToCall(cur.id)) return; wasDrive.current = false; placeCall(cur.id); }} style={{ height: 68, borderRadius: 18, font: "800 26px/1 'Barlow Condensed',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase' }}>{d.callLabel}</button>
        <div className="grid2">
          <a className="btn-outline" href={d.smsHref} style={{ height: 52, borderRadius: 14 }}>Text pricing link</a>
          <a className="btn-outline" href={d.mapHref} target="_blank" rel="noreferrer" style={{ height: 52, borderRadius: 14 }}>Directions</a>
        </div>
        <button className="btn btn-outline" onClick={() => toggleRoute(cur.id)} style={{ height: 52, borderRadius: 14, ...(route.includes(cur.id) ? { borderColor: '#3A352E', color: '#A39A8C' } : {}) }}>
          {route.includes(cur.id) ? `On the route (stop ${route.indexOf(cur.id) + 1}) · Remove` : 'Add to drive route'}
        </button>
        {isOwner && (
          <button className="btn btn-outline" onClick={() => toggleMine(cur.id)} style={{ height: 52, borderRadius: 14, ...(isReserved(cur) ? { background: '#C9A45C', color: '#0E0D0B' } : {}) }}>
            {isReserved(cur) ? '★ My priority list (hidden from team) · Remove' : cur.status === 'customer' ? '☆ Customer: visible to the team' : '☆ Add to my priority list'}
          </button>
        )}
        {renderUpdate(cur)}
        <div className="col" style={{ gap: 6 }}>
          {cur.email && <a href={'mailto:' + cur.email} style={{ font: "600 15px/1.4 'Barlow',sans-serif", color: '#D9B872', wordBreak: 'break-all' }}>{cur.email}</a>}
          {cur.address && <span className="muted" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>{cur.address}</span>}
        </div>
        {cur.assigned && (isOwner || cur.assigned.toEmail === me?.email) && (
          <div className="follow-banner" style={{ background: '#1C1830', color: '#A99BF0', border: '1.5px solid #5B4FA8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="col" style={{ gap: 4 }}>
              <span>{isOwner ? `Assigned to ${cur.assigned.to}` : `${cur.assigned.by} assigned this to you`} · {fmtWhen(cur.assigned.at)}</span>
              {cur.assigned.note && <span style={{ color: '#F2EEE6', fontWeight: 500 }}>“{cur.assigned.note}”</span>}
            </span>
            {isOwner && <button className="btn" onClick={() => persist(prospects.map(p => (p.id === cur.id ? { ...p, assigned: null } : p)))} style={{ flex: 'none', font: "700 14px 'Barlow',sans-serif", color: '#A99BF0', padding: '6px 0' }}>Unassign</button>}
          </div>
        )}
        {cur.attention && (
          <div className="follow-banner" style={{ background: '#2A1A10', color: '#E8A86A', border: '1.5px solid #E07B24', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="col" style={{ gap: 4 }}>
              <span>{cur.attention.by} asked {isOwner ? 'you' : OWNER_NAME} to call back · {fmtWhen(cur.attention.at)}</span>
              {cur.attention.note && <span style={{ color: '#F2EEE6', fontWeight: 500 }}>“{cur.attention.note}”</span>}
            </span>
            {isOwner && <button className="btn" onClick={() => persist(prospects.map(p => (p.id === cur.id ? { ...p, attention: null } : p)))} style={{ flex: 'none', font: "700 14px 'Barlow',sans-serif", color: '#E07B24', padding: '6px 0' }}>Mark handled</button>}
          </div>
        )}
        {cur.next && <div className="follow-banner">Follow up {new Date(cur.next + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>}
        <div className="between" style={{ marginTop: 6 }}>
          <h2 className="h-section">Call history</h2>
          <button className="btn" onClick={deleteCurrent} style={{ height: 40, padding: '0 4px', display: 'flex', alignItems: 'center', font: "600 14px 'Barlow',sans-serif", color: '#F08A80' }}>Delete prospect</button>
        </div>
        {!cur.calls.length && <p className="muted" style={{ font: "500 15px 'Barlow',sans-serif" }}>No calls yet.</p>}
        <div className="col" style={{ gap: 10 }}>
          {cur.calls.map(c => {
            const o = OUTCOME[c.outcome] || OUTCOME.none;
            return (
              <div key={c.at} className="history card">
                <div className="between" style={{ gap: 8 }}>
                  <span className="muted" style={{ font: "600 14px 'Barlow',sans-serif" }}>{fmtWhen(c.at)} · {fmtTime(c.secs)}{c.by ? ` · ${c.by}` : ''}{c.attention ? <b style={{ color: '#E07B24' }}> · Attention {OWNER_NAME}</b> : null}</span>
                  <Chip bg={o.bg} fg={o.fg} label={o.label} />
                </div>
                <p className="pretty" style={{ font: "500 16px/1.4 'Barlow',sans-serif" }}>{c.summary}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Owner only: the private ★ priority list on its own screen.
  const renderMyList = () => (
    <div className="prospects" style={{ paddingBottom: 28 }}>
      <button className="btn back" onClick={() => setScreen('today')}>← Today</button>
      <h1 style={{ font: "700 30px/1.05 'Barlow Condensed',sans-serif", color: '#C9A45C' }}>★ My priority list</h1>
      <span className="muted" style={{ font: "500 14px/1.4 'Barlow',sans-serif" }}>Only you can see these. They're hidden from your team until you mark them Customer.</span>
      {!myStops.length && <div className="empty">Nothing here yet.</div>}
      <div className="col" style={{ gap: 10 }}>
        {myStops.map(p => (
          <div key={p.id} className="col" style={{ gap: 4 }}>
            <ProspectRow p={p} compact onOpen={open} onCall={callFrom} onRoute={toggleRoute} routed={route.includes(p.id)} starred />
            <button className="btn" onClick={() => { if (window.confirm(`Remove ${p.company} from your priority list? Your team will be able to see it again.`)) toggleMine(p.id); }}
              style={{ alignSelf: 'flex-end', padding: '4px 6px', font: "600 14px 'Barlow',sans-serif", color: '#F08A80' }}>Remove from my list</button>
          </div>
        ))}
      </div>
    </div>
  );

  // Owner only: everything the team did today, newest first.
  const renderTeamDay = () => {
    type Item = { at: number; by: string; pid: number; company: string; kind: 'call' | 'added' | 'flag'; label: string; bg: string; fg: string; text: string };
    const items: Item[] = [];
    for (const p of prospects) {
      for (const c of p.calls) {
        if (c.at < T0) continue;
        const o = OUTCOME[c.outcome] || OUTCOME.none;
        items.push({ at: c.at, by: c.by || 'Unknown', pid: p.id, company: p.company, kind: 'call', label: o.label, bg: o.bg, fg: o.fg, text: c.summary });
      }
      if ((p.addedAt || 0) >= T0) items.push({ at: p.addedAt!, by: p.addedBy || 'Briefing', pid: p.id, company: p.company, kind: 'added', label: 'New prospect', bg: '#1B2533', fg: '#9CC0EA', text: p.lead || [p.type, p.city].filter(Boolean).join(' · ') });
      if (p.attention && p.attention.at >= T0) items.push({ at: p.attention.at, by: p.attention.by, pid: p.id, company: p.company, kind: 'flag', label: `Attention ${OWNER_NAME}`, bg: '#E07B24', fg: '#0E0D0B', text: p.attention.note || 'Asked you to call back.' });
    }
    items.sort((a, b) => b.at - a.at);
    const people = new Map<string, { calls: number; good: number; added: number }>();
    for (const it of items) {
      if (!people.has(it.by)) people.set(it.by, { calls: 0, good: 0, added: 0 });
      const r = people.get(it.by)!;
      if (it.kind === 'call') { r.calls++; if (it.label === 'Interested' || it.label === 'Won') r.good++; }
      if (it.kind === 'added') r.added++;
    }
    const refresh = async () => { setSyncing(true); await sync(); setSyncing(false); };
    return (
      <div className="log">
        <div className="between">
          <button className="btn back" onClick={() => setScreen('today')}>← Today</button>
          <button className="btn pill" onClick={refresh} style={{ height: 40, padding: '0 16px', borderRadius: 20, fontSize: 14 }}>{syncing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <h1 style={{ font: "700 30px/1.05 'Barlow Condensed',sans-serif" }}>Team today</h1>
        {people.size > 0 && (
          <div className="col" style={{ gap: 8 }}>
            {[...people.entries()].sort((a, b) => b[1].calls - a[1].calls).map(([name, r]) => (
              <div key={name} className="card between" style={{ borderRadius: 14, padding: '12px 16px', gap: 10 }}>
                <span style={{ font: "700 16px 'Barlow',sans-serif" }}>{name}</span>
                <span className="muted" style={{ font: "600 14px 'Barlow',sans-serif" }}>
                  <b style={{ color: '#F2EEE6' }}>{r.calls}</b> calls · <b style={{ color: r.good ? '#C9A45C' : '#F2EEE6' }}>{r.good}</b> interested/won · <b style={{ color: '#F2EEE6' }}>{r.added}</b> added
                </span>
              </div>
            ))}
          </div>
        )}
        {!items.length && <div className="empty">Nothing yet today. Calls, new prospects and Attention {OWNER_NAME} requests show up here as the team works.</div>}
        {items.map((it, i) => (
          <button key={it.kind + it.pid + '-' + it.at + '-' + i} className="btn log-item card" onClick={() => open(it.pid)}>
            <div className="between" style={{ gap: 8 }}>
              <span style={{ font: "700 17px/1.2 'Barlow',sans-serif" }}>{it.company}</span>
              <span className="chip" style={{ flex: 'none', background: it.bg, color: it.fg }}>{it.label}</span>
            </div>
            <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif" }}>{new Date(it.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {it.by}</span>
            {it.text && <span className="pretty" style={{ font: "500 15px/1.4 'Barlow',sans-serif", color: '#CFC8BC' }}>{it.kind === 'flag' ? `“${it.text}”` : it.text}</span>}
          </button>
        ))}
      </div>
    );
  };

  const renderLog = () => {
    const week = T0 - 6 * 86400000;
    // Everyone who has made a call or added a prospect, with their numbers for today and the last 7 days.
    const people = new Map<string, { today: number; week: number; good: number; added: number; last: number }>();
    const row = (n: string) => { if (!people.has(n)) people.set(n, { today: 0, week: 0, good: 0, added: 0, last: 0 }); return people.get(n)!; };
    if (cloudEnabled) {
      for (const c of log) {
        if (!c.by) continue;
        const r = row(c.by);
        r.last = Math.max(r.last, c.at);
        if (c.at >= T0) r.today++;
        if (c.at >= week) { r.week++; if (c.outcome === 'interested' || c.outcome === 'won') r.good++; }
      }
      for (const p of prospects) if (p.addedBy && (p.addedAt || 0) >= week) row(p.addedBy).added++;
    }
    const shown = logWho ? log.filter(c => c.by === logWho) : log;
    const refresh = async () => { setSyncing(true); await sync(); setSyncing(false); };
    return (
      <div className="log">
        <div className="between">
          <h1 style={{ font: "700 30px/1.05 'Barlow Condensed',sans-serif" }}>Call log</h1>
          {cloudEnabled && <button className="btn pill" onClick={refresh} style={{ height: 40, padding: '0 16px', borderRadius: 20, fontSize: 14 }}>{syncing ? 'Refreshing…' : 'Refresh'}</button>}
        </div>
        {people.size > 0 && (
          <>
            <h2 className="h-section">Team progress</h2>
            {[...people.entries()].sort((a, b) => b[1].week - a[1].week).map(([name, r]) => (
              <button key={name} className="btn card col" onClick={() => setLogWho(logWho === name ? '' : name)} style={{ borderRadius: 16, padding: '14px 16px', gap: 10, borderColor: logWho === name ? '#C9A45C' : undefined }}>
                <div className="between">
                  <span style={{ font: "700 18px/1.1 'Barlow',sans-serif" }}>{name}</span>
                  <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif" }}>{r.last ? 'Last call ' + fmtWhen(r.last) : 'No calls yet'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {([[r.today, 'Calls today'], [r.week, 'Calls, 7 days'], [r.good, 'Interested / won'], [r.added, 'Prospects added']] as [number, string][]).map(([n, l]) => (
                    <div key={l} className="col" style={{ gap: 2 }}>
                      <b style={{ font: "700 26px/1 'Barlow Condensed',sans-serif", color: l === 'Interested / won' && n ? '#C9A45C' : '#F2EEE6' }}>{n}</b>
                      <span className="muted" style={{ font: "500 12px/1.2 'Barlow',sans-serif" }}>{l}</span>
                    </div>
                  ))}
                </div>
              </button>
            ))}
            <div className="filters">
              {['', ...people.keys()].map(n => (
                <button key={n || 'all'} className="btn toggle" onClick={() => setLogWho(n)} style={{ height: 40, padding: '0 16px', borderRadius: 20, background: selBg(logWho === n), color: selFg(logWho === n) }}>{n || 'Everyone'}</button>
              ))}
            </div>
          </>
        )}
        {!shown.length && <p className="muted" style={{ font: "500 15px 'Barlow',sans-serif" }}>No calls yet.</p>}
        {shown.map(c => {
          const o = OUTCOME[c.outcome] || OUTCOME.none;
          return (
            <button key={c.pid + '-' + c.at} className="btn log-item card" onClick={() => open(c.pid)}>
              <div className="between" style={{ gap: 8 }}>
                <span style={{ font: "700 17px/1.2 'Barlow',sans-serif" }}>{c.company}</span>
                <span className="chip" style={{ flex: 'none', background: o.bg, color: o.fg }}>{o.label}</span>
              </div>
              <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif" }}>{fmtWhen(c.at)} · {fmtTime(c.secs)}{c.by ? ` · ${c.by}` : ''}{c.attention ? <b style={{ color: '#E07B24' }}> · Attention {OWNER_NAME}</b> : null}</span>
              <span className="pretty" style={{ font: "500 15px/1.4 'Barlow',sans-serif", color: '#CFC8BC' }}>{c.summary}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderRoute = () => {
    const legs = routeLegs(routeStops, backToYard);
    const cities = [...new Set(prospects.map(p => (p.city || '').trim()).filter(Boolean))].sort();
    const cand = prospects
      .filter(p => !route.includes(p.id) && p.status !== 'notnow' && (p.top || (p.score || 0) >= candMin) && (!candCity || (p.city || '').trim() === candCity))
      .sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || (b.score || 0) - (a.score || 0) || a.company.localeCompare(b.company));
    const move = (i: number, d: number) => { const ids = routeStops.map(p => p.id), j = i + d; [ids[i], ids[j]] = [ids[j], ids[i]]; saveRoute(ids); };
    const setHome = (on: boolean) => { setBackToYard(on); try { localStorage.setItem(ROUTE_HOME_KEY, on ? '1' : '0'); } catch { /* ignore */ } saveRoute(route, on); };
    const select = { height: 48, borderRadius: 12, border: '1px solid #2E2A24', background: '#1A1815', color: '#F2EEE6', padding: '0 12px', font: "500 16px 'Barlow',sans-serif", width: '100%' };
    return (
      <div className="route">
        <div className="col" style={{ gap: 4 }}>
          <h1>Drive route</h1>
          <span className="muted pretty" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>Tap the pin on any company to add it. Stops run in this order; use the arrows to reorder, then open the route in Google Maps.</span>
        </div>
        <div className="stop card" style={{ borderLeft: '4px solid #C9A45C' }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif" }}>Start</span>
            <span style={{ font: "700 16px 'Barlow',sans-serif" }}>The yard, 1920 Goetz Rd, Perris</span>
          </div>
        </div>
        {!routeStops.length
          ? <div className="empty">No stops yet. Add high-value companies below, or tap the pin on anyone in Today or Prospects.</div>
          : <>
            {routeStops.map((p, i) => (
              <div key={p.id} className="stop card">
                <span className="stop-num">{i + 1}</span>
                <button className="btn col" onClick={() => open(p.id)} style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <span className="prow-name" style={{ fontSize: 17 }}>{p.company}</span>
                  <span className="prow-sub" style={{ fontSize: 13 }}>{p.address ? placeOf(p) : `${p.city || 'No city'} · no street address, Maps searches by name`}</span>
                </button>
                <div className="row" style={{ gap: 4, flex: 'none' }}>
                  <button className="btn sq" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn sq" aria-label="Move down" disabled={i === routeStops.length - 1} onClick={() => move(i, 1)}>↓</button>
                  <button className="btn sq" aria-label={`Remove ${p.company}`} onClick={() => toggleRoute(p.id)}>✕</button>
                </div>
              </div>
            ))}
            <label className="row" style={{ gap: 10, font: "500 16px 'Barlow',sans-serif", cursor: 'pointer' }}>
              <input type="checkbox" checked={backToYard} onChange={e => setHome(e.target.checked)} style={{ width: 22, height: 22, accentColor: '#C9A45C', margin: 0 }} /> End back at the yard
            </label>
            {legs.map(l => <a key={l.url} className="btn-gold" href={l.url} target="_blank" rel="noreferrer" style={{ height: 60, borderRadius: 16, font: "800 20px/1 'Barlow Condensed',sans-serif", letterSpacing: '.04em', textTransform: 'uppercase', textDecoration: 'none' }}>{l.label}</a>)}
            {legs.length > 1 && <span className="muted pretty" style={{ font: "500 14px/1.4 'Barlow',sans-serif" }}>Google Maps on a phone takes 4 stops per link, so the drive is split into legs. Open the next leg when you finish one.</span>}
            <button className="btn" onClick={() => { if (window.confirm('Clear every stop from the route?')) saveRoute([]); }} style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 15px 'Barlow',sans-serif", color: '#F08A80' }}>Clear route</button>
          </>}
        <h2 className="h-section" style={{ marginTop: 10 }}>High-value companies to add</h2>
        <div className="grid2">
          <label className="field">City
            <select value={candCity} onChange={e => setCandCity(e.target.value)} style={select}><option value="">Any city</option>{cities.map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="field">Demo size
            <select value={candMin} onChange={e => setCandMin(+e.target.value)} style={select}>{[['Massive only', 85], ['Large and up', 70], ['Medium and up', 50]].map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <span className="muted" style={{ font: "500 14px 'Barlow',sans-serif" }}>Top priority and biggest demo first. {cand.length} match.</span>
        {cand.length
          ? cand.slice(0, 40).map(p => (
            <div key={p.id} className="stop card">
              <button className="btn col" onClick={() => open(p.id)} style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <span className="prow-name" style={{ fontSize: 17 }}>{p.company}</span>
                <span className="prow-sub" style={{ fontSize: 13 }}>{p.city || 'No city'}{p.top ? ' · Top priority' : ''}{p.score ? ` · score ${p.score}` : ''}{p.address ? '' : ' · no street address'}</span>
              </button>
              <button className="btn pill" onClick={() => toggleRoute(p.id)} style={{ height: 44, padding: '0 16px', background: '#C9A45C', color: '#0E0D0B' }}>Add</button>
            </div>
          ))
          : <div className="empty">Nothing else matches. Try another city or a smaller demo size.</div>}
      </div>
    );
  };

  const renderCall = () => (
    <div className="overlay call-screen">
      <div className="between">
        <span className="rec"><i />On call</span>
        <span className="timer">{fmtTime(call ? call.secs : 0)}</span>
      </div>
      <h1 style={{ margin: '18px 0 2px', font: "700 36px/1.05 'Barlow Condensed',sans-serif" }}>{cur?.company}</h1>
      <span style={{ font: "500 17px 'Barlow',sans-serif", color: '#B8AE9F' }}>{cur && decorate(cur).contact} · {cur && (cur.phone ? fmtPhone(cur.phone) : 'No phone yet')}</span>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '18px 0', borderTop: '1px solid #2E2921', paddingTop: 16 }}>
        {cur?.lead && <p className="pretty" style={{ font: "500 17px/1.45 'Barlow',sans-serif", color: '#CFC8BC' }}>{cur.lead}</p>}
        <p className="pretty" style={{ marginTop: 12, font: "500 15px/1.45 'Barlow',sans-serif", color: '#8A8276' }}>Tap End call when you hang up to log how it went.</p>
      </div>
      <button className="btn end-call" onClick={endCall}>End call</button>
    </div>
  );

  const renderWrap = () => {
    const w = wrap || { outcome: null, follow: null, note: '', summary: '' };
    const outcomes = (Object.keys(OUTCOME) as OutcomeKey[]).filter(k => k !== 'none');
    const follows: [number, string][] = [[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week'], [30, '1 month'], [-1, 'None']];
    return (
      <div className="overlay wrap">
        <div className="wrap-body">
          <div className="col" style={{ gap: 4 }}>
            <span className="eyebrow">{cur?.company} · {fmtTime(call ? call.secs : 0)}</span>
            <h1 style={{ font: "700 32px/1.05 'Barlow Condensed',sans-serif" }}>How did it go?</h1>
          </div>
          <div className="grid2">
            {outcomes.map(k => (
              <button key={k} className="btn" onClick={() => setWrap(x => x && { ...x, outcome: k })} style={{ height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 18px 'Barlow',sans-serif", background: selBg(w.outcome === k), color: selFg(w.outcome === k), border: `2px solid ${w.outcome === k ? '#C9A45C' : '#2E2A24'}` }}>
                {OUTCOME[k].label}
              </button>
            ))}
          </div>
          <span className="label">Follow up</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {follows.map(([d, label]) => (
              <button key={d} className="btn toggle" onClick={() => setWrap(x => x && { ...x, follow: d })} style={{ height: 46, padding: '0 16px', borderRadius: 23, fontSize: 15, background: selBg(w.follow === d), color: selFg(w.follow === d) }}>{label}</button>
            ))}
            {cloudEnabled && !isOwner && (
              <button className="btn toggle" aria-pressed={!!w.attention} onClick={() => setWrap(x => x && { ...x, attention: !x.attention })}
                style={{ height: 46, padding: '0 16px', borderRadius: 23, fontSize: 15, fontWeight: 700, background: w.attention ? '#E07B24' : '#1A1815', color: w.attention ? '#0E0D0B' : '#E07B24', borderColor: '#E07B24' }}>
                {w.attention ? '✓ ' : ''}Attention {OWNER_NAME}
              </button>
            )}
          </div>
          {w.attention && (
            <label className="field" style={{ color: '#E07B24' }}>Note for {OWNER_NAME}
              <textarea className="textarea" value={w.attentionNote || ''} onChange={e => { const v = e.target.value; setWrap(x => x && { ...x, attentionNote: v }); }}
                placeholder={`Why should ${OWNER_NAME} call back? Who to ask for, what they need, best time…`}
                style={{ minHeight: 80, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0, borderColor: '#E07B24' }} />
            </label>
          )}
          {renderAssign(cur, w.assignTo, w.assignNote, (to, note) => setWrap(x => x && { ...x, assignTo: to, assignNote: note ?? (to ? x.assignNote : '') }))}
          <div className="between">
            <span className="label">Notes</span>
            <button className="btn" onClick={toggleDictate} style={{ height: 40, padding: '0 14px', borderRadius: 20, background: dictating ? '#C9A45C' : '#2E2A24', color: dictating ? '#0E0D0B' : '#F2EEE6', display: 'flex', alignItems: 'center', font: "700 14px 'Barlow',sans-serif" }}>
              {dictating ? 'Stop dictating' : 'Dictate'}
            </button>
          </div>
          <textarea className="textarea" value={w.note} onChange={e => { const v = e.target.value; setWrap(x => x && { ...x, note: v }); }} placeholder="What happened? Tap Dictate and talk, or type" style={{ minHeight: 96, font: "500 16px/1.4 'Barlow',sans-serif" }} />
          {cur && <a className="btn-outline" href={decorate(cur).smsHref} style={{ height: 52, borderRadius: 14 }}>{decorate(cur).textLabel}</a>}
        </div>
        <div className="wrap-foot">
          <button className="btn btn-gold" onClick={saveWrap} style={{ width: '100%', height: 64, borderRadius: 18, font: "800 24px/1 'Barlow Condensed',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase' }}>
            {wasDrive.current ? 'Save & next call' : 'Save call'}
          </button>
          <button className="btn" onClick={() => { if (!window.confirm('Discard this call without saving it?')) return; stopRec(); clearDraft(); setWrap(null); setCall(null); setDictating(false); setScreen(activeId != null ? 'detail' : 'today'); if (cloudEnabled && activeId != null) persist(prospects.map(x => (x.id === activeId ? { ...x, calling: null } : x))); }}
            style={{ width: '100%', height: 36, marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 14px 'Barlow',sans-serif", color: '#8A8276' }}>Discard this call</button>
        </div>
      </div>
    );
  };

  const renderDrive = () => {
    const d = drvP ? decorate(drvP) : null;
    return (
      <div className="overlay drive">
        <div className="between">
          <span style={{ font: "800 18px/1 'Barlow Condensed',sans-serif", letterSpacing: '.14em', color: '#C9A45C' }}>DRIVE MODE · {drvRaw ? `${driveIdx + 1} of ${dq.length}` : `${dq.length} of ${dq.length}`}</span>
          <button className="btn" onClick={exitDrive} style={{ height: 48, padding: '0 18px', borderRadius: 24, border: '1.5px solid #3D372F', display: 'flex', alignItems: 'center', font: "700 15px 'Barlow',sans-serif" }}>Exit</button>
        </div>
        {drvP && d ? (
          <>
            <div className="col" style={{ flex: 1, justifyContent: 'center', gap: 10, minHeight: 0 }}>
              <span className="chip" style={{ fontSize: 12, letterSpacing: '.08em', padding: '6px 10px', background: d.chipBg, color: d.chipFg }}>{d.statusLabel}</span>
              <h1 style={{ font: "800 46px/1 'Barlow Condensed',sans-serif", textWrap: 'balance' }}>{drvP.company}</h1>
              <span style={{ font: "600 22px/1.2 'Barlow',sans-serif", color: '#D8D1C4' }}>{d.contact} · {drvP.city}</span>
              <span className="pretty" style={{ font: "500 17px/1.4 'Barlow',sans-serif", color: '#8A8276' }}>{d.lastSummary}</span>
            </div>
            <div className="row" style={{ justifyContent: 'center', padding: '10px 0 22px' }}>
              <button className="btn drive-big" aria-label="Call" onClick={() => driveCall(drvP)}>CALL</button>
            </div>
            <div className="grid2" style={{ gap: 12 }}>
              <button className="btn drive-nav" onClick={drivePrev}>← PREV</button>
              <button className="btn drive-nav" onClick={driveNext}>SKIP →</button>
            </div>
            <button className="btn" onClick={toggleVoice} style={{ marginTop: 12, height: 60, borderRadius: 18, background: voice ? '#C9A45C' : '#221E18', color: voice ? '#0E0D0B' : '#F5F2EC', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 17px 'Barlow',sans-serif", textAlign: 'center' }}>
              {!speechSupported ? 'Voice commands need Chrome' : voice ? 'Listening — say "call", "next" or "back"' : 'Turn on voice commands'}
            </button>
          </>
        ) : (
          <div className="col" style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
            <h1 style={{ font: "800 44px/1 'Barlow Condensed',sans-serif" }}>Queue done.</h1>
            <span style={{ font: "500 19px/1.4 'Barlow',sans-serif", color: '#B8AE9F' }}>{callsToday} calls made today. They're all in the call log.</span>
          </div>
        )}
      </div>
    );
  };

  function openBrief() { setBrief({ step: 'input', text: '', busy: false, error: '' }); }
  function openAdd() { setAddMsg(''); setAdd({ type: 'Hauler', interest: 'Dumping' }); }

  const renderBrief = () => {
    if (!brief) return null;
    const all = brief.added && brief.updated ? [...brief.added, ...brief.updated] : [];
    const top = all.filter(p => p.top);
    const changes = all.length;
    return (
      <div className="scrim" style={{ background: 'rgba(0,0,0,.6)' }}>
        <div className="sheet" style={{ borderTop: '3px solid #C9A45C', gap: 14, maxHeight: '92%' }}>
          <div className="between">
            <h2 style={{ color: '#F2EEE6' }}>Update prospect list</h2>
            <button className="btn sheet-close" onClick={() => setBrief(null)}>Close</button>
          </div>
          {brief.step === 'input' ? (
            <>
              <span className="muted pretty" style={{ font: "500 15px/1.45 'Barlow',sans-serif" }}>Upload today's briefing CSV or paste the briefing. New companies get added, existing ones get updated, and top-priority work goes to the top of your queue.</span>
              <a className="btn-gold" href={'https://claude.ai/new?q=' + encodeURIComponent(CLAUDE_BRIEF_PROMPT)} target="_blank" rel="noreferrer" style={{ height: 56, borderRadius: 14, font: "700 16px 'Barlow',sans-serif", textDecoration: 'none' }}>1 · Ask Claude for today's briefing</a>
              <button className="btn btn-outline" onClick={pasteBrief} style={{ height: 56, borderRadius: 14, fontSize: 16 }}>2 · Paste Claude's answer</button>
              <label style={{ height: 48, borderRadius: 14, border: '1.5px dashed #3A352E', color: '#A39A8C', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 15px 'Barlow',sans-serif", cursor: 'pointer' }}>
                or upload a CSV file
                <input type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) f.text().then(t => setBrief(b => b && { ...b, text: t, error: '' })); }} />
              </label>
              <textarea className="textarea" value={brief.text} onChange={e => { const v = e.target.value; setBrief(b => b && { ...b, text: v, error: '' }); }} placeholder="…or paste the daily briefing here" style={{ minHeight: 150, font: "500 15px/1.4 'Barlow',sans-serif" }} />
              {brief.error && <span style={{ font: "600 14px/1.4 'Barlow',sans-serif", color: '#F08A80' }}>{brief.error}</span>}
              <button className="btn btn-cta" onClick={() => processBrief(brief)} style={{ background: brief.text.trim() ? '#C9A45C' : '#3A352E', color: '#0E0D0B' }}>Check for new work</button>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div className="brief-stat card"><b>{brief.added?.length ?? 0}</b><span>New</span></div>
                <div className="brief-stat card"><b>{brief.updated?.length ?? 0}</b><span>Updated</span></div>
                <div className="brief-stat card" style={{ borderColor: '#C9A45C' }}><b style={{ color: '#C9A45C' }}>{top.length}</b><span>Top priority</span></div>
              </div>
              {!changes && <span className="muted" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>Nothing new — everything in this briefing is already on your list.</span>}
              {top.map(t => (
                <div key={t.company} className="card col" style={{ borderRadius: 14, padding: '12px 14px', gap: 4 }}>
                  <span style={{ font: "700 16px/1.2 'Barlow',sans-serif", color: '#F2EEE6' }}>{t.company}</span>
                  <span className="muted pretty" style={{ font: "500 14px/1.4 'Barlow',sans-serif" }}>{t.lead || t.type}</span>
                </div>
              ))}
              <button className="btn btn-cta btn-gold" onClick={() => { if (changes) applyBrief(); else { markSeen(brief); setBrief(null); } }}>{changes ? 'Add to prospect list' : 'Done'}</button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderAdd = () => {
    if (!add) return null;
    const canSave = !!(add.company && add.phone);
    const set = (k: keyof AddForm) => (e: ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setAdd(a => a && { ...a, [k]: v }); };
    const fields: [keyof AddForm, string, string, string][] = [['company', 'Company', 'text', 'e.g. Perris Valley Grading'], ['contact', 'Contact name', 'text', 'First and last'], ['phone', 'Phone', 'tel', '(951) 555-0100'], ['city', 'City', 'text', 'e.g. Menifee']];
    const save = async () => {
      if (!canSave) return;
      if (cloudEnabled && !isOwner) {
        setAddMsg('Checking…');
        if (await reservedMatch(add.company!, add.phone!)) { setAddMsg(`This company already exists on ${OWNER_NAME}'s priority list. It can't be added.`); return; }
        setAddMsg('');
      }
      persist([{ id: Date.now(), addedAt: Date.now(), addedBy: me?.name, company: add.company!, contact: (add.contact || '').trim(), phone: add.phone!.replace(/\D/g, ''), type: add.type || 'Hauler', city: add.city || '', interest: add.interest || 'Both', status: 'new', next: null, calls: [] }, ...prospects]);
      setAdd(null);
    };
    const opts = (list: string[], k: 'type' | 'interest') => (
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {list.map(t => <button key={t} className="btn toggle opt" onClick={() => setAdd(a => a && { ...a, [k]: t })} style={{ background: selBg(add[k] === t), color: selFg(add[k] === t) }}>{t}</button>)}
      </div>
    );
    return (
      <div className="scrim" style={{ background: 'rgba(15,13,10,.55)' }}>
        <div className="sheet" style={{ gap: 12, maxHeight: '90%' }}>
          <div className="between">
            <h2>New prospect</h2>
            <button className="btn sheet-close" onClick={() => setAdd(null)}>Cancel</button>
          </div>
          {fields.map(([k, label, type, ph]) => (
            <label key={k} className="field">{label}
              <input value={(add[k] as string) || ''} onChange={set(k)} type={type} placeholder={ph} />
            </label>
          ))}
          {opts(['Hauler', 'Demolition', 'Paving', 'Grading', 'General contractor'], 'type')}
          <span className="field" style={{ marginTop: 4 }}>Materials interested in</span>
          {opts(['Dumping', 'Buying base', 'Both'], 'interest')}
          {addMsg && <span className="pretty" style={{ font: "600 15px/1.4 'Barlow',sans-serif", color: addMsg === 'Checking…' ? '#A39A8C' : '#F08A80' }}>{addMsg}</span>}
          <button className="btn btn-cta" onClick={save} style={{ background: canSave ? '#C9A45C' : '#3A352E', color: '#F2EEE6', marginTop: 4 }}>Save prospect</button>
        </div>
      </div>
    );
  };

  const renderEdit = () => {
    if (!edit) return null;
    type Key = 'company' | 'contact' | 'title' | 'phone' | 'email' | 'type' | 'city' | 'address';
    const fields: [Key, string, string, string][] = [
      ['company', 'Company', 'text', ''], ['contact', 'Contact name', 'text', 'First and last'], ['title', 'Title', 'text', 'Owner, estimator, PM'],
      ['phone', 'Phone', 'tel', '(951) 555-0100'], ['email', 'Email', 'email', ''], ['address', 'Street address', 'text', 'e.g. 1920 Goetz Rd'],
      ['city', 'City', 'text', 'e.g. Perris'], ['type', 'Type', 'text', 'e.g. Demolition'],
    ];
    const set = (k: keyof Prospect) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const v = e.target.value; setEdit(x => x && { ...x, [k]: v }); };
    const canSave = !!edit.company.trim();
    const save = () => {
      if (!canSave) return;
      const clean = { ...edit, company: edit.company.trim(), phone: (edit.phone || '').replace(/\D/g, '').slice(-10) };
      persist(prospects.map(p => (p.id === edit.id ? clean : p)));
      setEdit(null);
    };
    const statuses: [StatusKey, string][] = [['new', 'New'], ['follow', 'Follow-up'], ['interested', 'Interested'], ['customer', 'Customer'], ['notnow', 'Not now']];
    const chips = <T extends string>(list: [T, string][], cur: T | undefined, pick: (v: T) => void) => (
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {list.map(([v, l]) => <button key={v} className="btn toggle opt" onClick={() => pick(v)} style={{ background: selBg(cur === v), color: selFg(cur === v) }}>{l}</button>)}
      </div>
    );
    return (
      <div className="scrim" style={{ background: 'rgba(15,13,10,.55)' }}>
        <div className="sheet" style={{ gap: 12, maxHeight: '92%' }}>
          <div className="between">
            <h2>Edit details</h2>
            <button className="btn sheet-close" onClick={() => setEdit(null)}>Cancel</button>
          </div>
          {fields.map(([k, label, type, ph]) => (
            <label key={k} className="field">{label}
              <input value={edit[k] || ''} onChange={set(k)} type={type} placeholder={ph} />
            </label>
          ))}
          <span className="field" style={{ marginTop: 4 }}>Materials interested in</span>
          {chips([['Dumping', 'Dumping'], ['Buying base', 'Buying base'], ['Both', 'Both']], edit.interest, v => setEdit(x => x && { ...x, interest: v }))}
          <span className="field" style={{ marginTop: 4 }}>Status</span>
          {chips(statuses, edit.status, v => setEdit(x => x && { ...x, status: v }))}
          <span className="field" style={{ marginTop: 4 }}>Priority</span>
          {chips([['normal', 'Normal'], ['top', 'Top priority']], edit.top ? 'top' : 'normal', v => setEdit(x => x && { ...x, top: v === 'top' }))}
          <label className="field">Why call
            <textarea className="textarea" value={edit.lead || ''} onChange={set('lead')} placeholder="Project, bid or job that makes them worth calling now" style={{ minHeight: 80, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0 }} />
          </label>
          <label className="field">Notes
            <textarea className="textarea" value={edit.notes || ''} onChange={set('notes')} placeholder="Who to ask for, what they haul, how often" style={{ minHeight: 80, font: "500 16px/1.4 'Barlow',sans-serif", textTransform: 'none', letterSpacing: 0 }} />
          </label>
          <button className="btn btn-cta" onClick={save} style={{ background: canSave ? '#C9A45C' : '#3A352E', color: '#0E0D0B', marginTop: 4 }}>Save details</button>
        </div>
      </div>
    );
  };

  const renderAccount = () => {
    if (!account || !me) return null;
    return (
      <div className="scrim" style={{ background: 'rgba(15,13,10,.55)' }}>
        <div className="sheet" style={{ gap: 12, maxHeight: '92%' }}>
          <div className="between">
            <h2>{me.name || 'Account'}</h2>
            <button className="btn sheet-close" onClick={() => { setAccount(false); setSyncError(''); }}>Close</button>
          </div>
          <span className="muted" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>Signed in as {me.email} · {me.role === 'owner' ? 'Owner' : 'Team member'}</span>
          <div className="info-card card">
            <span className="t muted">Sync</span>
            <span className="b">{pending ? `${pending} change${pending > 1 ? 's' : ''} waiting for signal. They upload automatically.` : 'Everything is saved to the team list.'}</span>
            {syncError && <span style={{ font: "600 14px/1.4 'Barlow',sans-serif", color: '#F08A80' }}>Last error: {syncError}</span>}
            <button className="btn link-btn" onClick={() => sync()} style={{ alignSelf: 'flex-start' }}>Sync now</button>
          </div>
          <div className="info-card card">
            <span className="t muted">Backup</span>
            <span className="b">Download the prospect list and every call (with notes) as two spreadsheets you can keep.</span>
            <button className="btn link-btn" onClick={() => downloadBackup(prospects)} style={{ alignSelf: 'flex-start' }}>Download backup</button>
          </div>
          {me.role === 'owner' && <TeamManager team={team} me={me} onChanged={() => setTeam(null)} />}
          <button className="btn btn-outline" onClick={() => { setAccount(false); setTeam(null); signOut(); }} style={{ height: 52, borderRadius: 14, borderColor: '#3A352E', color: '#F08A80' }}>Sign out</button>
        </div>
      </div>
    );
  };

  if (cloudEnabled && (!authReady || (email && !meChecked))) {
    return <div className="app"><div className="col" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><span className="muted">Loading…</span></div></div>;
  }
  if (cloudEnabled && !email) return <SignIn />;
  if (cloudEnabled && !me) {
    return (
      <div className="app"><div className="signin">
        <h1>Not on the team yet</h1>
        <p className="muted pretty">{email} isn't on the Monarch Materials team list. Ask Larry to add you, then sign in again.</p>
        <button className="btn btn-cta btn-gold" onClick={() => signOut()}>Sign out</button>
      </div></div>
    );
  }

  const tabs: [Screen, string][] = [['today', 'Today'], ['prospects', 'Prospects'], ['route', 'Route'], ['log', 'Call log'], ['drive', 'Drive']];

  return (
    <div className="app">
      {showChrome && (
        <header className="header">
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            {logoFailed
              ? <div className="wordmark"><b>MONARCH</b><span>MATERIALS</span></div>
              : <img src={logoUrl} alt="Monarch Materials" onError={() => setLogoFailed(true)} />}
          </div>
          {cloudEnabled && me
            ? <button className="btn header-label" onClick={() => setAccount(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 40 }}>
                {pending > 0 && <span style={{ color: '#B5651D' }}>{pending} unsent ·</span>}{me.name || me.email.split('@')[0]} ▾
              </button>
            : <span className="header-label">{screen === 'log' ? 'Call log' : screen === 'route' ? 'Drive route' : 'Prospecting'}</span>}
        </header>
      )}
      <main className="main" ref={mainRef} onScroll={e => { scrollPos.current[screenRef.current] = e.currentTarget.scrollTop; }}>
        {screen === 'today' && renderToday()}
        {screen === 'prospects' && renderProspects()}
        {screen === 'detail' && renderDetail()}
        {screen === 'log' && renderLog()}
        {screen === 'route' && renderRoute()}
        {screen === 'teamday' && isOwner && renderTeamDay()}
        {screen === 'mylist' && isOwner && renderMyList()}
      </main>
      {showChrome && (
        <nav className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className="btn tab" onClick={() => { if (k === 'drive') return startDrive(); if (k === screen && mainRef.current) { mainRef.current.scrollTop = 0; scrollPos.current[k] = 0; } setScreen(k); }} style={{ color: tabKey === k ? '#C9A45C' : '#8A8276' }}>
              <i style={{ background: tabKey === k ? '#C9A45C' : 'transparent' }} />{label}{k === 'route' && routeStops.length > 0 && <b className="tab-count">{routeStops.length}</b>}{k === 'today' && attention.length + assignedToMe.length > 0 && <b className="tab-count" style={{ background: attention.length ? '#E07B24' : '#5B4FA8' }}>{attention.length + assignedToMe.length}</b>}
            </button>
          ))}
        </nav>
      )}
      {screen === 'call' && renderCall()}
      {screen === 'wrap' && renderWrap()}
      {screen === 'drive' && renderDrive()}
      {renderBrief()}
      {renderAdd()}
      {renderEdit()}
      {renderAccount()}
    </div>
  );
}

function SignIn() {
  const [create, setCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const submit = async () => {
    if (!email.trim() || !password) { setMsg('Enter your email and password.'); return; }
    setBusy(true); setMsg('');
    const err = await signIn(email, password, create);
    setBusy(false);
    if (err) setMsg(err);
  };
  return (
    <div className="app">
      <header className="header"><img src={logoUrl} alt="Monarch Materials" /><span className="header-label">Team sign-in</span></header>
      <div className="signin">
        <h1>{create ? 'Set your password' : 'Sign in'}</h1>
        <p className="muted pretty">{create ? 'First time here? Use the email Larry added to the team and pick a password.' : 'Use the email and password you set up for Monarch Materials.'}</p>
        <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label className="field">Password<input type="password" autoComplete={create ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder={create ? 'At least 6 characters' : ''} /></label>
        {msg && <span style={{ font: "600 15px/1.4 'Barlow',sans-serif", color: '#F08A80' }}>{msg}</span>}
        <button className="btn btn-cta btn-gold" onClick={submit}>{busy ? 'One moment…' : create ? 'Create password' : 'Sign in'}</button>
        <button className="btn link-btn" onClick={() => { setCreate(!create); setMsg(''); }} style={{ alignSelf: 'center', fontSize: 15 }}>
          {create ? 'Already set a password? Sign in' : 'First time? Set your password'}
        </button>
      </div>
    </div>
  );
}

function TeamManager({ team, me, onChanged }: { team: Member[] | null; me: Member; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const add = async () => {
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) { setMsg('Enter their name and a valid email.'); return; }
    const err = await addMember(name, email);
    if (err) { setMsg(err); return; }
    setMsg(`${name.trim()} added. Tell them to open the app, tap "First time? Set your password" and use ${email.trim().toLowerCase()}.`);
    setName(''); setEmail(''); onChanged();
  };
  const remove = async (m: Member) => {
    if (!window.confirm(`Remove ${m.name || m.email}? They lose access right away.`)) return;
    const err = await removeMember(m.email);
    setMsg(err || `${m.name || m.email} removed.`); onChanged();
  };
  return (
    <>
      <h2 className="h-section" style={{ marginTop: 6 }}>Team</h2>
      {team === null ? <span className="muted">Loading…</span> : team.map(m => (
        <div key={m.email} className="stop card">
          <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <span style={{ font: "700 16px 'Barlow',sans-serif" }}>{m.name || m.email}{m.role === 'owner' ? ' · Owner' : ''}</span>
            <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif", overflowWrap: 'anywhere' }}>{m.email}</span>
          </div>
          {m.email !== me.email && <button className="btn" onClick={() => remove(m)} style={{ font: "600 14px 'Barlow',sans-serif", color: '#F08A80', padding: '8px 4px' }}>Remove</button>}
        </div>
      ))}
      <span className="field" style={{ marginTop: 4 }}>Add an employee</span>
      <label className="field">Name<input value={name} onChange={e => setName(e.target.value)} placeholder="First and last" /></label>
      <label className="field">Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="them@example.com" /></label>
      {msg && <span className="pretty" style={{ font: "600 14px/1.4 'Barlow',sans-serif", color: '#E2C27F' }}>{msg}</span>}
      <button className="btn btn-cta btn-gold" onClick={add}>Add to team</button>
    </>
  );
}
