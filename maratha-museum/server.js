// Maratha Museum visitor booking portal.
// Plain Node.js (no dependencies): serves the pages in ./public and a small JSON API.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { buildSlots, museumNow, addDays, validateDate } = require('./slots');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || 'maratha123';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'bookings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- storage ----------
function loadBookings() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
let bookings = loadBookings();

function saveBookings() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bookings, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Cancelled bookings free their places; every other status holds them.
function bookedCount(date, slotId) {
  return bookings
    .filter((b) => b.date === date && b.slotId === slotId && b.status !== 'cancelled')
    .reduce((sum, b) => sum + b.visitors, 0);
}

function slotsFor(date) {
  const now = museumNow();
  return buildSlots().map((s) => {
    const booked = bookedCount(date, s.id);
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
  let id;
  do {
    id = `MM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  } while (bookings.some((b) => b.id === id));
  return id;
}

const publicView = (b) => ({
  id: b.id, name: b.name, date: b.date, slotId: b.slotId, slotLabel: b.slotLabel,
  visitors: b.visitors, amount: b.amount, status: b.status, createdAt: b.createdAt,
});

// ---------- validation ----------
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

// ---------- http helpers ----------
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e5) reject(Object.assign(new Error('Request too large'), { status: 413 }));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, content) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
}

const isAdmin = (req) => {
  const pin = String(req.headers['x-admin-pin'] || '');
  return pin.length === ADMIN_PIN.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(ADMIN_PIN));
};

// ---------- routes ----------
async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/api/config') {
    const today = museumNow().date;
    return sendJson(res, 200, {
      ...config, today, lastBookableDate: addDays(today, config.bookingWindowDays),
      slots: buildSlots().map(({ id, start, end }) => ({ id, start, end })),
    });
  }

  if (req.method === 'GET' && pathname === '/api/slots') {
    const date = searchParams.get('date') || '';
    const error = validateDate(date);
    if (error) return sendJson(res, 400, { error });
    return sendJson(res, 200, { date, slots: slotsFor(date) });
  }

  if (req.method === 'POST' && pathname === '/api/bookings') {
    const { errors, value } = validateBooking(await readJson(req));
    if (Object.keys(errors).length) return sendJson(res, 422, { error: 'Please correct the highlighted fields.', fields: errors });

    // Capacity check happens here, right before saving, so two visitors can
    // never overfill a slot (Node handles one request at a time in this block).
    const slot = slotsFor(value.date).find((s) => s.id === value.slotId);
    if (slot.status === 'closed') {
      return sendJson(res, 409, { error: 'This slot has already started. Please pick a later slot.', fields: { slotId: 'Slot closed' } });
    }
    if (value.visitors > slot.remaining) {
      const msg = slot.remaining === 0
        ? 'Sorry, this slot is full. Please choose another slot.'
        : `Only ${slot.remaining} place(s) left in this slot. Reduce the group size or choose another slot.`;
      return sendJson(res, 409, { error: msg, fields: { slotId: msg }, slots: slotsFor(value.date) });
    }

    const booking = {
      id: newBookingId(), ...value,
      slotLabel: `${slot.start}h – ${slot.end}h`,
      amount: value.visitors * config.feePerPerson,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    saveBookings();
    return sendJson(res, 201, { booking: publicView(booking) });
  }

  // Visitor lookup: needs both booking ID and the mobile number used to book.
  let match = pathname.match(/^\/api\/bookings\/([A-Z0-9-]+)$/i);
  if (req.method === 'GET' && match) {
    const mobile = (searchParams.get('mobile') || '').replace(/\D/g, '').slice(-10);
    const b = bookings.find((x) => x.id === match[1].toUpperCase() && x.mobile === mobile);
    return b ? sendJson(res, 200, { booking: publicView(b) }) : sendJson(res, 404, { error: 'No booking found for that ID and mobile number.' });
  }

  // ----- counter staff -----
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'Incorrect staff PIN.' });

    if (req.method === 'GET' && pathname === '/api/admin/bookings') {
      const date = searchParams.get('date') || museumNow().date;
      const list = bookings.filter((b) => b.date === date).sort((a, b) => a.slotId.localeCompare(b.slotId) || a.createdAt.localeCompare(b.createdAt));
      return sendJson(res, 200, { date, slots: slotsFor(date), bookings: list });
    }

    match = pathname.match(/^\/api\/admin\/bookings\/([A-Z0-9-]+)$/i);
    if (req.method === 'PATCH' && match) {
      const b = bookings.find((x) => x.id === match[1].toUpperCase());
      if (!b) return sendJson(res, 404, { error: 'Booking not found.' });
      const { status } = await readJson(req);
      const allowed = { confirmed: ['paid', 'cancelled'], paid: ['confirmed'], cancelled: ['confirmed'] };
      if (!allowed[b.status].includes(status)) return sendJson(res, 400, { error: `Cannot change a ${b.status} booking to ${status}.` });
      if (b.status === 'cancelled' && b.visitors > slotsFor(b.date).find((s) => s.id === b.slotId).remaining) {
        return sendJson(res, 409, { error: 'Not enough places left in the slot to restore this booking.' });
      }
      b.status = status;
      b.updatedAt = new Date().toISOString();
      saveBookings();
      return sendJson(res, 200, { booking: b });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, url.pathname === '/admin' ? '/admin.html' : url.pathname);
  } catch (err) {
    if (!err.status) console.error(err);
    return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong. Please try again.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Maratha Museum booking portal: http://localhost:${PORT}`);
    console.log(`Counter staff page:           http://localhost:${PORT}/admin`);
  });
}

module.exports = server;
