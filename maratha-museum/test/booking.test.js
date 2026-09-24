const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'bookings.json');
process.env.ADMIN_PIN = 'test-pin';
const server = require('../server');
const { buildSlots, museumNow, addDays } = require('../slots');

let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => server.close());

const post = (body) => fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const date = addDays(museumNow().date, 1);
const visitor = (extra) => ({ name: 'Shivaji Rao', mobile: '9876543210', visitors: 5, date, slotId: '0945', agree: true, ...extra });

test('slots start at 0945 with 1-hour slots and 15-minute breaks', () => {
  const s = buildSlots();
  assert.deepStrictEqual(s.slice(0, 3).map((x) => `${x.start}-${x.end}`), ['0945-1045', '1100-1200', '1215-1315']);
  assert.strictEqual(s.at(-1).end, '1700');
});

test('bookings fill a slot up to 20 visitors and then block it', async () => {
  for (let i = 0; i < 4; i++) assert.strictEqual((await post(visitor())).status, 201);
  const over = await post(visitor({ visitors: 1 }));
  assert.strictEqual(over.status, 409);
  const { slots } = await (await fetch(`${base}/api/slots?date=${date}`)).json();
  assert.strictEqual(slots[0].status, 'full');
  assert.strictEqual(slots[1].remaining, 20);
});

test('a group larger than the remaining places is rejected', async () => {
  assert.strictEqual((await post(visitor({ slotId: '1100', visitors: 15 }))).status, 201);
  const res = await post(visitor({ slotId: '1100', visitors: 6 }));
  assert.strictEqual(res.status, 409);
  assert.match((await res.json()).error, /Only 5 place/);
});

test('fee is Rs 50 per person and booking is confirmed', async () => {
  const { booking } = await (await post(visitor({ slotId: '1215', visitors: 3 }))).json();
  assert.strictEqual(booking.amount, 150);
  assert.strictEqual(booking.status, 'confirmed');
  const found = await fetch(`${base}/api/bookings/${booking.id}?mobile=9876543210`);
  assert.strictEqual(found.status, 200);
  assert.strictEqual((await fetch(`${base}/api/bookings/${booking.id}?mobile=9000000000`)).status, 404);
});

test('invalid input is rejected with field errors', async () => {
  const res = await post({ name: '', mobile: '123', visitors: 0, date: '2000-01-01', slotId: '0800' });
  assert.strictEqual(res.status, 422);
  const { fields } = await res.json();
  assert.deepStrictEqual(Object.keys(fields).sort(), ['agree', 'date', 'mobile', 'name', 'slotId', 'visitors']);
});

test('staff can mark paid and cancelling frees places', async () => {
  const headers = { 'Content-Type': 'application/json', 'X-Admin-Pin': 'test-pin' };
  assert.strictEqual((await fetch(`${base}/api/admin/bookings?date=${date}`)).status, 401);
  const list = await (await fetch(`${base}/api/admin/bookings?date=${date}`, { headers })).json();
  const [first, second] = list.bookings.filter((b) => b.slotId === '0945');
  const patch = (id, status) => fetch(`${base}/api/admin/bookings/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ status }) });
  assert.strictEqual((await patch(first.id, 'paid')).status, 200);
  assert.strictEqual((await patch(second.id, 'cancelled')).status, 200);
  const { slots } = await (await fetch(`${base}/api/slots?date=${date}`)).json();
  assert.strictEqual(slots[0].remaining, 5);
});
