// Form rules shared by the browser (instant feedback) and the API (the real check).
import { MAX_PASSENGERS } from './config.js';

export const CONTACT_FIELDS = [
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
];

export const PASSENGER_FIELD = { name: 'fullName', label: 'Full name (as on ID)' };

// Returns a map of field -> message: `email`, `phone`, `passengers`, or `passenger-<index>`.
export function validateBooking(input) {
  const { passengers, contact } = input ?? {}; // a JSON body can send null, which a default parameter would not catch
  const errors = {};

  const form = contact ?? {};
  for (const f of CONTACT_FIELDS) {
    const value = form[f.name];
    if (typeof value !== 'string' || !value.trim()) errors[f.name] = 'Required';
    else if (value.length > 200) errors[f.name] = 'Too long';
  }
  if (!errors.email && !/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email';
  if (!errors.phone && !/^[\d\s+()-]{7,}$/.test(form.phone)) errors.phone = 'Enter a valid phone number';

  if (!Array.isArray(passengers) || passengers.length < 1 || passengers.length > MAX_PASSENGERS) {
    errors.passengers = `Between 1 and ${MAX_PASSENGERS} passengers`;
    return errors;
  }
  passengers.forEach((p, i) => {
    const name = p?.fullName;
    if (typeof name !== 'string' || !name.trim()) errors[`passenger-${i}`] = 'Required';
    else if (name.trim().length < 2 || name.length > 100 || !/^\p{L}[\p{L} .'-]*$/u.test(name.trim())) {
      errors[`passenger-${i}`] = 'Enter a valid name';
    }
  });
  return errors;
}
