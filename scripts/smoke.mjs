// End-to-end check of auth and the booking rules against a RUNNING server (npm run dev / npm start).
//   npm run smoke                      -> http://localhost:3000
//   BASE_URL=https://my-app.onrender.com npm run smoke
// It creates throwaway accounts, books seats on the smallest flight 100 days ahead, fills it up,
// checks that it cannot be oversold (including under a race), then cancels everything it booked
// and deletes the accounts again.
import assert from 'node:assert/strict';
import { addDays, todayIn } from '../shared/booking.js';
import { MAX_ACTIVE_BOOKINGS_PER_USER } from '../shared/config.js';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const contact = { email: 'smoke@example.com', phone: '555 010 1234' };
const people = (n) => Array.from({ length: n }, (_, i) => ({ fullName: `Smoke Tester ${'ABCDEFGHI'[i]}` }));
const password = 'smoke-' + Math.random().toString(36).slice(2) + 'Aa1';

// A "browser": remembers cookies between calls. Better Auth rejects cookie-bearing writes whose
// Origin is not the app's own address, so every call sends one.
function makeUser(label) {
  const jar = new Map();
  const email = `smoke-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body && JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      pair.slice(i + 1) ? jar.set(pair.slice(0, i), pair.slice(i + 1)) : jar.delete(pair.slice(0, i));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { email, call };
}

const step = (name) => console.log('•', name);
const anon = makeUser('anon');
const users = []; // every account that signed up; deleted at the end
const booked = []; // { id, user } to cancel at the end

async function newUser(label) {
  const u = makeUser(label);
  // Production rate-limits sign-ups to a few per 10 seconds; wait the window out rather than fail.
  let up;
  for (let attempt = 0; attempt < 6; attempt++) {
    up = await u.call('/auth/sign-up/email', { method: 'POST', body: { name: 'Smoke ' + label, email: u.email, password } });
    if (up.status !== 429) break;
    await new Promise((r) => setTimeout(r, 11000));
  }
  assert.equal(up.status, 200, JSON.stringify(up.data));
  users.push(u);
  return u;
}

async function book(user, body) {
  const res = await user.call('/bookings', { method: 'POST', body });
  if (res.status === 201) booked.push({ id: res.data.id, user });
  return res;
}

try {
  step('health');
  assert.equal((await anon.call('/health')).status, 200);

  step('airports (public)');
  const airports = (await anon.call('/airports')).data;
  assert.ok(airports.length > 1 && airports[0].code, 'no airports (is the database seeded?)');

  step('search (public)');
  const date = addDays(todayIn('UTC'), 100);
  const all = await anon.call(`/flights?date=${date}`);
  assert.equal(all.status, 200);
  assert.ok(all.data.length > 0, 'no flights');
  const flight = [...all.data].sort((a, b) => a.seats - b.seats)[0];
  assert.equal(flight.seatsLeft, flight.seats, `flight already has bookings on ${date}; cancel them and rerun`);
  const route = await anon.call(`/flights?date=${date}&from=${flight.originCode}&to=${flight.destCode}`);
  assert.ok(route.data.every((f) => f.originCode === flight.originCode && f.destCode === flight.destCode));
  assert.ok(route.data.some((f) => f.id === flight.id));
  assert.equal((await anon.call('/flights?date=nope')).status, 400, 'bad date');
  assert.equal((await anon.call(`/flights?date=${date}&from=x'--`)).status, 400, 'bad airport code');
  assert.equal((await anon.call(`/flights/${flight.id}?date=${date}`)).data.flightNumber, flight.flightNumber);
  assert.equal((await anon.call(`/flights/nope?date=${date}`)).status, 404);

  const base = { flightId: flight.id, date, passengers: people(1), contact };

  step('bookings need a signed-in user (401)');
  assert.equal((await anon.call('/bookings')).status, 401);
  assert.equal((await anon.call('/bookings', { method: 'POST', body: base })).status, 401);
  assert.equal((await anon.call('/bookings/BK-NOPE/cancel', { method: 'POST' })).status, 401);

  step('sign up, session, wrong password and short password refused');
  const alice = await newUser('alice');
  assert.equal((await alice.call('/auth/get-session')).data?.user?.email, alice.email);
  assert.notEqual((await anon.call('/auth/sign-in/email', { method: 'POST', body: { email: alice.email, password: password + 'x' } })).status, 200);
  assert.equal((await anon.call('/auth/sign-up/email', { method: 'POST', body: { name: 'x', email: 'short@example.com', password: 'short' } })).status, 400, 'short password');

  step('rejects bad input');
  const post = (body) => alice.call('/bookings', { method: 'POST', body });
  assert.equal((await post({ ...base, passengers: [] })).status, 400, 'no passengers');
  assert.equal((await post({ ...base, passengers: people(10) })).status, 400, 'too many passengers');
  assert.equal((await post({ ...base, passengers: [{ fullName: '12' }] })).status, 400, 'bad name');
  assert.equal((await post({ ...base, passengers: [null] })).status, 400, 'null passenger');
  assert.equal((await post({ ...base, contact: null })).status, 400, 'null contact');
  assert.equal((await post({ ...base, date: addDays(todayIn('UTC'), -3) })).status, 400, 'past date');
  assert.equal((await post({ ...base, date: addDays(todayIn('UTC'), 400) })).status, 400, 'too far ahead');
  assert.equal((await post({ ...base, flightId: 'nope' })).status, 404, 'unknown flight');

  step('book, ignoring a client-sent price');
  const first = await book(alice, { ...base, passengers: people(2), total: 0.01, fare: 0.01 });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const expected = Math.round(flight.fare * 2 * 1.12 * 100) / 100;
  assert.ok(Math.abs(first.data.total - expected) < 0.02, `total ${first.data.total} != ${expected}`);
  assert.equal(first.data.passengers, 2);
  assert.equal(first.data.date, date);

  step('seats are taken');
  const after = (await anon.call(`/flights/${flight.id}?date=${date}`)).data;
  assert.equal(after.seatsLeft, flight.seats - 2);

  step('only the owner sees and can cancel it');
  const bob = await newUser('bob');
  assert.equal((await bob.call('/bookings')).data.length, 0);
  assert.equal((await bob.call(`/bookings/${first.data.id}/cancel`, { method: 'POST' })).status, 404);
  assert.ok((await alice.call('/bookings')).data.some((b) => b.id === first.data.id));

  step('fill the flight; overselling is refused (409)');
  // Each account may hold only MAX_ACTIVE_BOOKINGS_PER_USER upcoming bookings, so rotate fillers.
  let filler = null;
  let fillerCount = MAX_ACTIVE_BOOKINGS_PER_USER;
  for (;;) {
    const left = (await anon.call(`/flights/${flight.id}?date=${date}`)).data.seatsLeft;
    if (left < 9) break;
    if (fillerCount >= MAX_ACTIVE_BOOKINGS_PER_USER) { filler = await newUser('filler'); fillerCount = 0; }
    const res = await book(filler, { ...base, passengers: people(9) });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    fillerCount++;
  }
  const left = (await anon.call(`/flights/${flight.id}?date=${date}`)).data.seatsLeft;
  assert.ok(left < 9);
  const over = await book(bob, { ...base, passengers: people(left + 1) });
  assert.equal(over.status, 409, 'overbooking must be refused');

  if (left > 0) {
    step('two racing requests for the last seats: exactly one wins');
    const carol = await newUser('carol');
    const [a, b] = await Promise.all([
      book(bob, { ...base, passengers: people(left) }),
      book(carol, { ...base, passengers: people(left) }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  }
  assert.equal((await anon.call(`/flights/${flight.id}?date=${date}`)).data.seatsLeft, 0);
  assert.equal((await book(alice, base)).status, 409, 'sold out');

  step('cancel frees the seats');
  assert.equal((await alice.call(`/bookings/${first.data.id}/cancel`, { method: 'POST' })).data.status, 'cancelled');
  assert.equal((await alice.call(`/bookings/${first.data.id}/cancel`, { method: 'POST' })).data.status, 'cancelled', 'idempotent');
  assert.equal((await anon.call(`/flights/${flight.id}?date=${date}`)).data.seatsLeft, 2);
  assert.equal((await book(alice, base)).status, 201);

  step('per-account cap on upcoming bookings (409)');
  const capDate = addDays(todayIn('UTC'), 101);
  const capFlight = [...(await anon.call(`/flights?date=${capDate}`)).data].sort((a, b) => b.seats - a.seats)[0];
  const capBody = { flightId: capFlight.id, date: capDate, passengers: people(1), contact };
  const dave = await newUser('dave');
  for (let i = 0; i < MAX_ACTIVE_BOOKINGS_PER_USER; i++) {
    assert.equal((await book(dave, capBody)).status, 201);
  }
  assert.equal((await book(dave, capBody)).status, 409, 'cap');

  step('sign out ends the session; sign in again works');
  await alice.call('/auth/sign-out', { method: 'POST', body: {} });
  assert.equal((await alice.call('/bookings')).status, 401);
  assert.equal((await alice.call('/auth/sign-in/email', { method: 'POST', body: { email: alice.email, password } })).status, 200);
  assert.equal((await alice.call('/bookings')).status, 200);

  console.log('\nAll checks passed.');
} finally {
  // Always release the seats this run took and remove the accounts, even when a check failed.
  for (const { id, user } of booked) await user.call(`/bookings/${id}/cancel`, { method: 'POST' }).catch(() => {});
  console.log(`Cancelled ${booked.length} smoke bookings.`);
  for (const u of users) await u.call('/auth/delete-user', { method: 'POST', body: { password } }).catch(() => {});
  console.log(`Deleted ${users.length} smoke accounts.`);
}
