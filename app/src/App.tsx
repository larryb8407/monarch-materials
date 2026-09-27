import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  BRIEF_AT_KEY, BRIEF_SEEN_KEY, CLAUDE_BRIEF_PROMPT, DEMO, DEMO_TRANSCRIPT, DRIVE_AUTO_NEXT, OUTCOME, STORAGE_KEY,
  ROUTE_HOME_KEY, ROUTE_KEY, decorate, fetchAutoBrief, fmtPhone, placeOf, routeLegs, fmtTime, fmtWhen, isMobile, normName, parseCSV, queueList, rel, seedProspects, startOfToday, summarize, toProspect,
  type BriefItem, type Line, type StatusKey, type OutcomeKey, type Prospect,
} from './lib';
import { speechSupported, startRec, stopRec } from './speech';
import { addMember, cloudEnabled, diffOps, enqueue, flush, getSession, loadMe, loadTeam, loadTeamList, onAuth, pendingCount, removeMember, signIn, signOut, type Member } from './cloud';
import bundledProspects from './prospects.json';
import logoUrl from './monarch-logo.webp';

type Screen = 'today' | 'prospects' | 'detail' | 'log' | 'route' | 'call' | 'wrap' | 'drive';
type Filter = 'all' | 'top' | 'new' | 'follow' | 'customer';
interface LiveCall { start: number; secs: number; lines: Line[] }
interface Wrap { outcome: OutcomeKey | null; follow: number | null; note: string; summary: string }
interface Brief { step: 'input' | 'review'; text: string; busy: boolean; error: string; auto?: string; added?: BriefItem[]; updated?: (BriefItem & { id: number })[] }
interface AddForm { company?: string; contact?: string; phone?: string; city?: string; type: string; interest: string }

const loadProspects = (): Prospect[] => {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(s)) return s;
  } catch { /* fall through to bundled list */ }
  return bundledProspects as Prospect[];
};
const readBriefAt = () => { try { return localStorage.getItem(BRIEF_AT_KEY); } catch { return null; } };
const readRoute = (): number[] => { try { const r = JSON.parse(localStorage.getItem(ROUTE_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
const readRouteHome = () => { try { return localStorage.getItem(ROUTE_HOME_KEY) !== '0'; } catch { return true; } };
const readSeen = () => { try { return localStorage.getItem(BRIEF_SEEN_KEY); } catch { return null; } };

const whoColor = (w: string, live: boolean) => (w === 'You' ? '#C9A45C' : w === 'Them' ? (live ? '#7FB2E5' : '#9CC0EA') : (live ? '#B8AE9F' : '#A39A8C'));
const selBg = (on: boolean) => (on ? '#C9A45C' : '#1A1815');
const selFg = (on: boolean) => (on ? '#0E0D0B' : '#F2EEE6');

const PinIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>;

const Chip = ({ bg, fg, label }: { bg: string; fg: string; label: string }) => <span className="chip" style={{ background: bg, color: fg }}>{label}</span>;

const ProspectRow = ({ p, compact, onOpen, onCall, onRoute, routed }: { p: Prospect; compact?: boolean; onOpen: (id: number) => void; onCall: (id: number) => void; onRoute: (id: number) => void; routed: boolean }) => {
  const d = decorate(p);
  return (
    <div className="prow card">
      <button className="btn prow-main" onClick={() => onOpen(p.id)}>
        <span className="prow-name" style={compact ? { fontSize: 17 } : undefined}>{p.company}</span>
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

const TranscriptLine = ({ l, live }: { l: Line; live?: boolean }) => (
  <div className="tline" style={live ? { gap: 3 } : undefined}>
    <span className="who" style={{ color: whoColor(l.who, !!live), letterSpacing: live ? '.1em' : undefined }}>{l.who}</span>
    <span style={{ font: live ? "500 19px/1.4 'Barlow',sans-serif" : "400 15px/1.4 'Barlow',sans-serif" }}>{l.text}</span>
  </div>
);

export default function App() {
  const [prospects, setProspects] = useState<Prospect[]>(loadProspects);
  const [screen, setScreen] = useState<Screen>('today');
  const [prev, setPrev] = useState<Screen>('today');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openCall, setOpenCall] = useState<number | null>(null);
  const [call, setCall] = useState<LiveCall | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [wrap, setWrap] = useState<Wrap | null>(null);
  const [dictating, setDictating] = useState(false);
  const [driveIdx, setDriveIdx] = useState(0);
  const [voice, setVoice] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [add, setAdd] = useState<AddForm | null>(null);
  const [edit, setEdit] = useState<Prospect | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefAt, setBriefAt] = useState<string | null>(readBriefAt);
  const [route, setRoute] = useState<number[]>(readRoute);
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

  const timer = useRef<number | undefined>(undefined);
  const demo = useRef<number | undefined>(undefined);
  const wasDrive = useRef(false);
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
    if (err) setSyncError(err);
    try { showServerList(await loadTeamList()); } catch { /* offline: keep the on-phone copy */ }
  }

  useEffect(() => {
    if (!cloudEnabled) return;
    if (!email) { setMe(null); setMeChecked(false); return; }
    let live = true;
    (async () => {
      const m = await loadMe(email).catch(() => null);
      if (!live) return;
      setMe(m); meRef.current = m; setMeChecked(true);
      if (!m) return;
      try {
        const list = await loadTeamList();
        if (!list.length && m.role === 'owner') {
          // First owner sign-in: the list on this phone (with its call history) becomes the team list.
          const local = loadProspects();
          enqueue(diffOps([], local, m.name));
          showServerList(local);
          await flush();
          setPending(pendingCount());
        } else showServerList(list);
      } catch { /* offline: keep the on-phone copy until the next sync */ }
    })();
    return () => { live = false; };
  }, [email]);

  useEffect(() => {
    if (!cloudEnabled) return;
    const onShow = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', onShow);
    const every = window.setInterval(onShow, 60000);
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('online', onShow); clearInterval(every); };
  }, []);
  useEffect(() => () => { clearInterval(timer.current); clearInterval(demo.current); stopRec(); }, []);

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

  // Owner's Team list: (re)load whenever the account sheet is open and the list was reset.
  useEffect(() => {
    if (account && me?.role === 'owner' && team === null) loadTeam().then(setTeam).catch(() => setSyncError('Could not load the team. Check your connection.'));
  }, [account, me, team]);

  function persist(ps: Prospect[]) {
    if (cloudEnabled && meRef.current) {
      enqueue(diffOps(prospectsRef.current, ps, meRef.current.name));
      setPending(pendingCount());
      flush().then(err => { setPending(pendingCount()); if (err) setSyncError(err); });
    }
    prospectsRef.current = ps;
    setProspects(ps);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ps)); } catch { /* storage full or blocked */ }
  }

  const cur = prospects.find(p => p.id === activeId);

  // ---- drive route ----
  const saveRoute = (ids: number[]) => { setRoute(ids); try { localStorage.setItem(ROUTE_KEY, JSON.stringify(ids)); } catch { /* ignore */ } };
  const toggleRoute = (id: number) => saveRoute(route.includes(id) ? route.filter(x => x !== id) : [...route, id]);
  const routeStops = route.map(id => prospects.find(p => p.id === id)).filter((p): p is Prospect => !!p);

  const queue = queueList(prospects);
  const today = rel(0);
  const T0 = startOfToday();
  const callsToday = prospects.reduce((n, p) => n + p.calls.filter(c => c.at >= T0 && (isOwner || c.by === me?.name)).length, 0);

  const open = (id: number) => { setActiveId(id); setPrev(screen); setScreen('detail'); setOpenCall(null); };
  const leaveDetail = () => setScreen(prev === 'detail' ? 'today' : prev);

  // ---- calls ----
  function placeCall(id: number) {
    const p = prospects.find(x => x.id === id); if (!p) return;
    if (!p.phone) { open(id); return; }
    stopRec(); clearInterval(demo.current);
    const start = Date.now();
    setActiveId(id); setScreen('call'); setCall({ start, secs: 0, lines: [] }); setListening(false); setInterim(''); setVoice(false);
    clearInterval(timer.current);
    timer.current = window.setInterval(() => setCall(c => (c ? { ...c, secs: Math.round((Date.now() - c.start) / 1000) } : c)), 1000);
    if (isMobile) {
      const a = document.createElement('a'); a.href = 'tel:' + p.phone; a.click();
    } else if (DEMO_TRANSCRIPT) {
      let i = 0;
      setListening(true);
      demo.current = window.setInterval(() => {
        if (i >= DEMO.length) { clearInterval(demo.current); setListening(false); return; }
        const l = DEMO[i++];
        setCall(c => (c ? { ...c, lines: [...c.lines, l] } : c));
      }, 1800);
    }
  }
  const callFrom = (id: number) => { wasDrive.current = false; setPrev(screen); placeCall(id); };

  const toggleListen = () => {
    if (listening) { stopRec(); clearInterval(demo.current); setListening(false); setInterim(''); return; }
    setListening(startRec(t => setCall(c => (c ? { ...c, lines: [...c.lines, { who: 'Call', text: t }] } : c)), setInterim));
  };

  const endCall = () => {
    clearInterval(timer.current); clearInterval(demo.current); stopRec();
    setScreen('wrap'); setListening(false); setInterim('');
    setWrap({ outcome: null, follow: null, note: '', summary: summarize(call ? call.lines : []) });
  };

  const toggleDictate = () => {
    if (dictating) { stopRec(); setDictating(false); setInterim(''); return; }
    setDictating(startRec(t => setWrap(w => (w ? { ...w, note: (w.note ? w.note + ' ' : '') + t } : w)), setInterim));
  };

  const saveWrap = () => {
    if (!wrap || !call) return;
    stopRec();
    const oc = wrap.outcome || 'none';
    const summary = [wrap.note, call.lines.length ? wrap.summary : ''].filter(Boolean).join(' — ') || 'Call logged, no notes.';
    const next = wrap.follow == null ? undefined : wrap.follow === -1 ? null : rel(wrap.follow);
    persist(prospects.map(p => p.id !== activeId ? p : {
      ...p, pinned: null,
      status: OUTCOME[oc].status || ((wrap.follow ?? 0) > 0 ? 'follow' : p.status),
      next: next === undefined ? (p.next && p.next <= today ? null : p.next) : next,
      calls: [{ id: call.start * 1000 + Math.floor(Math.random() * 1000), at: call.start, secs: call.secs, outcome: oc, summary, lines: call.lines, by: me?.name }, ...p.calls],
    }));
    const fromDrive = prev === 'drive' || wasDrive.current;
    setWrap(null); setCall(null); setDictating(false);
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

  const startDrive = () => { driveQueue.current = queueList(prospects); setScreen('drive'); setDriveIdx(0); };
  const driveCall = (p: Prospect | undefined) => { if (!p) return; wasDrive.current = true; setPrev('drive'); placeCall(p.id); };
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
  const tabKey = screen === 'detail' ? prev : screen;
  const briefLabel = briefAt ? 'Last updated ' + fmtWhen(+briefAt) : 'Not updated yet';

  const q = search.toLowerCase();
  const inF = (p: Prospect, k: Filter) => k === 'all' || (k === 'top' ? !!p.top : k === 'follow' ? ['follow', 'interested'].includes(p.status) : p.status === k);
  const filtered = prospects.filter(p => inF(p, filter) && (!q || [p.company, p.contact, p.city, p.type, p.lead, p.notes, p.address].join(' ').toLowerCase().includes(q)));
  const filterDefs: [Filter, string][] = [['all', 'All'], ['top', 'Top priority'], ['new', 'New'], ['follow', 'Follow-up'], ['customer', 'Customers']];

  const log = prospects.flatMap(p => p.calls.map(c => ({ ...c, pid: p.id, company: p.company }))).sort((a, b) => b.at - a.at);

  const renderToday = () => (
    <div className="today">
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <h1>{queue.length} calls in today's queue</h1>
      </div>
      <div className="grid2">
        <div className="stat card"><b>{callsToday}</b><span>{cloudEnabled && isOwner ? 'Team calls today' : 'Calls made today'}</span></div>
        <div className="stat card"><b style={{ color: '#D9B872' }}>{prospects.filter(p => p.next && p.next <= today).length}</b><span>Follow-ups due</span></div>
      </div>
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
        {queue.slice(0, 5).map(p => <ProspectRow key={p.id} p={p} onOpen={open} onCall={callFrom} onRoute={toggleRoute} routed={route.includes(p.id)} />)}
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
        {filtered.slice().sort((a, b) => (b.pinned || 0) - (a.pinned || 0)).map(p => <ProspectRow key={p.id} p={p} compact onOpen={open} onCall={callFrom} onRoute={toggleRoute} routed={route.includes(p.id)} />)}
        {!filtered.length && <p className="muted" style={{ margin: '24px 0', textAlign: 'center', font: "500 15px 'Barlow',sans-serif" }}>No prospects match.</p>}
      </div>
      <button className="btn fab" onClick={openAdd}>+ Add prospect</button>
    </div>
  );

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
        {cur.notes && <div className="info-card card"><span className="t muted">Notes</span><span className="b">{cur.notes}</span></div>}
        <button className="btn btn-gold press" onClick={() => { wasDrive.current = false; placeCall(cur.id); }} style={{ height: 68, borderRadius: 18, font: "800 26px/1 'Barlow Condensed',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase' }}>{d.callLabel}</button>
        <div className="grid2">
          <a className="btn-outline" href={d.smsHref} style={{ height: 52, borderRadius: 14 }}>Text pricing link</a>
          <a className="btn-outline" href={d.mapHref} target="_blank" rel="noreferrer" style={{ height: 52, borderRadius: 14 }}>Directions</a>
        </div>
        <button className="btn btn-outline" onClick={() => toggleRoute(cur.id)} style={{ height: 52, borderRadius: 14, ...(route.includes(cur.id) ? { borderColor: '#3A352E', color: '#A39A8C' } : {}) }}>
          {route.includes(cur.id) ? `On the route (stop ${route.indexOf(cur.id) + 1}) · Remove` : 'Add to drive route'}
        </button>
        <div className="col" style={{ gap: 6 }}>
          {cur.email && <a href={'mailto:' + cur.email} style={{ font: "600 15px/1.4 'Barlow',sans-serif", color: '#D9B872', wordBreak: 'break-all' }}>{cur.email}</a>}
          {cur.address && <span className="muted" style={{ font: "500 15px/1.4 'Barlow',sans-serif" }}>{cur.address}</span>}
        </div>
        {cur.next && <div className="follow-banner">Follow up {new Date(cur.next + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>}
        <div className="between" style={{ marginTop: 6 }}>
          <h2 className="h-section">Call history</h2>
          <button className="btn" onClick={deleteCurrent} style={{ height: 40, padding: '0 4px', display: 'flex', alignItems: 'center', font: "600 14px 'Barlow',sans-serif", color: '#F08A80' }}>Delete prospect</button>
        </div>
        {!cur.calls.length && <p className="muted" style={{ font: "500 15px 'Barlow',sans-serif" }}>No calls yet.</p>}
        <div className="col" style={{ gap: 10 }}>
          {cur.calls.map((c, i) => {
            const o = OUTCOME[c.outcome] || OUTCOME.none;
            const isOpen = openCall === i;
            return (
              <div key={c.at} className="history card">
                <div className="between" style={{ gap: 8 }}>
                  <span className="muted" style={{ font: "600 14px 'Barlow',sans-serif" }}>{fmtWhen(c.at)} · {fmtTime(c.secs)}{c.by ? ` · ${c.by}` : ''}</span>
                  <Chip bg={o.bg} fg={o.fg} label={o.label} />
                </div>
                <p className="pretty" style={{ font: "500 16px/1.4 'Barlow',sans-serif" }}>{c.summary}</p>
                {c.lines.length > 0 && (
                  <button className="btn" onClick={() => setOpenCall(isOpen ? null : i)} style={{ alignSelf: 'flex-start', height: 36, display: 'flex', alignItems: 'center', font: "700 14px 'Barlow',sans-serif", color: '#D9B872' }}>
                    {isOpen ? 'Hide transcript' : `View transcript (${c.lines.length})`}
                  </button>
                )}
                {isOpen && (
                  <div className="col" style={{ gap: 8, borderTop: '1px solid #2E2A24', paddingTop: 10 }}>
                    {c.lines.map((l, j) => <TranscriptLine key={j} l={l} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLog = () => (
    <div className="log">
      <h1 style={{ font: "700 30px/1.05 'Barlow Condensed',sans-serif" }}>Call log</h1>
      {log.map(c => {
        const o = OUTCOME[c.outcome] || OUTCOME.none;
        return (
          <button key={c.pid + '-' + c.at} className="btn log-item card" onClick={() => open(c.pid)}>
            <div className="between" style={{ gap: 8 }}>
              <span style={{ font: "700 17px/1.2 'Barlow',sans-serif" }}>{c.company}</span>
              <span className="chip" style={{ flex: 'none', background: o.bg, color: o.fg }}>{o.label}</span>
            </div>
            <span className="muted" style={{ font: "500 13px 'Barlow',sans-serif" }}>{fmtWhen(c.at)} · {fmtTime(c.secs)}{c.by ? ` · ${c.by}` : ''} · {c.lines.length} transcript lines</span>
            <span className="pretty" style={{ font: "500 15px/1.4 'Barlow',sans-serif", color: '#CFC8BC' }}>{c.summary}</span>
          </button>
        );
      })}
    </div>
  );

  const renderRoute = () => {
    const legs = routeLegs(routeStops, backToYard);
    const cities = [...new Set(prospects.map(p => (p.city || '').trim()).filter(Boolean))].sort();
    const cand = prospects
      .filter(p => !route.includes(p.id) && p.status !== 'notnow' && (p.top || (p.score || 0) >= candMin) && (!candCity || (p.city || '').trim() === candCity))
      .sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || (b.score || 0) - (a.score || 0) || a.company.localeCompare(b.company));
    const move = (i: number, d: number) => { const ids = routeStops.map(p => p.id), j = i + d; [ids[i], ids[j]] = [ids[j], ids[i]]; saveRoute(ids); };
    const setHome = (on: boolean) => { setBackToYard(on); try { localStorage.setItem(ROUTE_HOME_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
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

  const renderCall = () => {
    const c = call || { secs: 0, lines: [] };
    return (
      <div className="overlay call-screen">
        <div className="between">
          <span className="rec"><i />{listening ? 'On call · Transcribing' : 'On call'}</span>
          <span className="timer">{fmtTime(c.secs)}</span>
        </div>
        <h1 style={{ margin: '18px 0 2px', font: "700 36px/1.05 'Barlow Condensed',sans-serif" }}>{cur?.company}</h1>
        <span style={{ font: "500 17px 'Barlow',sans-serif", color: '#B8AE9F' }}>{cur && decorate(cur).contact} · {cur && (cur.phone ? fmtPhone(cur.phone) : 'No phone yet')}</span>
        <div className="transcript">
          {!c.lines.length && (
            <p className="pretty" style={{ font: "500 16px/1.45 'Barlow',sans-serif", color: '#8A8276' }}>
              {speechSupported ? 'Put the call on speaker and tap Transcribe. Lines appear here and are saved with the call.' : 'Live transcription is not supported in this browser. Use Chrome on Android.'}
            </p>
          )}
          {c.lines.map((l, i) => <TranscriptLine key={i} l={l} live />)}
          {listening && interim && <span style={{ font: "500 19px/1.4 'Barlow',sans-serif", color: '#8A8276' }}>{interim}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
          <button className="btn" onClick={toggleListen} style={{ height: 72, borderRadius: 20, border: `2px solid ${listening ? '#C9A45C' : '#3D372F'}`, color: '#F5F2EC', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', font: "700 16px/1.15 'Barlow',sans-serif" }}>
            {listening ? 'Pause transcript' : 'Transcribe'}
          </button>
          <button className="btn end-call" onClick={endCall}>End call</button>
        </div>
      </div>
    );
  };

  const renderWrap = () => {
    const w = wrap || { outcome: null, follow: null, note: '', summary: '' };
    const lines = call ? call.lines.length : 0;
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
          </div>
          <div className="between">
            <span className="label">Notes</span>
            <button className="btn" onClick={toggleDictate} style={{ height: 40, padding: '0 14px', borderRadius: 20, background: dictating ? '#C9A45C' : '#2E2A24', color: dictating ? '#0E0D0B' : '#F2EEE6', display: 'flex', alignItems: 'center', font: "700 14px 'Barlow',sans-serif" }}>
              {dictating ? 'Stop dictating' : 'Dictate'}
            </button>
          </div>
          <textarea className="textarea" value={w.note} onChange={e => { const v = e.target.value; setWrap(x => x && { ...x, note: v }); }} placeholder="Tap Dictate and talk — or type" style={{ minHeight: 96, font: "500 16px/1.4 'Barlow',sans-serif" }} />
          <div className="history card">
            <span className="label">Transcript summary</span>
            <p className="pretty" style={{ font: "500 16px/1.4 'Barlow',sans-serif" }}>{w.summary}</p>
            <span style={{ font: "500 13px 'Barlow',sans-serif", color: '#8A8276' }}>{lines} lines saved to call history</span>
          </div>
          {cur && <a className="btn-outline" href={decorate(cur).smsHref} style={{ height: 52, borderRadius: 14 }}>{decorate(cur).textLabel}</a>}
        </div>
        <div className="wrap-foot">
          <button className="btn btn-gold" onClick={saveWrap} style={{ width: '100%', height: 64, borderRadius: 18, font: "800 24px/1 'Barlow Condensed',sans-serif", letterSpacing: '.06em', textTransform: 'uppercase' }}>
            {wasDrive.current ? 'Save & next call' : 'Save call'}
          </button>
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
            <span style={{ font: "500 19px/1.4 'Barlow',sans-serif", color: '#B8AE9F' }}>{callsToday} calls made today. Transcripts are in the call log.</span>
          </div>
        )}
      </div>
    );
  };

  function openBrief() { setBrief({ step: 'input', text: '', busy: false, error: '' }); }
  function openAdd() { setAdd({ type: 'Hauler', interest: 'Dumping' }); }

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
    const save = () => {
      if (!canSave) return;
      persist([{ id: Date.now(), company: add.company!, contact: (add.contact || '').trim(), phone: add.phone!.replace(/\D/g, ''), type: add.type || 'Hauler', city: add.city || '', interest: add.interest || 'Both', status: 'new', next: null, calls: [] }, ...prospects]);
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
      <main className="main">
        {screen === 'today' && renderToday()}
        {screen === 'prospects' && renderProspects()}
        {screen === 'detail' && renderDetail()}
        {screen === 'log' && renderLog()}
        {screen === 'route' && renderRoute()}
      </main>
      {showChrome && (
        <nav className="tabs">
          {tabs.map(([k, label]) => (
            <button key={k} className="btn tab" onClick={() => (k === 'drive' ? startDrive() : setScreen(k))} style={{ color: tabKey === k ? '#C9A45C' : '#8A8276' }}>
              <i style={{ background: tabKey === k ? '#C9A45C' : 'transparent' }} />{label}{k === 'route' && routeStops.length > 0 && <b className="tab-count">{routeStops.length}</b>}
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
