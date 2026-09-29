import { CATEGORIES, TAGS, defaultLead, defaultNotes, demoScore, extract, fmtMoney, fmtPhone, guessCategory } from './extract.js';
import { addProspect, findMatch, loadIndex, loadMe, signIn, signOut, updateProspect } from './cloud.js';

const $ = id => document.getElementById(id);
const MAX_CARDS = 30;

let me = null;
let index = null; // [{ id, company, phone, city }] from the team list
let info = null; // what extract() found on the page
let tags = new Set();
let cards = []; // { el, amount, context, touched: Set, saved }

// ---------- sign-in ----------
async function start() {
  try { me = await loadMe(); } catch { me = null; }
  showSignedIn();
}
function showSignedIn() {
  $('signin').hidden = !!me;
  $('main').hidden = !me;
  $('signout').hidden = !me;
  $('who').textContent = me ? `${me.name || me.email} · saves to the Monarch team list` : '';
}
$('signinForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('signinError').textContent = '';
  const btn = e.submitter; btn.disabled = true;
  try { me = await signIn($('email').value, $('password').value); showSignedIn(); }
  catch (err) { $('signinError').textContent = err.message; }
  btn.disabled = false;
});
$('signout').addEventListener('click', async () => { await signOut(); me = null; index = null; showSignedIn(); });

function onError(err, el) {
  if (err.message === 'SIGNED_OUT') { me = null; showSignedIn(); $('signinError').textContent = 'Please sign in again.'; return; }
  el.textContent = /fetch/i.test(err.message) ? 'No connection to the team list. Check your internet and try again.' : err.message;
}

// ---------- reading the page ----------
const grab = () => ({ text: document.body ? document.body.innerText : '', title: document.title, url: location.href, selection: String(getSelection() || '') });

async function readTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) throw new Error('Open a web page (bid results, permits, news) and scan again.');
  if (/\.pdf(\?|#|$)/i.test(tab.url)) throw new Error('Chrome does not let extensions read PDFs. In the PDF press Ctrl+A, Ctrl+C, then use "+ Add by hand" > Paste text.');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab });
  return res.result;
}

$('scan').addEventListener('click', async () => {
  $('scanError').textContent = '';
  const btn = $('scan'); btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    const page = await readTab();
    index = await loadIndex(); // fresh each scan, so companies added from the phone are matched too
    show(extract(page));
  } catch (err) { onError(err, $('scanError')); }
  btn.disabled = false; btn.textContent = 'Scan this page';
});

async function ensureIndex() { if (!index) index = await loadIndex(); }

// ---------- pasted text (PDFs, emails) ----------
$('blank').addEventListener('click', async () => {
  $('scanError').textContent = '';
  if (!info) info = { tags: [], city: '', near: false, value: 0, title: '', url: '', companies: [] };
  if (!$('paste')) {
    const box = document.createElement('section');
    box.id = 'paste';
    box.innerHTML = '<label>Paste text from a PDF or email (optional)<textarea rows="4" id="pasteText"></textarea></label><div class="actions"><button class="primary" id="pasteScan">Find companies in text</button><button id="pasteBlank">Blank card</button></div>';
    $('results').before(box);
    $('pasteScan').addEventListener('click', async () => {
      const text = $('pasteText').value;
      if (text.trim().length < 20) { $('scanError').textContent = 'Paste some text first.'; return; }
      try { await ensureIndex(); show(extract({ text, title: text.split('\n').find(l => l.trim().length > 10)?.trim().slice(0, 120) || '', url: '' })); box.remove(); }
      catch (err) { onError(err, $('scanError')); }
    });
    $('pasteBlank').addEventListener('click', async () => {
      try { await ensureIndex(); } catch (err) { onError(err, $('scanError')); return; }
      box.remove();
      renderJob();
      $('results').prepend(makeCard({ company: '', phone: '', amount: 0, context: '' }));
    });
  }
});

// ---------- showing results ----------
function show(found) {
  info = found;
  tags = new Set(found.tags);
  renderJob();
  const list = found.companies.slice(0, MAX_CARDS);
  const results = $('results');
  results.replaceChildren();
  cards = [];
  if (!list.length) {
    results.innerHTML = '<div class="empty">No company names found here. Highlight the table or list of bidders and scan again, or use "+ Add by hand".</div>';
    return;
  }
  // Companies not on the list yet go first, then ones with a phone number.
  list.sort((a, b) => (!!findMatch(index, a.company, a.phone) - !!findMatch(index, b.company, b.phone)) || (!!b.phone - !!a.phone));
  for (const c of list) results.append(makeCard(c));
  if (found.companies.length > MAX_CARDS) results.insertAdjacentHTML('beforeend', `<div class="empty">Showing the first ${MAX_CARDS} of ${found.companies.length}. Highlight a smaller part of the page to narrow it down.</div>`);
}

function renderJob() {
  $('job').hidden = false;
  const box = $('tags');
  box.replaceChildren(...TAGS.map(t => {
    const b = document.createElement('button');
    b.className = 'chip' + (tags.has(t.key) ? ' on' : '');
    b.textContent = t.label;
    b.title = 'Tap to flag or unflag this job type';
    b.addEventListener('click', () => { tags.has(t.key) ? tags.delete(t.key) : tags.add(t.key); b.classList.toggle('on'); refreshDefaults(); });
    return b;
  }));
  const bits = [];
  if (info.city) bits.push(`${info.city}${info.near ? ' (within ~20 mi of the yard)' : ''}`);
  if (info.value) bits.push(`largest amount on page ${fmtMoney(info.value)}`);
  if (info.companies.length) bits.push(`${info.companies.length} compan${info.companies.length === 1 ? 'y' : 'ies'} found`);
  $('jobMeta').textContent = bits.join(' · ');
}

const jobInfo = () => ({ ...info, tags: [...tags] });

function defaults(c) {
  const j = jobInfo();
  const score = demoScore(j.tags, j.near, c.amount || j.value);
  return {
    lead: defaultLead(j, c.amount),
    notes: defaultNotes(j, c.context),
    score,
    top: j.near || score >= 70,
    category: guessCategory(c.company || '', j.tags),
  };
}

function makeCard(c) {
  const el = $('cardTpl').content.firstElementChild.cloneNode(true);
  const f = name => el.querySelector(`[data-f="${name}"]`);
  f('category').append(...CATEGORIES.map(v => new Option(v, v)));
  const d = defaults(c);
  f('company').value = c.company;
  f('phone').value = c.phone ? fmtPhone(c.phone) : '';
  f('city').value = info.city || '';
  f('category').value = d.category;
  f('interest').value = /Demolition|Hauler|Ready-mix|Concrete/.test(d.category) ? 'Dumping' : 'Both';
  f('lead').value = d.lead;
  f('notes').value = d.notes;
  f('score').value = d.score;
  f('top').checked = d.top;
  el.querySelector('.context').textContent = c.context || '';

  const card = { el, amount: c.amount, context: c.context, touched: new Set(), saved: false };
  cards.push(card);
  el.querySelectorAll('[data-f]').forEach(input => input.addEventListener('input', () => {
    card.touched.add(input.dataset.f);
    if (input.dataset.f === 'company' || input.dataset.f === 'phone') setStatus(card);
  }));
  el.querySelector('.save').addEventListener('click', () => save(card));
  el.querySelector('.dismiss').addEventListener('click', () => { el.remove(); cards = cards.filter(x => x !== card); });
  setStatus(card);
  return el;
}

function refreshDefaults() {
  for (const card of cards) {
    if (card.saved) continue;
    const d = defaults({ amount: card.amount, context: card.context, company: card.el.querySelector('[data-f="company"]').value });
    for (const k of ['lead', 'notes', 'score']) if (!card.touched.has(k)) card.el.querySelector(`[data-f="${k}"]`).value = d[k];
    if (!card.touched.has('top')) card.el.querySelector('[data-f="top"]').checked = d.top;
  }
}

function setStatus(card) {
  const f = name => card.el.querySelector(`[data-f="${name}"]`);
  const m = findMatch(index || [], f('company').value, f('phone').value);
  card.match = m;
  const st = card.el.querySelector('.status');
  st.className = 'status' + (m ? ' match' : '');
  st.textContent = m ? `Already on the list as "${m.company}"${m.city ? ` (${m.city})` : ''}. Saving adds this work to it.` : 'New company';
  card.el.querySelector('.save').textContent = m ? 'Add this work to their card' : 'Add to Monarch list';
}

async function save(card) {
  const f = name => card.el.querySelector(`[data-f="${name}"]`);
  const err = card.el.querySelector('.error');
  err.textContent = '';
  const lead = {
    company: f('company').value.trim(), phone: f('phone').value, city: f('city').value, category: f('category').value,
    interest: f('interest').value, lead: f('lead').value, notes: f('notes').value,
    score: Math.max(0, Math.min(100, +f('score').value || 0)), top: f('top').checked,
  };
  if (!lead.company) { err.textContent = 'Enter the company name.'; return; }
  const btn = card.el.querySelector('.save'); btn.disabled = true;
  try {
    if (card.match) await updateProspect(card.match.id, lead);
    else {
      const id = await addProspect(lead, me?.name);
      index.push({ id, company: lead.company, phone: lead.phone.replace(/\D/g, ''), city: lead.city });
    }
    card.saved = true;
    card.el.classList.add('done');
    const st = card.el.querySelector('.status');
    st.className = 'status saved';
    st.textContent = card.match ? `Saved to "${card.match.company}". It shows on the phone at the next sync.` : 'Added. It shows on the phone at the next sync.';
    btn.textContent = 'Saved';
    // Other cards for the same company now match it.
    cards.filter(x => !x.saved).forEach(setStatus);
  } catch (e) { onError(e, err); btn.disabled = false; }
}

start();
