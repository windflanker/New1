import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import { handleApi } from '../src/api.js';
import { buildSlots, museumNow, addDays } from '../src/slots.js';
import { MemoryStore } from '../src/stores/memory.js';
import { MongoStore } from '../src/stores/mongo.js';

const PIN = 'test-pin';
const date = addDays(museumNow().date, 1);
const visitor = (extra) => ({ name: 'Shivaji Rao', mobile: '9876543210', visitors: 5, date, slotId: '0945', agree: true, ...extra });

test('slots start at 0945 with 1-hour slots and 15-minute breaks', () => {
  const s = buildSlots();
  assert.deepStrictEqual(s.slice(0, 3).map((x) => `${x.start}-${x.end}`), ['0945-1045', '1100-1200', '1215-1315']);
  assert.strictEqual(s.at(-1).end, '1700');
});

// The same behaviour is checked against every store. MongoDB runs only when
// TEST_MONGODB_URI points at a test server, e.g. `docker run -p 27017:27017 mongo:7`
// then TEST_MONGODB_URI=mongodb://localhost:27017 npm test
const stores = [['memory store', async () => ({ store: new MemoryStore() })]];
if (process.env.TEST_MONGODB_URI) {
  stores.push(['MongoDB store', async () => {
    const dbName = `mm_test_${Date.now()}`;
    const store = MongoStore.connect(process.env.TEST_MONGODB_URI, dbName);
    return { store, cleanup: async () => { await store.client.db(dbName).dropDatabase(); await store.close(); } };
  }]);
}

for (const [label, make] of stores) {
  describe(label, () => {
    let store;
    let cleanup;
    before(async () => ({ store, cleanup } = await make()));
    after(async () => cleanup?.());

    const call = async (method, path, body, headers = {}) => {
      const res = await handleApi(new Request(`http://x${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body),
      }), { store, adminPin: PIN });
      return { status: res.status, data: await res.json() };
    };
    const book = (extra) => call('POST', '/api/bookings', visitor(extra));
    const admin = { 'X-Admin-Pin': PIN };

    test('bookings fill a slot up to 20 visitors and then block it', async () => {
      for (let i = 0; i < 4; i++) assert.strictEqual((await book()).status, 201);
      assert.strictEqual((await book({ visitors: 1 })).status, 409);
      const { data } = await call('GET', `/api/slots?date=${date}`);
      assert.strictEqual(data.slots[0].status, 'full');
      assert.strictEqual(data.slots[1].remaining, 20);
    });

    test('a group larger than the remaining places is rejected', async () => {
      assert.strictEqual((await book({ slotId: '1100', visitors: 15 })).status, 201);
      const res = await book({ slotId: '1100', visitors: 6 });
      assert.strictEqual(res.status, 409);
      assert.match(res.data.error, /Only 5 place/);
    });

    test('simultaneous bookings never overfill a slot', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => book({ slotId: '1600', visitors: 3 })));
      assert.strictEqual(results.filter((r) => r.status === 201).length, 6);
      const { data } = await call('GET', `/api/slots?date=${date}`);
      assert.strictEqual(data.slots.find((s) => s.id === '1600').booked, 18);
    });

    test('fee is Rs 50 per person and booking can be looked up', async () => {
      const { data: { booking } } = await book({ slotId: '1215', visitors: 3 });
      assert.strictEqual(booking.amount, 150);
      assert.strictEqual(booking.status, 'confirmed');
      assert.strictEqual((await call('GET', `/api/bookings/${booking.id}?mobile=9876543210`)).status, 200);
      assert.strictEqual((await call('GET', `/api/bookings/${booking.id}?mobile=9000000000`)).status, 404);
    });

    test('invalid input is rejected with field errors', async () => {
      const res = await call('POST', '/api/bookings', { name: '', mobile: '123', visitors: 0, date: '2000-01-01', slotId: '0800' });
      assert.strictEqual(res.status, 422);
      assert.deepStrictEqual(Object.keys(res.data.fields).sort(), ['agree', 'date', 'mobile', 'name', 'slotId', 'visitors']);
    });

    test('staff can mark paid, cancel to free places, and restore', async () => {
      assert.strictEqual((await call('GET', `/api/admin/bookings?date=${date}`)).status, 401);
      const { data } = await call('GET', `/api/admin/bookings?date=${date}`, undefined, admin);
      const [first, second] = data.bookings.filter((b) => b.slotId === '0945');
      const patch = (id, status) => call('PATCH', `/api/admin/bookings/${id}`, { status }, admin);
      assert.strictEqual((await patch(first.id, 'paid')).status, 200);
      assert.strictEqual((await patch(second.id, 'cancelled')).status, 200);
      assert.strictEqual((await patch(second.id, 'cancelled')).status, 400);
      let slots = (await call('GET', `/api/slots?date=${date}`)).data.slots;
      assert.strictEqual(slots[0].remaining, 5);
      assert.strictEqual((await patch(second.id, 'confirmed')).status, 200);
      slots = (await call('GET', `/api/slots?date=${date}`)).data.slots;
      assert.strictEqual(slots[0].remaining, 0);
    });
  });
}
