// Booking API. Uses only web-standard Request/Response, so the same code runs
// on Cloudflare Workers (src/worker.js) and in Node for local use (server.js).
import config from './config.js';
import { buildSlots, museumNow, addDays, validateDate } from './slots.js';

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 1e5) throw Object.assign(new Error('Request too large'), { status: 413 });
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function slotsFor(store, date) {
  const counts = await store.slotCounts(date);
  const now = museumNow();
  return buildSlots().map((s) => {
    const booked = counts.get(s.id) || 0;
    const remaining = Math.max(config.slotCapacity - booked, 0);
    const started = date === now.date && s.startMinutes <= now.minutes;
    return {
      id: s.id, start: s.start, end: s.end, booked, remaining,
      capacity: config.slotCapacity,
      status: started ? 'closed' : remaining === 0 ? 'full' : 'open',
    };
  });
}

function newBookingId() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `MM-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const publicView = (b) => ({
  id: b.id, name: b.name, date: b.date, slotId: b.slotId, slotLabel: b.slotLabel,
  visitors: b.visitors, amount: b.amount, status: b.status, createdAt: b.createdAt,
});

function validateBooking(body) {
  const errors = {};
  const name = String(body.name || '').trim();
  const mobile = String(body.mobile || '').replace(/[\s-]/g, '');
  const email = String(body.email || '').trim();
  const city = String(body.city || '').trim();
  const visitors = Number(body.visitors);
  const date = String(body.date || '');
  const slotId = String(body.slotId || '');

  if (name.length < 2 || name.length > 80) errors.name = 'Enter the full name (2–80 characters).';
  if (!/^(\+91)?[6-9]\d{9}$/.test(mobile)) errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (city.length > 60) errors.city = 'City name is too long.';
  if (!Number.isInteger(visitors) || visitors < 1 || visitors > config.maxGroupSize) {
    errors.visitors = `Number of visitors must be between 1 and ${config.maxGroupSize}.`;
  }
  const dateError = validateDate(date);
  if (dateError) errors.date = dateError;
  if (!buildSlots().some((s) => s.id === slotId)) errors.slotId = 'Please choose a time slot.';
  if (body.agree !== true) errors.agree = 'Please accept the visit terms.';

  return {
    errors,
    value: {
      name, mobile: mobile.slice(-10), email, city, visitors, date, slotId,
      assistance: Boolean(body.assistance), notes: String(body.notes || '').trim().slice(0, 300),
    },
  };
}

// Constant-time comparison so the PIN can't be guessed from response timing.
function pinMatches(given, expected) {
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function createBooking(store, body) {
  const { errors, value } = validateBooking(body);
  if (Object.keys(errors).length) return json(422, { error: 'Please correct the highlighted fields.', fields: errors });

  const slot = buildSlots().find((s) => s.id === value.slotId);
  const now = museumNow();
  if (value.date === now.date && slot.startMinutes <= now.minutes) {
    return json(409, { error: 'This slot has already started. Please pick a later slot.', fields: { slotId: 'Slot closed' } });
  }

  // reserve() adds the visitors to the slot only if it stays within capacity,
  // in one atomic step, so simultaneous bookings can never overfill a slot.
  if (!(await store.reserve(value.date, value.slotId, value.visitors, config.slotCapacity))) {
    const slots = await slotsFor(store, value.date);
    const remaining = slots.find((s) => s.id === value.slotId).remaining;
    const msg = remaining === 0
      ? 'Sorry, this slot is full. Please choose another slot.'
      : `Only ${remaining} place(s) left in this slot. Reduce the group size or choose another slot.`;
    return json(409, { error: msg, fields: { slotId: msg }, slots });
  }

  const booking = {
    id: '', ...value,
    slotLabel: `${slot.start}h – ${slot.end}h`,
    amount: value.visitors * config.feePerPerson,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  try {
    // insertBooking returns false if the random ID is already taken; try a new one.
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      booking.id = newBookingId();
      saved = await store.insertBooking(booking);
    }
    if (!saved) throw new Error('Could not allocate a booking ID');
  } catch (err) {
    await store.release(value.date, value.slotId, value.visitors);
    throw err;
  }
  return json(201, { booking: publicView(booking) });
}

const TRANSITIONS = { confirmed: ['paid', 'cancelled'], paid: ['confirmed'], cancelled: ['confirmed'] };

async function changeStatus(store, id, status) {
  const b = await store.findBooking(id);
  if (!b) return json(404, { error: 'Booking not found.' });
  if (!TRANSITIONS[b.status]?.includes(status)) return json(400, { error: `Cannot change a ${b.status} booking to ${status}.` });

  const at = new Date().toISOString();
  const conflict = () => json(409, { error: 'This booking was just changed by someone else. Refresh and try again.' });

  if (status === 'cancelled') {
    if (!(await store.updateStatus(id, b.status, status, at))) return conflict();
    await store.release(b.date, b.slotId, b.visitors);
  } else if (b.status === 'cancelled') {
    if (!(await store.reserve(b.date, b.slotId, b.visitors, config.slotCapacity))) {
      return json(409, { error: 'Not enough places left in the slot to restore this booking.' });
    }
    if (!(await store.updateStatus(id, b.status, status, at))) {
      await store.release(b.date, b.slotId, b.visitors);
      return conflict();
    }
  } else if (!(await store.updateStatus(id, b.status, status, at))) {
    return conflict();
  }
  return json(200, { booking: { ...b, status, updatedAt: at } });
}

export async function handleApi(request, { store, adminPin }) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  const method = request.method;

  try {
    if (method === 'GET' && pathname === '/api/config') {
      const today = museumNow().date;
      return json(200, {
        ...config, today, lastBookableDate: addDays(today, config.bookingWindowDays),
        slots: buildSlots().map(({ id, start, end }) => ({ id, start, end })),
      });
    }

    if (method === 'GET' && pathname === '/api/slots') {
      const date = searchParams.get('date') || '';
      const error = validateDate(date);
      if (error) return json(400, { error });
      return json(200, { date, slots: await slotsFor(store, date) });
    }

    if (method === 'POST' && pathname === '/api/bookings') {
      return await createBooking(store, await readJson(request));
    }

    // Visitor lookup: needs both booking ID and the mobile number used to book.
    let match = pathname.match(/^\/api\/bookings\/([A-Z0-9-]+)$/i);
    if (method === 'GET' && match) {
      const mobile = (searchParams.get('mobile') || '').replace(/\D/g, '').slice(-10);
      const b = await store.findBooking(match[1].toUpperCase());
      return b && b.mobile === mobile
        ? json(200, { booking: publicView(b) })
        : json(404, { error: 'No booking found for that ID and mobile number.' });
    }

    // ----- counter staff -----
    if (pathname.startsWith('/api/admin/')) {
      if (!pinMatches(request.headers.get('x-admin-pin') || '', adminPin)) return json(401, { error: 'Incorrect staff PIN.' });

      if (method === 'GET' && pathname === '/api/admin/bookings') {
        const date = searchParams.get('date') || museumNow().date;
        const [slots, bookings] = await Promise.all([slotsFor(store, date), store.listByDate(date)]);
        bookings.sort((a, b) => a.slotId.localeCompare(b.slotId) || a.createdAt.localeCompare(b.createdAt));
        return json(200, { date, slots, bookings });
      }

      match = pathname.match(/^\/api\/admin\/bookings\/([A-Z0-9-]+)$/i);
      if (method === 'PATCH' && match) {
        const { status } = await readJson(request);
        return await changeStatus(store, match[1].toUpperCase(), status);
      }
    }

    return json(404, { error: 'Not found' });
  } catch (err) {
    if (err.status) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
