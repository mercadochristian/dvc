# Feature folders

`src/app` owns stable routes, layouts, metadata and styles. Route entry points import feature modules directly; moving feature code does not change public URLs or API contracts. Tests remain in `src/__tests__` and `tests/e2e`.

| Folder | Owns |
| --- | --- |
| `club/ui/shell` | Club application shell and navigation |
| `club/ui/games` | Games, filters, calendar/table, bookings and game actions |
| `club/ui/registration` | Registration, player details and teammate forms |
| `club/ui/management` | Task-focused venue, account/access, payment and announcement screens |
| `club/ui/lineups` | Lineup editor and announcement prototype |
| `club/ui/shared` | Club primitives, collections, required markers and venue links |
| `club/api` | Browser HTTP adapters |
| `club/model` | Types, domain validation, permissions, formatting and form helpers |
| `club/server` | Server-only database/Auth/Storage/cookie gateway and HTTP/body/image helpers |
| `legacy-schedule/ui` | Existing Sheets schedule page and components |
| `legacy-schedule/model` | Legacy types, parsing, requests, polling and client hooks |
| `legacy-schedule/server` | Sheets access and cache adapters |
| `pwa` | Global install prompt and dismissal state |

Use direct imports, without barrel exports. Club and legacy schedule types and game cards are separate features. Keep the server gateway's `server-only` protection and prevent browser modules from importing it.

Formatting lives in model/format.ts; browser transport stays in api/client.ts. Request/origin/body/image checks live in server/http.ts, while canonical asset paths and date-range rules remain domain validation. Game editing/transfers/facilitator assignment, manual registration/player support and management access/payment tools use separate task-focused files. StaffRoster remains a local alias of LineupBoard, preserving its existing function identity without a forwarding module.
