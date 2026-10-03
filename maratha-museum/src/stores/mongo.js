// MongoDB store (MongoDB Atlas in production).
//
// Collections:
//   bookings     – one document per booking, _id = booking ID (e.g. "MM-04FF65")
//   slot_counts  – one document per date+slot, _id = "2026-10-04|0945", { date, slotId, booked }
//
// The slot counter is what enforces the 20-visitor limit: reserve() increments it
// only when the result stays within capacity, as a single atomic database update.
import { MongoClient } from 'mongodb';

const DUPLICATE_KEY = 11000;
const counterId = (date, slotId) => `${date}|${slotId}`;
const fromDoc = ({ _id, ...rest }) => ({ id: _id, ...rest });

export class MongoStore {
  constructor(client, dbName) {
    this.client = client;
    const db = client.db(dbName);
    this.bookings = db.collection('bookings');
    this.counts = db.collection('slot_counts');
  }

  // Cloudflare Workers can't share a connection between requests, so the worker
  // opens one per request (pool size 1) and closes it after responding.
  static connect(uri, dbName = 'maratha_museum') {
    const client = new MongoClient(uri, {
      maxPoolSize: 1,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      maxIdleTimeMS: 10000,
    });
    return new MongoStore(client, dbName);
  }

  close() {
    return this.client.close();
  }

  async slotCounts(date) {
    const docs = await this.counts.find({ date }).toArray();
    return new Map(docs.map((d) => [d.slotId, d.booked]));
  }

  async reserve(date, slotId, visitors, capacity) {
    const filter = { _id: counterId(date, slotId), booked: { $lte: capacity - visitors } };
    const update = { $inc: { booked: visitors } };
    try {
      // Matches only if there is room; creates the counter on a slot's first booking.
      await this.counts.updateOne(filter, { ...update, $setOnInsert: { date, slotId } }, { upsert: true });
      return true;
    } catch (err) {
      if (err.code !== DUPLICATE_KEY) throw err;
      // The counter already exists: either it has no room (the upsert then tried to
      // create a second one), or another booking created it at the same moment.
      // Retry as a plain conditional update to tell the two apart.
      const res = await this.counts.updateOne(filter, update);
      return res.matchedCount === 1;
    }
  }

  async release(date, slotId, visitors) {
    await this.counts.updateOne({ _id: counterId(date, slotId) }, { $inc: { booked: -visitors } });
  }

  async insertBooking({ id, ...rest }) {
    try {
      await this.bookings.insertOne({ _id: id, ...rest });
      return true;
    } catch (err) {
      if (err.code === DUPLICATE_KEY) return false;
      throw err;
    }
  }

  async findBooking(id) {
    const doc = await this.bookings.findOne({ _id: id });
    return doc && fromDoc(doc);
  }

  async listByDate(date) {
    return (await this.bookings.find({ date }).toArray()).map(fromDoc);
  }

  async updateStatus(id, from, to, at) {
    const res = await this.bookings.updateOne({ _id: id, status: from }, { $set: { status: to, updatedAt: at } });
    return res.modifiedCount === 1;
  }
}
