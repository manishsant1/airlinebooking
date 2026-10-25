import { Link } from 'react-router-dom';
import { formatDuration } from '../../shared/booking';
import { arrivalDayOffset, formatPrice, formatTime } from '../lib/format';

export default function FlightCard({ flight, passengers }) {
  const offset = arrivalDayOffset(flight);
  const enough = flight.seatsLeft >= passengers;
  const canBook = flight.bookable && enough;
  const note = !flight.bookable ? 'Booking closed'
    : flight.seatsLeft === 0 ? 'Sold out'
    : !enough ? `Only ${flight.seatsLeft} left`
    : flight.seatsLeft <= 10 ? `${flight.seatsLeft} seats left` : null;

  return (
    <div className="panel flight">
      <div className="flight-times">
        <div>
          <strong className="time">{formatTime(flight.departsAt, flight.originTz)}</strong>
          <div>{flight.originCode} <span className="muted small">{flight.originCity}</span></div>
        </div>
        <div className="flight-mid muted small">
          {formatDuration(flight.durationMin)}
          <div className="line-art" />
          {flight.flightNumber} · {flight.aircraft}
        </div>
        <div>
          <strong className="time">
            {formatTime(flight.arrivesAt, flight.destTz)}
            {offset > 0 && <sup className="muted small"> +{offset}</sup>}
          </strong>
          <div>{flight.destCode} <span className="muted small">{flight.destCity}</span></div>
        </div>
      </div>
      <div className="flight-buy">
        <div className="price">{formatPrice(flight.fare)} <span className="muted small">/ person</span></div>
        {note && <span className={`small ${canBook ? 'muted' : 'danger'}`}>{note}</span>}
        {canBook ? (
          <Link
            to="/book"
            state={{ flightId: flight.id, date: flight.date, passengers }}
            className="btn"
          >
            Select
          </Link>
        ) : (
          <button className="btn" disabled>Select</button>
        )}
      </div>
    </div>
  );
}
