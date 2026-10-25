import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import * as db from './db.js';
import { HttpError } from './errors.js';
import { CONTACT_FIELDS, validateBooking } from '../shared/validation.js';
import { addDays, isValidDate, todayIn } from '../shared/booking.js';
import { MAX_ADVANCE_DAYS } from '../shared/config.js';

const router = express.Router();

// The signed-in user's id, from the Better Auth session cookie. Browsing is public; everything
// that touches a person's bookings goes through here. Records are always scoped by this id.
async function requireUser(req) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, 'Please sign in to continue');
  return session.user.id;
}

// A search date is local to the origin airport, which can be a day ahead of or behind UTC, so
// this only rejects nonsense. createBooking enforces the exact window in the origin's timezone.
function requireSearchDate(value) {
  const date = String(value ?? '');
  if (!isValidDate(date)) throw new HttpError(400, 'Choose a valid date');
  const today = todayIn('UTC');
  if (date < addDays(today, -1) || date > addDays(today, MAX_ADVANCE_DAYS + 1)) {
    throw new HttpError(400, `Choose a date within the next ${MAX_ADVANCE_DAYS} days`);
  }
  return date;
}

function optionalAirport(value) {
  if (value === undefined || value === '') return undefined;
  const code = String(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new HttpError(400, 'Invalid airport code');
  return code;
}

router.get('/health', async (req, res) => {
  await db.ping();
  res.json({ ok: true });
});

router.get('/airports', async (req, res) => res.json(await db.getAirports()));

router.get('/flights', async (req, res) => {
  res.json(await db.searchFlights({
    date: requireSearchDate(req.query.date),
    from: optionalAirport(req.query.from),
    to: optionalAirport(req.query.to),
  }));
});

router.get('/flights/:id', async (req, res) => {
  const flight = await db.getFlight(req.params.id, requireSearchDate(req.query.date));
  if (!flight) throw new HttpError(404, 'Not found');
  res.json(flight);
});

router.get('/bookings', async (req, res) => {
  res.json(await db.getBookingsForUser(await requireUser(req)));
});

router.post('/bookings', async (req, res) => {
  const userId = await requireUser(req);
  const { flightId, date, passengers, contact } = req.body ?? {};

  if (typeof flightId !== 'string' || typeof date !== 'string') throw new HttpError(400, 'Invalid request');
  const errors = validateBooking({ passengers, contact });
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields', errors);

  // Fare, schedule and seats are decided by the database, never by the request.
  const booking = await db.createBooking({
    userId,
    flightId,
    date,
    // Keep only the known fields, trimmed.
    passengerNames: passengers.map((p) => ({ fullName: p.fullName.trim() })),
    contact: Object.fromEntries(CONTACT_FIELDS.map((f) => [f.name, contact[f.name].trim()])),
  });
  res.status(201).json(booking);
});

router.post('/bookings/:id/cancel', async (req, res) => {
  res.json(await db.cancelBooking(await requireUser(req), req.params.id));
});

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Express 5 forwards errors thrown in handlers (sync or async) to this handler.
router.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

export default router;
