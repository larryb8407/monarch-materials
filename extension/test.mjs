// Quick check of the page parser: node test.mjs
import assert from 'node:assert/strict';
import { extract, demoScore, defaultLead } from './extract.js';

const bid = {
  title: 'Bid Results - Van Buren Boulevard Resurfacing | County of Riverside Transportation',
  url: 'https://trans.rctlma.org/bid-results',
  text: `County of Riverside Transportation Department
Summary of Bids
Project: Van Buren Boulevard Resurfacing and Curb Ramp Improvements, Woodcrest
Bid Opening: September 16, 2026
Engineer's Estimate\t$3,100,000.00
1\tVance Corporation\t$2,812,450.00\t(951) 849-9660
2\tAll American Asphalt\t$2,990,100.00\t951-736-7600
3\tR.J. Noble Company\t$3,050,000.00
Fax (951) 555-0000
Page 1 of 2`,
};
const r = extract(bid);
console.log(JSON.stringify(r, null, 1));
const names = r.companies.map(c => c.company);
assert.deepEqual(names, ['Vance Corporation', 'All American Asphalt', 'R.J. Noble Company']);
assert.equal(r.companies[0].phone, '9518499660');
assert.equal(r.companies[1].phone, '9517367600');
assert.equal(r.companies[2].phone, '');
assert.equal(r.companies[0].amount, 2812450);
assert.ok(r.tags.includes('paving') && r.tags.includes('ada'));
assert.equal(r.city, 'Woodcrest');
assert.ok(r.near);

const permit = {
  title: 'Permit search', url: 'https://example.gov/permits',
  text: `Permit # B26-0412   Demolition of commercial building and parking lot   1234 Main St, Perris
Contractor: Inland Demo & Grading Inc.   Phone: 951.657.1234
Permit # E26-0099   Electrical panel upgrade   Hemet
Contractor: Sparky Electric LLC  (909) 555-1111
The contractor will remove all concrete. City staff reviewed the plans.`,
};
const p = extract(permit);
console.log(JSON.stringify(p.companies, null, 1), p.tags, p.city);
assert.equal(p.companies[0].company, 'Inland Demo & Grading Inc.');
assert.equal(p.companies[0].phone, '9516571234');
assert.ok(p.tags.includes('demo'));
assert.ok(!r.tags.includes('pipe'));
console.log(demoScore(r.tags, r.near, 3e6), defaultLead({ ...r }, 2812450));

const news = { title: 'Canada visit', url: 'x', text: 'Ada Lovelace spoke about pipes in Canada.' };
assert.ok(!extract(news).tags.includes('ada'));
console.log('all passed');
