# SuperWork API — Reverse-Engineered Notes

Notes captured from poking the SuperWork backend behind this `superwork_v2` static frontend. Base URL throughout: `https://endpoint.superwork.tech/api/v1`.

All responses are wrapped:

```json
{ "result": { "serviceResult": { "code": 200, "status": "...", "reason": "...", "message": "..." }, "data": { ... } } }
```

The frontend extracts errors via `result.serviceResult.message` (see `api.js:_extractError`).

---

## Auth

### `POST /auth/login`

Body:

```json
{ "identified": "+8562055991913", "pin": "976452" }
```

`identified` is phone (E.164), email, or employee ID depending on the org. PIN is the user's numeric password.

Returns `result.data` with:

- `attendance_status` — one of `Not_CheckedIn_Yet`, `Checked_In`, `Checked_Out`
- `token.accessToken` — JWT, ~7 days expiry
- `token.refreshToken` — JWT, longer expiry
- `user` — full profile (id, gender, names, dob, identified, role, employeeNo, orgCode, avatarURL, position, team, joinOrganization → organization → modules / aiPrompts / ducumentTypeExports)

JWT payload fields observed: `avatarURL`, `displayName`, `employeeNo`, `exp`, `id`, `orgCode`, `role`, `teamId`.

### `GET /auth/profile`  (Bearer)

Returns `result.data.user` plus `attendance_status` and `externalEmployeeRegistrationAvailable`.

### Auth-related dead ends

These all return HTTP 200 with an empty body, which is the server's catch-all for non-existent routes — no real implementation:

- `/auth/sessions`, `/auth/login-history`, `/auth/devices`, `/auth/last-login`
- `/sessions`, `/users/me/sessions`, `/users/me/login-history`, `/users/me/devices`
- `/audit/logins`

There is no Member-accessible login/session/device history endpoint. The login endpoint also doesn't accept GPS, so the server doesn't record login coordinates.

---

## Check-in / Check-out (v2)

### `GET /check-in-out-v2/records`  (Bearer)

Returns `result.data` with pagination wrapper:

```json
{ "currentPage": 1, "len": 12, "limit": 500, "records": [ ... ] }
```

Each record:

```json
{
  "id": "uuid",
  "dateRequest": "YYYY-MM-DD",
  "timeIn": "HH:MM:SS",
  "timeOut": "HH:MM:SS",
  "shift": { "id", "expectedTimeIn", "expectedTimeOut", "isLate", "lateMinutes" },
  "employee": { "firstName", "lastName", "employeeNo", "avatarUrl" },
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

**Important quirk:** only the *current day's* record additionally exposes `latitude`, `longitude`, and `imageUrl`. Older records strip those fields. This means historical GPS is not retrievable through this API with a Member-role token. The frontend's `getTodayRecord()` (api.js) just filters the list by `dateRequest === today`.

Query params accepted (no-op for our purposes — same payload returned): `?detail=true`, `?include=events`, `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

Per-record detail paths that don't exist (return empty 200): `/records/{id}`, `/records/{id}/full`, `/records/detail/{id}`, `/records/{id}/events`, `/events?recordId=`, `/check-ins?recordId=`, `/me`, `/records/me`.

### `POST /check-in-out-v2/records`  (Bearer, multipart/form-data)

Fields:

| field | value |
| --- | --- |
| `type` | `Check_In_Out` |
| `attendance_status` | `Checked_In` or `Checked_Out` |
| `image` | selfie file (PNG also accepted with `Content-Type: image/jpeg`) |
| `latitude` | decimal degrees |
| `longitude` | decimal degrees |
| `accuracy` | meters (e.g. `20`) |
| `address` | optional human-readable string |

Curl example:

```bash
curl -X POST 'https://endpoint.superwork.tech/api/v1/check-in-out-v2/records' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'type=Check_In_Out' \
  -F 'attendance_status=Checked_In' \
  -F 'latitude=17.9635204' \
  -F 'longitude=102.6259623' \
  -F 'accuracy=20' \
  -F 'image=@/path/to/selfie.jpg;filename=selfie.jpg;type=image/jpeg'
```

### Server-side validations and errors

All HTTP 400 with `result.serviceResult.reason`:

- **`CHECK_IN_OUTSIDE_AREA`** — coordinates fall outside the org geofence. Note: `joinOrganization.organization.checkInRadiusMeters` is `0` in the login payload, but the server still enforces a real geofence. Treat `checkInRadiusMeters` as a placeholder, not authoritative.
- **`CHECK_IN_ALREADY_CHECKED_OUT`** — the day's in/out cycle is already complete. Once a record has both `timeIn` and `timeOut`, *both* `Checked_In` and `Checked_Out` POSTs are rejected for that day. One cycle per day.

(Other reasons likely exist for missing image, malformed coords, etc., but were not exercised.)

---

## Frontend (`superwork_v2/`)

Static HTML/JS, served from any HTTP server (`python3 -m http.server` is enough). Files:

- `index.html` — login form, redirects to `checkin.html` if `sw_token` is present in localStorage.
- `checkin.html` — captures selfie via `<video>`/`getUserMedia`, GPS via `navigator.geolocation`, and posts to the API.
- `history.html` — renders the records list.
- `api.js` — 4 wrapper methods: `login`, `getProfile`, `getAllRecords`, `getTodayRecord`, `checkInOut`.
- `styles.css`.

### localStorage keys

| key | written by | content |
| --- | --- | --- |
| `sw_token` | `index.html` (login) | accessToken JWT |
| `sw_refresh` | `index.html` | refreshToken JWT |
| `sw_user` | `index.html` | JSON of `result.data.user` |
| `sw_attendance` | `index.html` | `Not_CheckedIn_Yet` / `Checked_In` / `Checked_Out` |
| `sw_last_location` | `checkin.html` | last `{lat, lng, accuracy}` used |

`history.html` and `checkin.html` call `localStorage.clear()` on logout / 401-style failures.

### Flow

1. `index.html` → `POST /auth/login` → store token + user + attendance_status → redirect to `checkin.html`.
2. `checkin.html` → `GET /auth/profile` to refresh attendance_status, default the action select to the inverse of current state, capture selfie + GPS, `POST /check-in-out-v2/records`.
3. `history.html` → `GET /check-in-out-v2/records` and render rows.

---

## Org-level data (from login payload)

For org `71161522` (AIDC / Superwork):

- `modules` enables features in the app: `Check_In_Out`, `Task`, `Project`, `Calendar`, `Meeting`, `Leave`, `Approval`, `Document`, `E-Signature`, `AI-Summary`, `Live_Translate`, etc.
- `aiPrompts` contains preset Lao-language summarization prompts for meetings.
- `ducumentTypeExports` (sic) lists Lao document templates: `report`, `summary`, `workPlan`, `parReport`, `starMethod`, `meetingMinutes`, etc.
- `latitude` / `longitude` / `checkInRadiusMeters` are all `0` in the payload but the actual geofence is enforced server-side anyway.

---

## Practical tips for scripting

- Token lasts ~7 days. Cache `accessToken` between runs; only re-`login` on 401.
- To clock in for a fresh day, the server needs you to be both **inside the geofence** and **with no completed cycle** for `dateRequest = today`.
- The records endpoint is the only way to read *today's* GPS back; capture it on the day it happens or it's gone.
- Server's catch-all 200-empty-body response for unknown paths makes endpoint discovery noisy — only treat a non-empty `result` envelope as evidence the route exists.
