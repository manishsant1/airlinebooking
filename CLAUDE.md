# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run dev      # dev server on http://localhost:3000 (API + Vite with HMR, one process)
npm run build    # build the frontend into dist/
npm start        # production: serves the API and dist/ on PORT (default 3000)
npm run smoke    # end-to-end API checks against a RUNNING server (BASE_URL to target a deployment)
```

There is no unit-test suite, linter or formatter, so there is no single-test command; `scripts/smoke.mjs` is one sequential script. It signs up throwaway accounts, books and fills a flight 100 days out, and cancels the bookings and deletes the accounts in `finally`, so a rerun after a crash is normally clean (if it reports the flight already has bookings, cancel them first). Verify changes with `npm run build`, `npm run smoke`, and curl against a running server.

Requires Node >= 22.9 (uses `--env-file-if-exists` and the global `WebSocket` that Neon's Pool needs). `DATABASE_URL` (a Neon Postgres connection string) and `BETTER_AUTH_SECRET` (32+ random chars) must be set in `.env` or the environment, otherwise the server exits on startup. See `.env.example`.

## Architecture

A single deployable package: one Express process serves both the JSON API and the React app. There is no separate frontend server and no CORS. The browser calls same-origin `/api/*`.

- `server/index.js` mounts the API at `/api`, then either runs Vite in middleware mode (dev) or serves `dist/` with an `index.html` fallback for client-side routes (prod, chosen with `--prod` or `NODE_ENV=production`). It mounts Better Auth at `/api/auth/*splat` **before** `express.json()` (it reads the raw body; a parsed body makes its endpoints hang), and runs `db.init()` then `initAuth()` before listening. Vite is only imported in dev mode.
- `server/dev.js` is the dev runner. It spawns `index.js` and restarts it when a `.js` file under `server/` or `shared/` changes. **Do not replace it with `node --watch` / `--watch-path`.** On Windows these react to Vite writing `node_modules/.vite/deps_temp_*` and loop forever. For the same reason `index.js` imports `vite.config.js` itself and passes `configFile: false` to Vite.
- `server/db.js` is the only place with SQL. It uses `Pool` from `@neondatabase/serverless` (WebSocket, so interactive transactions work). The schema is idempotent `CREATE ... IF NOT EXISTS` run on every start, and `server/seed.js` is inserted only when `flights` is empty. There is no migration tool, so schema changes to existing tables need a manual `ALTER` (and the same change in `SCHEMA` for fresh databases). Postgres `numeric` columns come back as strings and are converted with `Number()` in `toFlight` / `toBooking`; `flight_date` is selected as text (`flight_day`) so the driver can't shift it by timezone.
- `createBooking` is the core invariant. In one transaction it locks the flight row (`FOR UPDATE`), validates the date window and the booking-close cutoff, counts the confirmed passengers for that flight and date, refuses with 409 if there are not enough seats, reprices from the database and inserts the booking. Seats are a capacity, not a uniqueness rule, so the row lock is what makes the count safe: do not remove it. The client sends only `{flightId, date, passengers, contact}`; fares it sends are ignored. Bookings snapshot the route, times and prices so past bookings don't change when the schedule does.
- Flights run daily. `depart_min` is minutes since midnight in the origin's timezone; `duration_min` is real elapsed time. Instants are `timestamptz`; Postgres does the timezone/DST conversion (`FLIGHTS_ON_DATE` in `db.js`, which also computes `seats_left`). No date library.
- `server/routes.js` handles request validation, and `HttpError` (`server/errors.js`) becomes `{error, details}` JSON. Express 5 forwards async throws to the error handler, so handlers simply `throw`.
- `shared/` is imported by both the server and the browser so the two can't disagree: `config.js` (vocabulary + business constants), `booking.js` (pricing, date rules), `validation.js` (form fields). Keep it dependency-free. The frontend imports it as `../../shared/...`.

### Identity (Better Auth)

`server/auth.js` configures Better Auth (email + password, cookie sessions in Postgres) on db.js's shared Neon `Pool`. Its tables are prefixed `airline_` (`airline_user`, ...) and `initAuth` creates them on every start. `requireUser` in `server/routes.js` turns the session cookie into `user.id`; bookings are filtered by `bookings.user_id`, never by anything in the request. Another user's booking returns 404, and `MAX_ACTIVE_BOOKINGS_PER_USER` caps upcoming bookings. The public URL comes from `BETTER_AUTH_URL`, then `RENDER_EXTERNAL_URL`, then localhost; it must match the browser's address or Better Auth rejects writes. Changing `BETTER_AUTH_SECRET` signs everyone out. There is no email verification or password reset (no mail provider). `bookings.user_id` has no foreign key (the auth tables are created after `db.init`), so deleting an account leaves its bookings. `db.js` renames the old `client_id` column to `user_id` on start; pre-auth rows belong to no account.

### Frontend (`src/`)

- `src/api/auth.js` wraps the Better Auth client (`useSession`, `signIn`, `signUp`, `signOut`); `RequireAuth` guards `/book` and `/bookings` and returns the user to where they were via router state.
- `src/api/api.js` is the only module that calls the server. It throws `ApiError` with `status` and `details` (per-field errors the form displays).
- The chosen flight, date and passenger count travel from `Home` (via `FlightCard`) to `Book` in router location state (survives reload). Effects that fetch on user input use an `off` flag so stale responses are dropped.
- Routing uses react-router v6 (`src/App.jsx`). Styling is a single global `src/index.css` with CSS variables, no CSS framework. Images are emoji.

## Windows environment notes

- Stopping a background `npm run dev` can leave `node ... server\index.js` / `server/dev.js` processes holding port 3000 (and Vite's HMR port 24678). Kill them before restarting.
- PowerShell `Invoke-WebRequest` to `localhost` can hang. Use `curl` from Bash.

## Deploy

See `README.md`. Render needs `npm install --include=dev` for the build step because Vite is a devDependency (`render.yaml` does this). `render.yaml` also generates `BETTER_AUTH_SECRET`; on other hosts set it and `BETTER_AUTH_URL` yourself.

- The repo is `origin` = `https://github.com/manishsant1/airlinebooking.git`, branch `main`. On this Windows machine Git's default OpenSSL can't find the CA store, so push with `git -c http.sslBackend=schannel push`. Don't read stored Git credentials directly; plain `git push` uses them itself.
- Production: Render web service `airline-booking` (id `srv-dbf3jp0n74is73be1neg`, region `ohio`, free plan) at https://airline-booking-2j5h.onrender.com, auto-deploying from `main`. It uses the same Neon database as local. Render's API refuses to create a service until the workspace has a card on file. Pass `DATABASE_URL` from `.env` to Render without printing it.
- Against production, Better Auth rate-limits sign-ups; `scripts/smoke.mjs` waits and retries on 429.
