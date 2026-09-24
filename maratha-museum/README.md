# Maratha Museum – Visitor Booking Portal

Visitors book a time slot online and pay **₹50 per person at the counter**.
Counter staff see each day's bookings, mark them paid on arrival, or cancel them.

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
closed weekdays are set in [`config.js`](config.js); the slot list is recalculated from it.

## How the slot check works

- While picking a time, the form fetches live availability for the chosen date and shows
  places left in each slot. Slots that are full, have already started, or don't have room
  for the whole group are greyed out.
- The server checks capacity again right before saving, so two people booking at the same
  moment cannot push a slot past 20. If it no longer fits, the visitor is told how many places
  are left and the slot list refreshes.
- Cancelled bookings release their places.

## Run it

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
cd maratha-museum
ADMIN_PIN=choose-a-pin npm start
```

- Visitor booking form: http://localhost:3000/
- Counter desk: http://localhost:3000/admin (enter the staff PIN; default `maratha123` if `ADMIN_PIN` is not set — change it)

Environment variables: `PORT` (default 3000), `ADMIN_PIN`, `DATA_FILE` (default `data/bookings.json`).

## Tests

```bash
npm test
```

## Files

- `server.js` – HTTP server and JSON API
- `slots.js` / `config.js` – slot schedule and booking rules
- `public/index.html`, `public/app.js` – visitor booking form and confirmation pass
- `public/admin.html`, `public/admin.js` – counter desk
- `data/bookings.json` – bookings (created automatically, not committed)
