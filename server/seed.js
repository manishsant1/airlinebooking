// Starter data, loaded the first time the server starts against an empty database.
// Flights run daily. departMin is minutes since midnight in the origin's timezone;
// durationMin is real elapsed time, so arrival is correct across timezones.
const AIRPORTS = {
  JFK: { city: 'New York', tz: 'America/New_York' },
  BOS: { city: 'Boston', tz: 'America/New_York' },
  MIA: { city: 'Miami', tz: 'America/New_York' },
  ATL: { city: 'Atlanta', tz: 'America/New_York' },
  ORD: { city: 'Chicago', tz: 'America/Chicago' },
  DFW: { city: 'Dallas', tz: 'America/Chicago' },
  DEN: { city: 'Denver', tz: 'America/Denver' },
  LAX: { city: 'Los Angeles', tz: 'America/Los_Angeles' },
  SFO: { city: 'San Francisco', tz: 'America/Los_Angeles' },
  SEA: { city: 'Seattle', tz: 'America/Los_Angeles' },
  LHR: { city: 'London', tz: 'Europe/London' },
  CDG: { city: 'Paris', tz: 'Europe/Paris' },
  NRT: { city: 'Tokyo', tz: 'Asia/Tokyo' },
};

const flight = (number, from, to, departMin, durationMin, fare, seats, aircraft) => ({
  id: number.toLowerCase(),
  flightNumber: number,
  originCode: from, originCity: AIRPORTS[from].city, originTz: AIRPORTS[from].tz,
  destCode: to, destCity: AIRPORTS[to].city, destTz: AIRPORTS[to].tz,
  departMin, durationMin, fare, seats, aircraft,
});

export const FLIGHTS = [
  flight('SB101', 'JFK', 'LAX', 420, 380, 289, 180, 'Airbus A320'),
  flight('SB102', 'LAX', 'JFK', 510, 305, 279, 180, 'Airbus A320'),
  flight('SB201', 'JFK', 'LHR', 1140, 420, 612, 250, 'Boeing 787-9'),
  flight('SB202', 'LHR', 'JFK', 600, 500, 598, 250, 'Boeing 787-9'),
  flight('SB301', 'SFO', 'SEA', 555, 125, 119, 120, 'Embraer E175'),
  flight('SB302', 'SEA', 'SFO', 1120, 130, 124, 120, 'Embraer E175'),
  flight('SB401', 'ORD', 'MIA', 740, 190, 176, 150, 'Boeing 737-800'),
  flight('SB402', 'MIA', 'ORD', 945, 185, 169, 150, 'Boeing 737-800'),
  flight('SB501', 'LAX', 'NRT', 690, 700, 842, 280, 'Boeing 777-300ER'),
  flight('SB601', 'BOS', 'ATL', 370, 165, 138, 150, 'Boeing 737-800'),
  flight('SB701', 'DFW', 'DEN', 965, 110, 102, 120, 'Embraer E175'),
  flight('SB801', 'JFK', 'CDG', 1290, 450, 655, 250, 'Airbus A330-300'),
  flight('SB802', 'JFK', 'LAX', 1080, 385, 259, 180, 'Airbus A320'),
];
