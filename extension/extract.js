// Turns the text of a bid, permit or news page into lead candidates. Pure functions, no Chrome APIs,
// so they can be tested with plain Node (see test.mjs).

/** Job types worth flagging, with how much concrete/asphalt they usually mean for the yard. */
export const TAGS = [
  { key: 'demo', label: 'Demolition', weight: 30, re: /\b(demolition|demo(?:lish)?|tear[- ]?out|remove (?:and|&) (?:replace|reconstruct)|removal of (?:existing )?(?:concrete|asphalt|pavement|pcc|ac)\b)/i },
  { key: 'paving', label: 'Paving', weight: 20, re: /\b(paving|repav\w*|resurfac\w*|overlay|grind(?:ing)?|cold mill\w*|milling|slurry seal|pavement (?:rehab\w*|reconstruct\w*|repair|preservation)|asphalt(?:ic)? concrete|hot mix|\bhma\b)/i },
  { key: 'concrete', label: 'Concrete', weight: 20, re: /\b(concrete|curb and gutter|curb & gutter|sidewalk|flatwork|\bpcc\b|cross gutter|driveway approach)/i },
  { key: 'ada', label: 'ADA ramps', weight: 15, cs: /\bADA\b/, re: /\b(curb ramps?|pedestrian ramps?|access(?:ible|ibility)? ramps?|accessibility improvements)\b/i },
  { key: 'pipe', label: 'Pipeline', weight: 15, re: /\b(pipeline|sewer|water ?main|waterline|water line|force main|trunk line|septic[- ]to[- ]sewer|recycled water|potable water)\b/i },
  { key: 'storm', label: 'Storm drain', weight: 15, re: /\b(storm ?drain|flood control|channel|culvert|catch basin|mdp line|drainage)\b/i },
  { key: 'grading', label: 'Grading', weight: 15, re: /\b(grading|earthwork|excavation|mass grad\w*|rough grad\w*)\b/i },
  { key: 'bridge', label: 'Bridge', weight: 25, re: /\bbridges?\b/i },
  { key: 'airport', label: 'Airfield', weight: 20, re: /\b(runway|taxiway|apron|airfield|airport)\b/i },
];

/** Cities around the yard (1920 Goetz Rd, Perris). near = within about 20 miles. */
export const CITIES = [
  ['Perris', true], ['Moreno Valley', true], ['Menifee', true], ['Nuevo', true], ['Mead Valley', true], ['Romoland', true],
  ['Homeland', true], ['Winchester', true], ['Canyon Lake', true], ['Quail Valley', true], ['Sun City', true], ['Lakeview', true],
  ['Good Hope', true], ['Woodcrest', true], ['March ARB', true], ['March Air Reserve', true], ['Lake Elsinore', true],
  ['Wildomar', true], ['Murrieta', true], ['Hemet', true], ['San Jacinto', true], ['Riverside', true], ['Beaumont', false],
  ['Temecula', false], ['Corona', false], ['Jurupa Valley', false], ['Eastvale', false], ['Norco', false], ['Banning', false],
  ['Calimesa', false], ['Yucaipa', false], ['Redlands', false], ['Loma Linda', false], ['Colton', false], ['Grand Terrace', false],
  ['San Bernardino', false], ['Highland', false], ['Rialto', false], ['Fontana', false], ['Ontario', false], ['Rancho Cucamonga', false],
  ['Chino', false], ['Upland', false], ['Anza', false], ['Aguanga', false],
];

export const CATEGORIES = ['Paving contractor', 'Public works contractor', 'Demolition', 'Grading', 'Concrete', 'Hauler', 'Ready-mix / precast', 'City / public works', 'Other'];

// Words that mark a line or cell as a business name.
const SUFFIX = /\b(inc\.?|incorporated|llc|l\.l\.c\.|corp\.?|corporation|company|co\.|construction|constructors|contractors?|contracting|engineering|paving|asphalt|demolition|demo|grading|excavation|excavating|trucking|hauling|concrete|builders|enterprises|industries|materials|pipeline|underground|general engineering|landscape|sweeping|striping|electric)\b/i;
const NOT_A_NAME = /\b(bid|bids|bidder|project|notice|results?|total|amount|estimate|engineer's|city of|county of|department|district|agenda|item|page|date|due|opening|addend\w*|submitted|award(?:ed)?|contract no|plans?|specifications?|phone|fax|email|address)\b/i;

const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const MONEY = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s?\d+(?:\.\d+)?\s?(?:million|m|k)\b|\$\s?\d{4,}(?:\.\d{2})?/gi;

export const normName = s => (s || '').toLowerCase().replace(/\b(inc|llc|co|corp|corporation|company|the)\b/g, '').replace(/[^a-z0-9]/g, '');
export const digits = s => (s || '').replace(/\D/g, '').slice(-10);
export const fmtPhone = p => { const d = digits(p); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || ''; };

export function moneyValue(s) {
  const m = s.replace(/[$,\s]/g, '').toLowerCase().match(/^([\d.]+)(million|m|k)?$/);
  if (!m) return 0;
  return +m[1] * (m[2] === 'k' ? 1e3 : m[2] ? 1e6 : 1);
}
export const fmtMoney = v => v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`;

/** Splits a line into cells: table columns come through as tabs, lists as pipes or wide gaps. */
const cells = line => line.split(/\t| {3,}|\s\|\s|\s[•·]\s/).map(c => c.trim()).filter(Boolean);

function cleanName(c) {
  let s = c.replace(/^\s*(?:\d+[.)]|[-*•]|low bidder:?|apparent low bidder:?|awarded to:?|contractor:?|bidder:?|prime:?|sub(?:contractor)?:?)\s*/i, '')
    .replace(/[,;:]\s*$/, '').replace(/\s+/g, ' ').trim();
  // Stop at an address, phone or dollar amount that follows the name on the same cell.
  s = s.split(/\s(?:\d{2,6} [A-Z][a-z]+|\(?\d{3}\)?[\s.-]\d{3}|\$\d)/)[0].trim().replace(/[,;:-]\s*$/, '');
  return s;
}

function looksLikeName(s) {
  if (s.length < 4 || s.length > 70) return false;
  if (!/^[A-Z0-9&]/.test(s)) return false;
  if (!SUFFIX.test(s) || NOT_A_NAME.test(s)) return false;
  if (s.split(' ').length > 9) return false;
  if (/[a-z]{2,}[.!?]\s+[A-Z]/.test(s)) return false; // a sentence, not a name
  // Business names are in Title Case; descriptions ("Demolition of commercial building") are not.
  return !s.split(' ').some(w => /^[a-z]/.test(w) && !/^(of|and|the|de|la|del|y|dba|d\/b\/a)$/.test(w));
}

/**
 * page: { text, title, url, selection }. Uses the selection when there is one.
 * Returns { tags, city, near, value, title, companies: [{ company, phone, amount, context }] }.
 */
export function extract(page) {
  const text = (page.selection && page.selection.trim().length > 20 ? page.selection : page.text || '').replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.replace(/ /g, ' ').trimEnd()).filter(l => l.trim());

  const hit = (t, s) => t.re.test(s) || (t.cs && t.cs.test(s));
  const tags = TAGS.filter(t => hit(t, text) || hit(t, page.title || '')).map(t => t.key);
  const found = CITIES.map(([name, near]) => ({ name, near, n: (text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length })).filter(c => c.n);
  found.sort((a, b) => b.n - a.n || (b.near - a.near));
  const city = found[0]?.name || '';
  const near = found.some(c => c.near);

  const values = (text.match(MONEY) || []).map(moneyValue).filter(v => v >= 1000);
  const value = values.length ? Math.max(...values) : 0;

  // Company names by line.
  const names = []; // { name, line }
  lines.forEach((line, i) => {
    for (const c of cells(line)) {
      const n = cleanName(c);
      if (looksLikeName(n)) names.push({ name: n, line: i });
    }
  });

  // Phones by line, skipping fax numbers.
  const phones = []; // { phone, line }
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PHONE)) {
      const before = line.slice(Math.max(0, m.index - 12), m.index);
      if (/fax|\bf[:.]/i.test(before)) continue;
      phones.push({ phone: m[1] + m[2] + m[3], line: i });
    }
  });

  const byKey = new Map();
  for (const { name, line } of names) {
    const k = normName(name);
    if (!k || byKey.has(k)) continue;
    const amounts = (lines[line].match(MONEY) || []).map(moneyValue).filter(v => v >= 1000);
    byKey.set(k, { company: name, phone: '', amount: amounts[0] || 0, context: lines[line].trim().slice(0, 240), line });
  }

  // Give each phone to the closest name at or above it (same line, then up to 4 lines up, then 1 line down).
  const list = [...byKey.values()];
  const taken = new Set();
  for (const { phone, line } of phones) {
    let best = null, bestD = 99;
    for (const c of list) {
      if (c.phone) continue;
      const d = line - c.line;
      const score = d === 0 ? 0 : d > 0 && d <= 4 ? d : d === -1 ? 5 : 99;
      if (score < bestD) { best = c; bestD = score; }
    }
    if (best && bestD < 99 && !taken.has(phone)) { best.phone = phone; taken.add(phone); }
  }

  return { tags, city, near, value, title: (page.title || '').trim(), url: page.url || '', companies: list.map(({ line: _l, ...c }) => c) };
}

/** 0-100: how much concrete/asphalt this job could mean for the yard. */
export function demoScore(tags, near, value) {
  let s = TAGS.filter(t => tags.includes(t.key)).reduce((a, t) => a + t.weight, 0);
  if (near) s += 15;
  if (value >= 5e6) s += 15; else if (value >= 1e6) s += 10; else if (value >= 2.5e5) s += 5;
  return Math.max(10, Math.min(100, s));
}

export function guessCategory(company, tags) {
  const n = company.toLowerCase();
  if (/demo/.test(n)) return 'Demolition';
  if (/trucking|hauling/.test(n)) return 'Hauler';
  if (/ready|precast|materials/.test(n)) return 'Ready-mix / precast';
  if (/paving|asphalt/.test(n)) return 'Paving contractor';
  if (/grading|excavat/.test(n)) return 'Grading';
  if (/concrete/.test(n)) return 'Concrete';
  if (/^(city|county) of|district|department/.test(n)) return 'City / public works';
  if (tags.includes('paving') && !tags.includes('pipe') && !tags.includes('storm')) return 'Paving contractor';
  return 'Public works contractor';
}

/** One-sentence default lead for the job on this page. */
export function defaultLead(info, amount) {
  const labels = TAGS.filter(t => info.tags.includes(t.key)).map(t => (/^[A-Z]{2}/.test(t.label) ? t.label : t.label.toLowerCase()));
  const title = info.title.replace(/\s*[|–—-]\s*[^|–—-]*$/, '').trim().slice(0, 120);
  const bits = [title || 'Job on this page'];
  if (info.city) bits.push(`in ${info.city}`);
  const v = amount || info.value;
  if (v) bits.push(`(${fmtMoney(v)})`);
  let s = bits.join(' ');
  if (labels.length) s += ` - ${labels.slice(0, 4).join(', ')}`;
  return s + '.';
}

export function defaultNotes(info, context) {
  let host = '';
  try { host = new URL(info.url).hostname.replace(/^www\./, ''); } catch { /* not a URL */ }
  const d = new Date();
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return [`Source: ${host || 'web page'}, seen ${date}.`, context ? `Page line: "${context}"` : '', info.url].filter(Boolean).join(' ');
}
