// Museum booking rules. Change these values to adjust the schedule.
export default {
  openingTime: '09:45',     // first slot starts here
  closingTime: '17:30',     // no slot may end after this
  slotMinutes: 60,          // each visiting slot lasts one hour
  breakMinutes: 15,         // gap between two slots
  slotCapacity: 20,         // max visitors in one slot
  feePerPerson: 50,         // Rs, paid at the counter
  maxGroupSize: 20,         // max visitors in one booking
  bookingWindowDays: 30,    // how far ahead visitors can book
  closedWeekdays: [],       // e.g. [1] to close on Mondays (0 = Sunday)
  timeZone: 'Asia/Kolkata',
};
