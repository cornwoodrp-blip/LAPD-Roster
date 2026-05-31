# PD Roster

A police department roster management web app for a roleplay community (Los Santos PD). No npm dependencies — pure Node.js ESM, vanilla JS frontend, JSON file storage.

## Running

```bash
node server.js        # starts on http://localhost:3000
npm run dev           # same
```

Seed accounts (pre-loaded in `data/users.json`):
- `admin@pd.local` / `admin123` — full permissions
- `editor@pd.local` / `editor123` — can edit roster
- `viewer@pd.local` / `viewer123` — read-only dashboard

## Architecture

```
server.js           — single-file HTTP server, all API routes
public/
  index.html        — SPA shell with all three views
  app.js            — vanilla JS, handles routing and API calls
  styles.css        — all styles
data/
  roster.json       — roster entries (source of truth)
  users.json        — user accounts with hashed-less passwords
  applications.json — join applications
  source-roster.csv — original import source
scripts/
  import-roster.mjs — one-time CSV → roster.json importer
```

## Key facts

**Auth**: In-memory session Map (resets on server restart). Cookie `pd_session` (HttpOnly, 8h). Two permission flags: `canEditRoster`, `canManageUsers`.

**Roster entry fields**: `id`, `callsign`, `name`, `activity`, `rank`, `divisions` (object of booleans), `strikes` (object of booleans), `notes`, `promotionDate`, `tig`, `vacant`.

**Rank categories** (defined in `app.js`): High Command → Command → Supervisor → Supervisor In Training → Patrol Officer → Probationary Officer → Officer In Training. These drive the category overview cards on the public roster.

**Divisions** (from roster.json): Canine, DCI, TEU, AIR-1, S.E.R.T, CFR, TBD. The frontend `app.js` also has a hardcoded legacy list (`ONB`, `TEU`, `AIR`, `GIU`, `DCI`, `CSI`) used for checkbox rendering — keep these in sync if divisions change.

**API routes**:
- `GET /api/roster` — public, no auth
- `GET /api/session` — returns current user
- `POST /api/login` / `POST /api/logout`
- `POST /api/applications` — public, submit application
- `GET /api/applications` — requireEdit
- `POST /api/applications/:id/accept` — requireEdit, also creates roster entry
- `POST /api/applications/:id/reject` — requireEdit
- `GET/POST /api/roster` — GET public, POST requireEdit
- `PUT/DELETE /api/roster/:id` — requireEdit
- `GET/POST /api/users` — requireManageUsers
- `PUT /api/users/:id` — requireManageUsers

## Data files

`data/roster.json` also stores `department`, `divisions` (array), `strikes` (array), `importedAt`, `source`, `updatedAt`, `updatedBy`.

Do not add a build step, bundler, or npm packages without discussing first — the zero-dependency constraint is intentional.
