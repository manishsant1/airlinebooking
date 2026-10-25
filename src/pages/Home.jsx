import { useEffect, useState } from 'react';
import { getAirports, searchFlights } from '../api/api';
import { MAX_ADVANCE_DAYS, MAX_PASSENGERS } from '../../shared/config';
import { addDays, todayIn } from '../../shared/booking';
import { formatDay } from '../lib/format';
import FlightCard from '../components/FlightCard';

const localToday = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

export default function Home() {
  const [airports, setAirports] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState(() => addDays(localToday(), 1));
  const [passengers, setPassengers] = useState(1);
  const [flights, setFlights] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAirports().then(setAirports).catch((err) => setError(err.message));
  }, []);

  // The `off` flag drops a slow reply that arrives after the search has changed.
  useEffect(() => {
    let off = false;
    setFlights(null);
    setError(null);
    searchFlights({ date, from, to })
      .then((f) => !off && setFlights(f))
      .catch((err) => !off && setError(err.message));
    return () => { off = true; };
  }, [date, from, to]);

  const today = localToday();

  return (
    <>
      <section className="hero">
        <h1>Find your next flight.</h1>
        <p>Search a route, pick a flight, and book in a minute.</p>
      </section>

      <div className="panel search">
        <label className="field">
          From
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Anywhere</option>
            {airports.map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
          </select>
        </label>
        <label className="field">
          To
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Anywhere</option>
            {airports.map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
          </select>
        </label>
        <label className="field">
          Date
          <input
            type="date"
            value={date}
            min={today}
            max={addDays(today, MAX_ADVANCE_DAYS)}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <label className="field">
          Passengers
          <select value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}>
            {Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <h3 className="results-title">Flights on {formatDay(date)}</h3>
      {error ? (
        <p className="alert">{error}</p>
      ) : !flights ? (
        <p className="muted">Loading…</p>
      ) : flights.length === 0 ? (
        <p className="empty">No flights match this search. Try another route or date.</p>
      ) : (
        flights.map((f) => <FlightCard key={f.id} flight={f} passengers={passengers} />)
      )}
    </>
  );
}
