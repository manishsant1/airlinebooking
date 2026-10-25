// Postgres data access, using Neon's serverless driver. This is the only file with SQL.
// The Pool talks to Neon over WebSockets, which supports full transactions (needed for bookings).
import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import {
  BOOKING_CLOSE_HOURS, CANCEL_CUTOFF_HOURS, MAX_ACTIVE_BOOKINGS_PER_USER,
} from '../shared/config.js';
import { bookingTotals, checkBookingDate } from '../shared/booking.js';
import { HttpError } from './errors.js';
import { FLIGHTS } from './seed.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Add your Neon connection string to .env (see .env.example).');
  process.exit(1);
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('Database connection error:', err.message));

// Idempotent, so it is safe to run on every start. There is no migration tool: a change to an
// existing table needs a manual ALTER (add it here too so fresh databases match).
//
// A flight is a daily schedule entry: it departs at depart_min (minutes since midnight in the
// origin's timezone) every day and has `seats` seats. A booking claims seats on one date.
// Seats cannot be a plain uniqueness constraint (many bookings share a flight and date), so
// createBooking locks the flight row, counts the confirmed passengers and refuses when full.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS flights (
    id            text PRIMARY KEY,
    flight_number text NOT NULL,
    origin_code   text NOT NULL,
    origin_city   text NOT NULL,
    origin_tz     text NOT NULL,
    dest_code     text NOT NULL,
    dest_city     text NOT NULL,
    dest_tz       text NOT NULL,
    depart_min    integer NOT NULL CHECK (depart_min >= 0 AND depart_min < 1440),
    duration_min  integer NOT NULL CHECK (duration_min > 0),
    fare          numeric(10, 2) NOT NULL CHECK (fare >= 0),
    seats         integer NOT NULL CHECK (seats > 0),
    aircraft      text NOT NULL DEFAULT '',
    active        boolean NOT NULL DEFAULT true
  );

  -- Flight details and prices are copied at booking time so past bookings don't change when
  -- the schedule does.
  CREATE TABLE IF NOT EXISTS bookings (
    id            text PRIMARY KEY,
    user_id       text NOT NULL,
    flight_id     text NOT NULL REFERENCES flights(id),
    flight_number text NOT NULL,
    origin_code   text NOT NULL,
    origin_city   text NOT NULL,
    origin_tz     text NOT NULL,
    dest_code     text NOT NULL,
    dest_city     text NOT NULL,
    dest_tz       text NOT NULL,
    flight_date   date NOT NULL,
    departs_at    timestamptz NOT NULL,
    arrives_at    timestamptz NOT NULL,
    passengers    integer NOT NULL CHECK (passengers > 0),
    passenger_names jsonb NOT NULL,
    status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    contact       jsonb NOT NULL,
    subtotal      numeric(10, 2) NOT NULL,
    tax           numeric(10, 2) NOT NULL,
    total         numeric(10, 2) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  -- Bookings used to be keyed by an anonymous browser id (client_id). Rename in place; those old
  -- rows belong to no account, so they simply stop showing up for anyone.
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'bookings' AND column_name = 'client_id') THEN
      ALTER TABLE bookings RENAME COLUMN client_id TO user_id;
    END IF;
  END $$;
  DROP INDEX IF EXISTS bookings_client_idx;
  CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id, departs_at DESC);
  CREATE INDEX IF NOT EXISTS bookings_flight_idx ON bookings (flight_id, flight_date) WHERE status = 'confirmed';
`;

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Creates the tables and, on an empty database, loads the starter data.
export async function init() {
  await pool.query(SCHEMA);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM flights');
    if (rows[0].n > 0) return;
    for (const f of FLIGHTS) {
      await client.query(
        `INSERT INTO flights (id, flight_number, origin_code, origin_city, origin_tz,
                              dest_code, dest_city, dest_tz, depart_min, duration_min,
                              fare, seats, aircraft)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING`,
        [f.id, f.flightNumber, f.originCode, f.originCity, f.originTz, f.destCode, f.destCity,
          f.destTz, f.departMin, f.durationMin, f.fare, f.seats, f.aircraft],
      );
    }
    console.log(`Seeded ${FLIGHTS.length} flights`);
  });
}

export async function ping() {
  await pool.query('SELECT 1');
}

// Postgres returns numeric columns as strings to avoid precision loss; fares fit in a JS number.
// departs_at / arrives_at / seats_left only exist on rows from FLIGHTS_ON_DATE.
const toFlight = (r) => ({
  id: r.id,
  flightNumber: r.flight_number,
  originCode: r.origin_code,
  originCity: r.origin_city,
  originTz: r.origin_tz,
  destCode: r.dest_code,
  destCity: r.dest_city,
  destTz: r.dest_tz,
  durationMin: r.duration_min,
  fare: Number(r.fare),
  seats: r.seats,
  aircraft: r.aircraft,
  date: r.date,
  departsAt: r.departs_at,
  arrivesAt: r.arrives_at,
  seatsLeft: r.seats_left,
  // Booking closes shortly before departure.
  bookable: r.departs_at.getTime() - Date.now() >= BOOKING_CLOSE_HOURS * 3600 * 1000,
});

const toBooking = (r) => ({
  id: r.id,
  status: r.status,
  flightId: r.flight_id,
  flightNumber: r.flight_number,
  originCode: r.origin_code,
  originCity: r.origin_city,
  originTz: r.origin_tz,
  destCode: r.dest_code,
  destCity: r.dest_city,
  destTz: r.dest_tz,
  date: r.flight_day,
  departsAt: r.departs_at,
  arrivesAt: r.arrives_at,
  passengers: r.passengers,
  passengerNames: r.passenger_names,
  contact: r.contact,
  subtotal: Number(r.subtotal),
  tax: Number(r.tax),
  total: Number(r.total),
  createdAt: r.created_at,
});

// Every flight with its concrete departure/arrival on $1 (a "YYYY-MM-DD" date at the origin) and
// the seats still free. Postgres does the timezone conversion, so daylight-saving changes are
// handled correctly. Append a WHERE clause; the date is always parameter $1.
const FLIGHTS_ON_DATE = `
  SELECT f.*, $1::date::text AS date, dep.at AS departs_at,
         dep.at + make_interval(mins => f.duration_min) AS arrives_at,
         f.seats - COALESCE((
           SELECT sum(b.passengers)::int FROM bookings b
            WHERE b.flight_id = f.id AND b.flight_date = $1::date AND b.status = 'confirmed'
         ), 0) AS seats_left
    FROM flights f
   CROSS JOIN LATERAL (SELECT ($1::date + make_interval(mins => f.depart_min)) AT TIME ZONE f.origin_tz AS at) dep`;

export async function getAirports() {
  const { rows } = await pool.query(
    `SELECT code, city FROM (
       SELECT origin_code AS code, origin_city AS city FROM flights WHERE active
       UNION
       SELECT dest_code, dest_city FROM flights WHERE active
     ) a ORDER BY city`,
  );
  return rows;
}

export async function searchFlights({ date, from, to }) {
  const { rows } = await pool.query(
    `${FLIGHTS_ON_DATE}
      WHERE f.active
        AND ($2::text IS NULL OR f.origin_code = $2)
        AND ($3::text IS NULL OR f.dest_code = $3)
      ORDER BY dep.at, f.flight_number`,
    [date, from ?? null, to ?? null],
  );
  return rows.map(toFlight);
}

export async function getFlight(id, date) {
  const { rows } = await pool.query(`${FLIGHTS_ON_DATE} WHERE f.id = $2 AND f.active`, [date, id]);
  return rows[0] ? toFlight(rows[0]) : null;
}

export async function getBookingsForUser(userId) {
  const { rows } = await pool.query(
    'SELECT *, flight_date::text AS flight_day FROM bookings WHERE user_id = $1 ORDER BY departs_at DESC',
    [userId],
  );
  return rows.map(toBooking);
}

// Validates the request against the real flight, prices it from the database and records the
// booking, all in one transaction. The client sends only what it wants
// ({ flightId, date, passengers, contact }); any price it sends is ignored.
export async function createBooking({ userId, flightId, date, passengerNames, contact }) {
  return withTransaction(async (client) => {
    // Lock the flight so concurrent bookings for it queue up: the seat count below is only safe
    // because nobody else can insert a booking for this flight until we commit.
    const { rows: [locked] } = await client.query(
      'SELECT origin_tz FROM flights WHERE id = $1 AND active FOR UPDATE',
      [flightId],
    );
    if (!locked) throw new HttpError(404, 'That flight no longer exists');

    const problem = checkBookingDate(date, locked.origin_tz);
    if (problem) throw new HttpError(400, problem);

    const { rows: [row] } = await client.query(`${FLIGHTS_ON_DATE} WHERE f.id = $2`, [date, flightId]);
    const flight = toFlight(row);
    if (!flight.bookable) throw new HttpError(400, 'Booking for that flight has closed');

    const count = passengerNames.length;
    if (flight.seatsLeft < count) {
      throw new HttpError(409, flight.seatsLeft === 0
        ? 'Sorry, that flight is sold out'
        : `Only ${flight.seatsLeft} ${flight.seatsLeft === 1 ? 'seat is' : 'seats are'} left on that flight`);
    }

    const { rows: [{ n: active }] } = await client.query(
      `SELECT count(*)::int AS n FROM bookings
        WHERE user_id = $1 AND status = 'confirmed' AND departs_at > now()`,
      [userId],
    );
    if (active >= MAX_ACTIVE_BOOKINGS_PER_USER) {
      throw new HttpError(409, `You can have at most ${MAX_ACTIVE_BOOKINGS_PER_USER} upcoming bookings. Cancel one first.`);
    }

    const totals = bookingTotals(flight.fare, count);
    const id = 'BK-' + randomUUID().slice(0, 8).toUpperCase();
    const { rows: [booking] } = await client.query(
      `INSERT INTO bookings (id, user_id, flight_id, flight_number, origin_code, origin_city, origin_tz,
                             dest_code, dest_city, dest_tz, flight_date, departs_at, arrives_at,
                             passengers, passenger_names, contact, subtotal, tax, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *, flight_date::text AS flight_day`,
      [id, userId, flight.id, flight.flightNumber, flight.originCode, flight.originCity, flight.originTz,
        flight.destCode, flight.destCity, flight.destTz, date, flight.departsAt, flight.arrivesAt,
        count, JSON.stringify(passengerNames), JSON.stringify(contact),
        totals.subtotal, totals.tax, totals.total],
    );
    return toBooking(booking);
  });
}

// Customers can only cancel their own bookings, and not too close to departure.
// Idempotent: cancelling an already-cancelled booking succeeds.
export async function cancelBooking(userId, id) {
  return withTransaction(async (client) => {
    const { rows: [b] } = await client.query(
      'SELECT *, flight_date::text AS flight_day FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    // Someone else's booking looks the same as a missing one.
    if (!b) throw new HttpError(404, 'Booking not found');
    if (b.status === 'cancelled') return toBooking(b);
    if (b.departs_at.getTime() - Date.now() < CANCEL_CUTOFF_HOURS * 3600 * 1000) {
      throw new HttpError(409, `Bookings can only be cancelled at least ${CANCEL_CUTOFF_HOURS} hours before departure`);
    }
    const { rows: [updated] } = await client.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *, flight_date::text AS flight_day`,
      [id],
    );
    return toBooking(updated);
  });
}

export async function close() {
  await pool.end();
}
