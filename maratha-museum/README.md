# Maratha Museum – Visitor Booking Portal

Visitors book a time slot online and pay **₹50 per person at the counter**.
Counter staff see each day's bookings, mark them paid on arrival, or cancel them.

Live hosting: **Cloudflare Workers** (website + API) with **MongoDB Atlas** (database).

## Booking rules

| Rule | Value |
|---|---|
| Museum opens | 0945h |
| Slot length | 1 hour |
| Break between slots | 15 minutes |
| Visitors per slot | 20 (a slot shows **Full** once 20 are booked) |
| Fee | ₹50 per person, paid at the counter |

Slots for the day: 0945–1045, 1100–1200, 1215–1315, 1330–1430, 1445–1545, 1600–1700.

The closing time (assumed 1730h), booking window (30 days), maximum group size and
closed weekdays are set in [`src/config.js`](src/config.js); the slot list is recalculated from it.

## How the slot limit is enforced

- The form shows live places left in each slot. Slots that are full, have already started,
  or don't have room for the whole group are greyed out.
- MongoDB keeps a counter per date and slot (`slot_counts` collection). A booking adds its
  visitors to the counter only if the total stays at or below 20, in one atomic database
  update, so simultaneous bookings can never overfill a slot.
- Cancelling a booking at the counter gives its places back.

## Publish on Cloudflare

You need a free MongoDB Atlas account and a free Cloudflare account. No coding is needed.

### 1. Create the database (MongoDB Atlas)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Create a cluster** → choose **M0 (Free)** → provider **AWS**, region **Mumbai (ap-south-1)** → **Create Deployment**.
3. In the pop-up, create a **database user**. Note the username and password (use letters and
   numbers only, so it needs no escaping in the connection string).
4. Left menu → **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm.
   Cloudflare Workers do not have fixed IP addresses, so this is required. The database user's password protects the data.
5. Left menu → **Clusters** → **Connect** → **Drivers**. Copy the connection string. It looks like
   `mongodb+srv://USER:<db_password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`.
   Replace `<db_password>` with the password from step 3. This full string is your **MONGODB_URI**.

The app creates its collections (`bookings`, `slot_counts`) in the `maratha_museum` database by itself on the first booking.

### 2. Deploy the site (Cloudflare Workers)

1. Sign up at <https://dash.cloudflare.com/sign-up>.
2. **Workers & Pages** → **Create** → **Import a repository** → connect GitHub and pick this repository.
3. On the set-up screen:
   - **Project name:** `maratha-museum-booking` (must match `name` in `wrangler.jsonc`)
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
   - **Advanced settings → Path / Root directory:** `maratha-museum`
4. **Create and deploy.** When it finishes, open the Worker → **Settings** → **Variables and Secrets** → **Add**:
   - `MONGODB_URI` (type **Secret**): the connection string from step 1.5
   - `ADMIN_PIN` (type **Secret**): the PIN counter staff will type on the counter desk
   Then **Deploy**.
5. Open `https://maratha-museum-booking.<your-subdomain>.workers.dev`. The counter desk is at `/admin`.

Cloudflare redeploys automatically whenever the production branch on GitHub changes.

**Own domain (optional):** Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**
(e.g. `book.marathamuseum.in`; the domain must be on your Cloudflare account).

### Deploy from a computer instead (optional)

```bash
cd maratha-museum
npm install
npx wrangler login
npx wrangler secret put MONGODB_URI
npx wrangler secret put ADMIN_PIN
npm run deploy
```

## Run on your own computer

Requires Node.js 20 or newer.

```bash
cd maratha-museum
npm install
npm start          # http://localhost:3000, bookings saved in data/bookings.json
```

Set `MONGODB_URI` to use MongoDB instead of the local file. `ADMIN_PIN` sets the counter-desk PIN
(default `maratha123`, local only. On Cloudflare, bookings stay switched off until both `MONGODB_URI` and `ADMIN_PIN` are set).

To run inside Cloudflare's own runtime locally, put `MONGODB_URI=…` and `ADMIN_PIN=…` in a
`.dev.vars` file (not committed) and run `npm run dev`.

## Tests

```bash
npm test
# also test against a real MongoDB, e.g. one started with: docker run -p 27017:27017 mongo:7
TEST_MONGODB_URI=mongodb://localhost:27017 npm test
```

## Files

- `src/worker.js` – Cloudflare Workers entry point
- `src/api.js` – booking API (shared by Cloudflare and the local server)
- `src/stores/mongo.js` – MongoDB storage; `src/stores/memory.js` – local/test storage
- `src/config.js`, `src/slots.js` – booking rules and slot schedule
- `server.js` – local Node server
- `public/` – visitor booking form (`index.html`), counter desk (`admin.html`), styles
- `wrangler.jsonc` – Cloudflare configuration
