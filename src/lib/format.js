import { CURRENCY } from '../../shared/config';

export const formatPrice = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY }).format(n);

// Shows an instant in a given airport's timezone, e.g. "Sat, Oct 24, 9:00 AM EDT".
export function formatWhen(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(new Date(iso));
}

// Just the clock time, e.g. "9:00 AM".
export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

// "YYYY-MM-DD" -> "Saturday, October 24". Parsed as UTC and formatted as UTC so the viewer's
// own timezone can never shift the day.
export function formatDay(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(date + 'T00:00:00Z'));
}

// Whole days between the departure date at the origin and the arrival date at the destination.
export function arrivalDayOffset(flight) {
  const day = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  const a = new Date(day(flight.arrivesAt, flight.destTz) + 'T00:00:00Z');
  const d = new Date(day(flight.departsAt, flight.originTz) + 'T00:00:00Z');
  return Math.round((a - d) / 86400000);
}
