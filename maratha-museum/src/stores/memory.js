// In-memory store, optionally saved to a JSON file. Used for local runs without
// MongoDB and for tests. It keeps a per-slot counter exactly like the MongoDB
// store, and each method checks and updates without yielding, so it is atomic
// within one process.
import fs from 'node:fs';
import path from 'node:path';

const key = (date, slotId) => `${date}|${slotId}`;

export class MemoryStore {
  constructor(file = null) {
    this.file = file;
    this.bookings = [];
    if (file) {
      try {
        this.bookings = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    this.counts = new Map();
    for (const b of this.bookings) {
      if (b.status !== 'cancelled') this.counts.set(key(b.date, b.slotId), (this.counts.get(key(b.date, b.slotId)) || 0) + b.visitors);
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.bookings, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }

  async slotCounts(date) {
    const counts = new Map();
    for (const [k, n] of this.counts) {
      const [d, slotId] = k.split('|');
      if (d === date) counts.set(slotId, n);
    }
    return counts;
  }

  async reserve(date, slotId, visitors, capacity) {
    const k = key(date, slotId);
    const booked = this.counts.get(k) || 0;
    if (booked + visitors > capacity) return false;
    this.counts.set(k, booked + visitors);
    return true;
  }

  async release(date, slotId, visitors) {
    const k = key(date, slotId);
    this.counts.set(k, Math.max((this.counts.get(k) || 0) - visitors, 0));
  }

  async insertBooking(booking) {
    if (this.bookings.some((b) => b.id === booking.id)) return false;
    this.bookings.push({ ...booking });
    this.save();
    return true;
  }

  async findBooking(id) {
    const b = this.bookings.find((x) => x.id === id);
    return b ? { ...b } : null;
  }

  async listByDate(date) {
    return this.bookings.filter((b) => b.date === date).map((b) => ({ ...b }));
  }

  async updateStatus(id, from, to, at) {
    const b = this.bookings.find((x) => x.id === id);
    if (!b || b.status !== from) return false;
    b.status = to;
    b.updatedAt = at;
    this.save();
    return true;
  }
}
