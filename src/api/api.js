// All server calls go through here. The API lives on the same origin under /api,
// so no base URL or CORS setup is needed.
// Sign-in is a same-origin httpOnly session cookie (see auth.js), so requests carry no credentials of their own.

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data;
}

export const getAirports = () => request('/airports');
export const getBookings = () => request('/bookings');

export const searchFlights = ({ date, from, to }) => {
  const q = new URLSearchParams({ date });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return request(`/flights?${q}`);
};

export async function getFlight(id, date) {
  try {
    return await request(`/flights/${encodeURIComponent(id)}?date=${encodeURIComponent(date)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Only what the customer chose is sent; the server checks the schedule and seats and sets the price.
export const createBooking = ({ flightId, date, passengers, contact }) =>
  request('/bookings', { method: 'POST', body: { flightId, date, passengers, contact } });

export const cancelBooking = (id) => request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
