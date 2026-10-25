import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { createBooking, getFlight } from '../api/api';
import { load, save } from '../api/storage';
import { LABELS } from '../../shared/config';
import { bookingTotals, formatDuration } from '../../shared/booking';
import { CONTACT_FIELDS, PASSENGER_FIELD, validateBooking } from '../../shared/validation';
import { formatDay, formatPrice, formatWhen } from '../lib/format';
import Summary from '../components/Summary';

// The choice (flight, date, passenger count) arrives in the router's location state, which
// the browser keeps across a reload. Opening /book directly has no state, so go back to searching.
export default function Book() {
  const choice = useLocation().state;
  const navigate = useNavigate();
  const [flight, setFlight] = useState(undefined); // undefined = loading, null = not found
  const [loadError, setLoadError] = useState(null);
  // Remember the last contact details to make repeat bookings faster.
  const [contact, setContact] = useState(() => load('contact', {}));
  const [names, setNames] = useState(() => Array.from({ length: choice?.passengers ?? 0 }, () => ''));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!choice) return;
    getFlight(choice.flightId, choice.date).then(setFlight).catch((err) => setLoadError(err.message));
  }, [choice]);

  if (!choice) return <Navigate to="/" replace />;
  if (loadError) return <p className="alert">{loadError}</p>;
  if (flight === undefined) return <p className="muted">Loading…</p>;
  if (flight === null) return <p className="alert">That flight no longer exists. <Link to="/">Search again</Link></p>;

  // Shown as an estimate; the server recalculates the price from its own data.
  const totals = bookingTotals(flight.fare, names.length);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    const passengers = names.map((fullName) => ({ fullName }));
    const errs = validateBooking({ passengers, contact });
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    save('contact', contact);
    try {
      const booking = await createBooking({ flightId: flight.id, date: choice.date, passengers, contact });
      navigate('/bookings', { state: { justBooked: booking.id }, replace: true });
    } catch (err) {
      setErrors(err.details ?? {});
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1>Confirm your {LABELS.booking.toLowerCase()}</h1>
      <form className="two-col" onSubmit={handleSubmit} noValidate>
        <div>
          <div className="panel">
            <h3>{names.length === 1 ? 'Passenger' : 'Passengers'}</h3>
            <div className="form-grid">
              {names.map((name, i) => (
                <label key={i} className={errors[`passenger-${i}`] ? 'invalid' : ''}>
                  {names.length > 1 ? `Passenger ${i + 1}: ` : ''}{PASSENGER_FIELD.label}
                  <input
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
                  />
                  {errors[`passenger-${i}`] && <span className="error">{errors[`passenger-${i}`]}</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="panel gap-top">
            <h3>Contact details</h3>
            <div className="form-grid">
              {CONTACT_FIELDS.map((f) => (
                <label key={f.name} className={errors[f.name] ? 'invalid' : ''}>
                  {f.label}
                  <input
                    type={f.type ?? 'text'}
                    autoComplete={f.autoComplete}
                    value={contact[f.name] ?? ''}
                    onChange={(e) => setContact({ ...contact, [f.name]: e.target.value })}
                  />
                  {errors[f.name] && <span className="error">{errors[f.name]}</span>}
                </label>
              ))}
            </div>
            <p className="muted small">This is a demo. No real payment is taken.</p>
          </div>
        </div>
        <aside className="panel">
          <h3>{LABELS.booking} summary</h3>
          <div className="mini-line">
            <span>{flight.originCode} → {flight.destCode}</span>
            <span>{flight.flightNumber}</span>
          </div>
          <div className="mini-line">
            <span>{formatDay(choice.date)}</span>
            <span>{formatDuration(flight.durationMin)}</span>
          </div>
          <div className="mini-line">
            <span>Departs</span>
            <span>{formatWhen(flight.departsAt, flight.originTz)}</span>
          </div>
          <div className="mini-line">
            <span>Arrives</span>
            <span>{formatWhen(flight.arrivesAt, flight.destTz)}</span>
          </div>
          <div className="mini-line">
            <span>{names.length} × {formatPrice(flight.fare)}</span>
            <span>{formatPrice(totals.subtotal)}</span>
          </div>
          <Summary totals={totals} />
          {submitError && (
            <p className="alert">
              {submitError}
              {' '}
              <Link to="/">Choose another flight</Link>
            </p>
          )}
          <button type="submit" className="btn block" disabled={submitting}>
            {submitting ? 'Booking…' : `Confirm · ${formatPrice(totals.total)}`}
          </button>
          <Link to="/" className="link-btn">← Back to search</Link>
        </aside>
      </form>
    </>
  );
}
