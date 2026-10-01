export type Who = 'You' | 'Them' | 'Call';
export interface Line { who: Who; text: string }
export type OutcomeKey = 'interested' | 'callback' | 'notnow' | 'won' | 'none';
export interface Call { id?: number; at: number; secs: number; outcome: OutcomeKey; summary: string; lines: Line[]; by?: string; attention?: boolean }
export type StatusKey = 'new' | 'follow' | 'interested' | 'customer' | 'notnow';

export interface Prospect {
  id: number;
  company: string;
  contact: string;
  title?: string;
  phone: string;
  email?: string;
  type: string;
  city: string;
  address?: string;
  interest: string;
  status: StatusKey;
  next: string | null;
  score?: number;
  size?: string;
  top?: boolean;
  lead?: string;
  notes?: string;
  source?: string;
  pinned?: number | null;
  addedAt?: number;
  /** Team member who added this prospect (team mode). */
  addedBy?: string;
  /** A team member asked the owner to call this prospect back. Cleared when the owner calls or marks it handled. */
  attention?: { by: string; at: number; note?: string } | null;
  /** Someone on the team tapped CALL on this prospect and hasn't saved the call yet. */
  calling?: { by: string; at: number } | null;
  calls: Call[];
}

/** A prospect parsed from a briefing CSV, before it gets an id and call history. */
export type BriefItem = Pick<Prospect, 'company' | 'contact' | 'phone' | 'type' | 'city' | 'interest'> &
  Required<Pick<Prospect, 'title' | 'email' | 'address' | 'score' | 'size' | 'top' | 'lead' | 'notes'>>;

export const STORAGE_KEY = 'monarch-prospects-v2';
export const BRIEF_AT_KEY = 'monarch-brief-at';
/** Fingerprint of the last published briefing the user reviewed, so it is offered only once. */
export const BRIEF_SEEN_KEY = 'monarch-brief-seen';

/** After a call saved from Drive Mode, advance to the next prospect. */
export const DRIVE_AUTO_NEXT = true;

/** Who the Attention button on the wrap-up screen asks to call back. */
export const OWNER_NAME = 'Larry';

export const PRICING_URL = 'https://monarch-materials.com/pricing/';

const DAY = 86400000;
const iso = (d: number) => new Date(d).toISOString().slice(0, 10);
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const rel = (n: number) => iso(startOfToday() + n * DAY);

interface Chip { label: string; bg: string; fg: string }
export const STATUS: Record<StatusKey, Chip> = {
  new: { label: 'New', bg: '#1B2533', fg: '#9CC0EA' },
  follow: { label: 'Follow-up', bg: '#33291A', fg: '#E2C27F' },
  interested: { label: 'Interested', bg: '#33291A', fg: '#E2C27F' },
  customer: { label: 'Customer', bg: '#16291D', fg: '#8FD1A4' },
  notnow: { label: 'Not now', bg: '#26231F', fg: '#B3AB9E' },
};
export const OUTCOME: Record<OutcomeKey, Chip & { status: StatusKey | null }> = {
  interested: { ...STATUS.follow, label: 'Interested', status: 'interested' },
  callback: { label: 'Call back', status: 'follow', bg: '#1B2533', fg: '#9CC0EA' },
  notnow: { ...STATUS.notnow, label: 'Not now', status: 'notnow' },
  won: { ...STATUS.customer, label: 'Won', status: 'customer' },
  none: { label: 'Logged', status: null, bg: '#26231F', fg: '#B3AB9E' },
};

export const seedProspects = (): Prospect[] => {
  const T0 = startOfToday();
  return [
    { id: 1, company: 'Inland Empire Demo Co.', contact: 'Ray Castillo', phone: '9515550142', type: 'Demolition', city: 'Riverside', interest: 'Dumping', status: 'follow', next: rel(0), calls: [
      { at: T0 - 3 * DAY + 36e6, secs: 262, outcome: 'callback', summary: 'Tearing out a 40k sq ft parking lot in Moreno Valley next month. Wants dump rates for end dumps.', lines: [
        { who: 'You', text: 'Hey Ray, this is with Monarch Materials over in Perris.' },
        { who: 'Them', text: 'Yeah, we got a lot job coming up in Moreno Valley, about forty thousand square feet.' },
        { who: 'You', text: 'We take clean asphalt and concrete. End dumps are no problem.' },
        { who: 'Them', text: 'Call me back Monday with the per-load rate.' }] }] },
    { id: 2, company: 'Sierra Grading & Paving', contact: 'Dana Whitfield', phone: '9095550187', type: 'Paving', city: 'Temecula', interest: 'Buying base', status: 'new', next: null, calls: [] },
    { id: 3, company: 'Valley Haulers LLC', contact: 'Marcus Lee', phone: '9515550163', type: 'Hauler', city: 'Perris', interest: 'Dumping', status: 'interested', next: rel(-1), calls: [
      { at: T0 - 6 * DAY + 50e6, secs: 145, outcome: 'interested', summary: 'Runs 6 super 10s. Interested in steady dumping close to the 215.', lines: [
        { who: 'Them', text: 'We run six super tens, mostly out of Menifee.' },
        { who: 'You', text: 'We are right off Goetz Road, easy in and out.' }] }] },
    { id: 4, company: 'Coastline Builders', contact: 'Priya Natarajan', phone: '7145550119', type: 'General contractor', city: 'Corona', interest: 'Buying base', status: 'new', next: null, calls: [] },
    { id: 5, company: 'Hemet Site Works', contact: 'Tony Alvarez', phone: '9515550108', type: 'Grading', city: 'Hemet', interest: 'Both', status: 'customer', next: rel(5), calls: [
      { at: T0 - 10 * DAY + 40e6, secs: 380, outcome: 'won', summary: 'Ordered 400 tons of crushed aggregate base for a pad in Hemet. Deliver Thursdays.', lines: [
        { who: 'Them', text: 'Let us do four hundred tons of base to start.' }] }] },
    { id: 6, company: 'Menifee Concrete Cutting', contact: 'Jess Romero', phone: '9515550174', type: 'Demolition', city: 'Menifee', interest: 'Dumping', status: 'new', next: null, calls: [] },
    { id: 7, company: 'Pacific Rim Trucking', contact: 'Hector Ruiz', phone: '9095550131', type: 'Hauler', city: 'Fontana', interest: 'Dumping', status: 'follow', next: rel(0), calls: [] },
  ];
};


export const CLAUDE_BRIEF_PROMPT = "Search the web for new concrete and asphalt demolition, paving, storm drain, airport and public works jobs in Riverside County and the Inland Empire announced or awarded in the last 7 days, plus the contractors who won or are bidding them. I run Monarch Materials, a concrete and asphalt recycling yard at 1920 Goetz Rd, Perris, CA. Return ONLY a CSV (no other text) with this exact header: company,contact,title,phone,email,category,city,address,priority,demo,lead,notes. Set priority to 'Most important' for large demo volume or jobs within 20 miles of Perris. demo is a 0-100 score for how much concrete/asphalt they could bring me. lead is one sentence on the new work. Only include real, verifiable info and leave unknown fields blank.";

export const parseCSV = (txt: string): Record<string, string>[] => {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && txt[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1) rows.push(row);
      row = [];
    } else f += c;
  }
  if (f || row.length) { row.push(f); if (row.length > 1) rows.push(row); }
  const hd = (rows.shift() || []).map(x => x.trim().toLowerCase());
  return rows.map(r => { const o: Record<string, string> = {}; hd.forEach((k, j) => o[k] = (r[j] || '').trim()); return o; });
};

export const normName = (s: string) => (s || '').toLowerCase().replace(/\b(inc|llc|co|corp|corporation|company|the)\b/g, '').replace(/[^a-z0-9]/g, '');

const DUMPCATS = /Demolition|cutting|Concrete|Asphalt|Ready-mix|Precast|pumping|Masonry/i;

export const toProspect = (o: Record<string, string>): BriefItem => {
  const g = (...keys: string[]) => { for (const k of keys) { const v = o[k]; if (v && v.trim()) return v.trim(); } return ''; };
  const type = g('category', 'type') || 'Other';
  return {
    company: g('company'), contact: g('contact'), title: g('title'), phone: g('phone', 'direct').replace(/\D/g, '').slice(-10), email: g('email'),
    type, city: g('city'), address: g('address'), interest: DUMPCATS.test(type) ? 'Dumping' : 'Both',
    score: +g('demo', 'score') || 0, size: g('demosize', 'size'), top: /most important|true|yes|high|top/i.test(g('priority', 'top')), lead: g('lead'), notes: g('notes'),
  };
};

export const fmtPhone = (p: string) => { const d = (p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p; };
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
export const fmtWhen = (t: number) => {
  const d = new Date(t);
  const days = Math.round((startOfToday() - new Date(t).setHours(0, 0, 0, 0)) / DAY);
  const tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return days === 0 ? `Today ${tm}` : days === 1 ? `Yesterday ${tm}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${tm}`;
};

export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

const DAY_MS = 86400000;
/** How long a CALL tap marks a prospect as "being called" if the call is never saved. */
export const CALLING_TTL = 30 * 60000;
export const callingNow = (p: Prospect) => (p.calling && Date.now() - p.calling.at < CALLING_TTL ? p.calling : null);
/** Called by anyone in the last 7 days: off the queue until its follow-up date comes up. */
export const recentlyCalled = (p: Prospect) => !!p.calls[0] && Date.now() - p.calls[0].at < 7 * DAY_MS;

/**
 * Call queue order: (for the owner) prospects flagged for their attention, pinned top leads, then due follow-ups,
 * then new, then open follow-ups; ties by top priority and score. Prospects someone is calling right now, or that
 * were called in the last week and have no follow-up due, are left out so two people don't call the same company.
 */
export const queueList = (prospects: Prospect[], ownerView = false) => {
  const today = rel(0);
  const rank = (p: Prospect) => {
    if (ownerView && p.attention) return -2;
    if (callingNow(p)) return 9;
    const due = !!p.next && p.next <= today;
    if (p.pinned && !recentlyCalled(p)) return -1;
    if (due) return 0;
    if (recentlyCalled(p)) return 9;
    return p.status === 'new' ? 1 : p.status === 'interested' || p.status === 'follow' ? 2 : 9;
  };
  return prospects.filter(p => rank(p) < 9).sort((a, b) => rank(a) - rank(b) || (b.pinned || 0) - (a.pinned || 0) || (b.top ? 1 : 0) - (a.top ? 1 : 0) || (b.score || 0) - (a.score || 0));
};

export const decorate = (p: Prospect) => {
  const st = STATUS[p.status] || STATUS.new;
  const last = p.calls[0];
  const due = !!p.next && p.next <= rel(0);
  const first = p.contact ? p.contact.split(' ')[0] : '';
  return {
    statusLabel: callingNow(p) ? `${p.calling!.by} calling…` : p.attention ? `Attention ${OWNER_NAME}` : p.pinned ? 'New top lead' : due ? 'Due today' : st.label,
    chipBg: callingNow(p) ? '#2B5C8A' : p.attention ? '#E07B24' : p.pinned ? '#D6362B' : due ? '#C9A45C' : st.bg,
    chipFg: callingNow(p) ? '#fff' : p.attention ? '#0E0D0B' : p.pinned ? '#fff' : due ? '#0E0D0B' : st.fg,
    lastLabel: last ? 'Last call ' + fmtWhen(last.at) : 'Never called',
    lastSummary: last ? last.summary : (p.lead || `${p.type} · interested in ${(p.interest || '').toLowerCase()}`),
    contact: p.contact || p.title || 'Main line',
    firstName: first,
    phoneFmt: p.phone ? fmtPhone(p.phone) : 'No phone yet',
    callLabel: !p.phone ? 'No phone number' : first ? 'Call ' + first : 'Call',
    textLabel: first ? `Text ${first} the pricing link` : 'Text the pricing link',
    sizeLabel: p.size ? `${p.size} demo volume · score ${p.score}` : '',
    smsHref: `sms:${p.phone}?body=${encodeURIComponent(`Hi ${first}, here's Monarch Materials pricing for dumping and recycled base: ${PRICING_URL}`)}`,
    mapHref: `https://www.google.com/maps/search/${encodeURIComponent(p.address || (p.company + ' ' + p.city + ' CA'))}`,
  };
};
export type Decorated = ReturnType<typeof decorate>;

/** Fetches briefing.csv published next to the app by the daily Claude run. Null when there is none or it can't be reached. */
export const fetchAutoBrief = async (): Promise<{ text: string; hash: string } | null> => {
  try {
    const res = await fetch('./briefing.csv', { cache: 'no-store' });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!/company/i.test(text.split(/\r?\n/)[0]) || text.split(/\r?\n/).length < 2) return null;
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return { text, hash: String(h) };
  } catch {
    return null;
  }
};

// ---- drive route ----
export const ROUTE_KEY = 'monarch-route';
export const ROUTE_HOME_KEY = 'monarch-route-home';
export const YARD = '1920 Goetz Rd, Perris, CA 92570';
/** Google Maps on a phone takes 3 waypoints + a destination per link, so longer routes are split into legs. */
const LEG = 4;

/** What Google Maps should search for: the street address when there is one, otherwise the company name and city. */
export const placeOf = (p: Prospect) => {
  const a = (p.address || '').trim(), c = (p.city || '').trim();
  if (a) {
    let s = a;
    if (c && !a.toLowerCase().includes(c.toLowerCase())) s += ', ' + c;
    if (!/\bCA\b|California/i.test(s)) s += ', CA';
    return s;
  }
  return [p.company, c, 'CA'].filter(Boolean).join(', ');
};

const dirURL = (origin: string, stops: string[], dest: string) => {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', origin);
  u.searchParams.set('destination', dest);
  if (stops.length) u.searchParams.set('waypoints', stops.join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
};

export interface Leg { url: string; label: string }

/** Google Maps links for the route, starting at the yard; each leg starts where the previous one ended. */
export const routeLegs = (stops: Prospect[], backToYard: boolean): Leg[] => {
  if (!stops.length) return [];
  const pts = stops.map(placeOf);
  if (backToYard) pts.push(YARD);
  const legs: Leg[] = [];
  let origin = YARD;
  for (let i = 0; i < pts.length; i += LEG) {
    const chunk = pts.slice(i, i + LEG);
    const dest = chunk[chunk.length - 1];
    const from = i + 1, to = Math.min(i + chunk.length, stops.length);
    const home = backToYard && i + chunk.length === pts.length;
    const range = from > to ? '' : from === to ? `stop ${from}` : `stops ${from}–${to}`;
    legs.push({ url: dirURL(origin, chunk.slice(0, -1), dest), label: `Leg ${legs.length + 1}: ${range}${home ? (range ? ' + ' : '') + 'back to yard' : ''}` });
    origin = dest;
  }
  if (legs.length === 1) legs[0].label = `Open route in Google Maps (${stops.length} stop${stops.length > 1 ? 's' : ''})`;
  return legs;
};
