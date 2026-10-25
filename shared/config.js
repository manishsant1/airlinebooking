// The app's vocabulary and business rules, in one place. Used by both the browser and the server.
export const LABELS = {
  appName: 'SkyBook',
  appEmoji: '✈️',
  resource: 'Flight',
  resources: 'Flights',
  booking: 'Booking',
  bookings: 'Bookings',
};

export const CURRENCY = 'USD';
export const TAX_RATE = 0.12;               // taxes and airport fees, as a share of the fare
export const MAX_ADVANCE_DAYS = 180;        // how far ahead a flight may be booked
export const BOOKING_CLOSE_HOURS = 2;       // no new bookings this close to departure
export const CANCEL_CUTOFF_HOURS = 24;      // customers can't cancel closer to departure than this
export const MAX_PASSENGERS = 9;            // per booking
export const MAX_ACTIVE_BOOKINGS_PER_USER = 10; // accounts are free, so this limits seat hoarding, not abuse
