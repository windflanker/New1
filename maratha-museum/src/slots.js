import config from './config.js';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}`;

// Builds the day's slots: 0945-1045, 1100-1200, 1215-1315, ...
function buildSlots() {
  const slots = [];
  const close = toMinutes(config.closingTime);
  let start = toMinutes(config.openingTime);
  while (start + config.slotMinutes <= close) {
    const end = start + config.slotMinutes;
    slots.push({ id: toHHMM(start), start: toHHMM(start), end: toHHMM(end), startMinutes: start });
    start = end + config.breakMinutes;
  }
  return slots;
}

// Current date (YYYY-MM-DD) and minutes-since-midnight in the museum's time zone.
function museumNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns an error message if visitors cannot book this date, otherwise null.
function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return 'Please choose a valid date.';
  }
  const today = museumNow().date;
  if (date < today) return 'The selected date is in the past.';
  if (date > addDays(today, config.bookingWindowDays)) {
    return `Bookings open only ${config.bookingWindowDays} days in advance.`;
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (config.closedWeekdays.includes(weekday)) return 'The museum is closed on this day.';
  return null;
}

export { buildSlots, museumNow, addDays, validateDate };
