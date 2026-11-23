# EdgeOne Personal Storage Server

A personal multi-project storage server for **EdgeOne Pages**: a modern dashboard that stores TXT/JSON
records in **KV** and images/documents in **Blob**, with a maximum of **2 isolated projects**, each
getting its own auto-generated project ID and two very different connection configs — a **write-only
User Panel credential** and a **full-access Admin secret**.

```
┌──────────────────────────────┐
│  Dashboard (Vite + vanilla)  │  ← admin only, session token in memory/localStorage
└──────────────┬───────────────┘
               │  Bearer: das_… (session) / adm_… (admin secret) / etu1.… (user token)
┌──────────────▼───────────────┐
│  EdgeOne Pages Functions     │  functions/api/* → server/app.js (single router)
│  auth · permissions · limits │
└──────────┬─────────┬─────────┘
           │         │
   ┌───────▼──┐  ┌───▼────────┐
   │ KV       │  │ Blob       │
   │ records  │  │ files      │
   │ metadata │  │ images/PDF │
   └──────────┘  └────────────┘
```

---

## 1. What it does

| Capability | Where |
|---|---|
| Dashboard: totals, storage meters, recent activity | `src/pages/dashboard.js` |
| Projects: create (max 2), rename, pause, delete with typed confirm | `src/pages/projects.js` |
| Per-project user + admin configs, rotation, `.env` export | `src/pages/project-details.js` |
| KV manager: list / search / filter / view / create / edit / delete records | `src/pages/storage.js` |
| Blob manager: upload (drop zone), list, download, delete | `src/pages/storage.js`, `src/pages/project-details.js` |
| Settings: server config, auth, storage info, maintenance | `src/pages/settings.js` |
| In-app API reference + security notes | `src/pages/docs.js` |

### Credential matrix

| Credential | Format | Can | Cannot |
|---|---|---|---|
| **Dashboard session** | `das_<payload>.<hmac>` | everything (admin) | — |
| **Admin secret** (per project) | `adm_…` | read/write/delete **inside its project** | list projects, change settings, touch the other project |
| **User token** (per project) | `etu1.<payload>.<hmac>` | create records, upload files, read own project meta | **read, list, update, delete**, choose record ids, cross-project access |

The user token is intentionally *publishable* — it is a signed capability token capped at
`data.create` + `files.upload` + `meta.read`, and the server re-checks every request. It is never a
storage key and never grants read access.

---

## 2. Quick start (local)

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run dev` serves the dashboard with an **in-browser mock backend** (`src/services/mock-backend.js`)
so you can click through everything — two seeded projects, records, files — without any EdgeOne
resources. Demo login:

```
email:    owner@storage.local
password: preview-admin-123
```

The preview banner at the top of the app makes it obvious when you are in this mode.

### Verify before you deploy

```bash
npm run smoke         # 54 API security + functional checks (in-memory KV/Blob)
node scripts/browser-test.mjs   # 37 browser E2E checks (needs the dev server running)
```

`npm run smoke` proves the interesting properties: the user token cannot read/update/delete, project
B is unreachable from project A's credentials, rotation revokes instantly, the 2-project cap holds,
and deletion requires a typed confirmation.

---

## 3. Deploy to EdgeOne Pages

### 3.1 Push the repo and create the project

Connect the repository in the EdgeOne Pages console. `edgeone.json` already pins the build:

```json
{ "buildCommand": "npm run build", "outputDirectory": "dist", "nodeVersion": "20.18.0" }
```

### 3.2 Create + bind the KV namespace  ← required

Console → **Storage → KV → Create namespace** → then **Project → Bindings → KV** and bind it with the
variable name:

```
STORAGE_KV
```

If this binding is missing the Functions still boot, but every write lands in an in-memory map that
does not persist (the health endpoint reports `kvBackend: "STORAGE_KV (unbound)"`).

### 3.3 Blob store

No setup needed. `@edgeone/pages-blob` creates the namespace `storage-server` on first write. To use a
different name, set the environment variable `BLOB_STORE_NAME`.

### 3.4 Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ADMIN_SETUP_KEY` | **strongly recommended** | Without it, the first visitor can complete `/api/auth/setup`. With it, setup requires an `X-Setup-Key` match. |
| `ADMIN_EMAIL` | optional | Pre-fills the admin email on the setup screen. |
| `BLOB_STORE_NAME` | optional | Blob namespace (default `storage-server`). |

### 3.5 First run

1. Open the deployment URL → the app detects `initialised: false` and shows **Set up your server**.
2. Create the admin account (≥10 chars). The password is PBKDF2-SHA256 (100k iterations) — only the
   hash reaches KV.
3. Create project 1 and 2 → copy the generated configs.

> There is no password-reset flow by design. If you lose the password, delete the `ss_admin_v1` key
> from the KV console and reload to run setup again.

---

## 4. Folder structure

```
edgeone-storage-server/
├── index.html                  # dashboard entry
├── edgeone.json                # EdgeOne build config (build cmd, output dir, SPA redirects)
├── vite.config.js              # Vite + dev-only /api/health shim
├── package.json
│
├── functions/api/              # EdgeOne Pages Functions (thin entrypoints)
│   ├── [[default]].js          # catch-all → server/app.js
│   ├── projects.js             # /api/projects*
│   ├── data.js                 # /api/data*
│   ├── files.js                # /api/files*
│   ├── configs.js              # /api/config*
│   └── auth.js                 # /api/auth*
│
├── server/                     # runtime-neutral backend (no Node built-ins)
│   ├── app.js                  # router: auth → permission → project → handler
│   ├── core.js                 # shared: ids, PBKDF2, HMAC tokens, validation, key naming
│   ├── runtime.js              # binds EdgeOne context.env → services
│   ├── storage.js              # KV + Blob adapters (+ in-memory fallbacks)
│   ├── project-manager.js      # create/update/delete/rotate, config generation
│   ├── permission-manager.js   # policy tables, authenticate(), assertProjectAccess()
│   ├── kv-manager.js           # record CRUD, search, usage accounting
│   ├── blob-manager.js         # upload/download/delete, type + size validation
│   ├── auth.js                 # admin setup/login, stateless HMAC sessions
│   ├── activity.js             # rolling activity log
│   ├── ratelimit.js            # fixed-window KV counters
│   └── http.js                 # json/error/CORS helpers, route matching
│
├── src/                        # dashboard (vanilla JS modules)
│   ├── main.js · app.js        # entry + hash router + shell
│   ├── pages/                  # dashboard, projects, project-details, storage, settings, docs, auth-screens
│   ├── components/             # sidebar, header, project-card, storage-card, data-table, modal, icons
│   ├── services/               # api, auth, project, kv, blob (+ mock-backend for preview)
│   ├── utils/                  # config-generator, validators, helpers
│   └── styles/                 # main.css, dashboard.css, responsive.css
│
├── scripts/
│   ├── smoke-test.mjs          # 54 API checks against in-memory storage
│   └── browser-test.mjs        # 37 Playwright E2E checks
└── public/  favicon.svg · logo.svg
```

`server/` is deliberately free of Node APIs so the *same* code runs in Edge Functions and in the
browser mock — one behaviour, two hosts.

---

## 5. API

Base: `https://<your-domain>/api` · every request needs `Authorization: Bearer <token>` unless marked public.

### Auth
| Method | Path | Scope |
|---|---|---|
| `POST` | `/auth/setup` | public, only once |
| `POST` | `/auth/login` | public (10 tries / 5 min / IP) |
| `GET` | `/auth/status` | public |
| `GET` | `/auth/me` | dashboard |
| `POST` | `/auth/password` · `/auth/email` | dashboard |

### Projects
| Method | Path | Scope |
|---|---|---|
| `GET` | `/projects` | dashboard |
| `POST` | `/projects` | dashboard (max 2) |
| `GET` | `/projects/:id` | dashboard \| project admin |
| `PATCH` `PUT` | `/projects/:id` | dashboard |
| `DELETE` | `/projects/:id?purge=1` | dashboard + `confirmName` |
| `POST` | `/projects/:id/rotate` | dashboard (`kind=user\|admin\|both`) |

### Data (KV)
| Method | Path | Scope |
|---|---|---|
| `POST` | `/data` | dashboard \| project admin \| **user (create only)** |
| `GET` | `/data?projectId=…&q=&type=&kind=&limit=&offset=` | dashboard \| project admin |
| `GET` `PUT` `DELETE` | `/data/:id?projectId=…` | dashboard \| project admin |

### Files (Blob)
| Method | Path | Scope |
|---|---|---|
| `POST` | `/files` (multipart, field `file`) | dashboard \| project admin \| **user (upload only)** |
| `GET` | `/files?projectId=…` | dashboard \| project admin |
| `GET` | `/files/:id?projectId=…` | dashboard \| project admin |
| `DELETE` | `/files/:id?projectId=…` | dashboard \| project admin |

### Config, stats, settings
`GET /config/:projectId` · `GET /stats` · `GET|DELETE /activity` · `GET|PUT /settings` ·
`GET /maintenance/orphans` · `POST /maintenance/recount` · `GET /health`

### Example: public form → server

```bash
curl -X POST https://your-app.edgeone.run/api/data \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "prj_xxxxxxxx",
    "type": "json",
    "kind": "contact",
    "key": "contact-form",
    "content": { "name": "Aarav", "email": "aarav@example.com" }
  }'
```

Response envelope is always `{ ok, data }` or `{ ok: false, error: { code, message } }`.

---

## 6. Data model

| KV key | Contents |
|---|---|
| `ss_admin_v1` | email, PBKDF2 hash, session signing secret |
| `ss_projects_index_v1` | array of project ids (max 2) |
| `ss_project_<id>` | project record incl. both configs, usage, settings |
| `ss_records_<id>` | array of record ids for that project |
| `ss_record_<id>_<rid>` | one record: `{ id, type, kind, key, content, tags, meta, version, createdAt, updatedAt }` |
| `ss_files_<id>` | array of file metadata |
| `ss_file_<id>_<fid>` | one file's metadata |
| `ss_activity_v1` | last 100 events |
| `ss_settings_v1` | server settings |
| `ss_rl_<scope>_<bucket>` | rate-limit counters |

Blob objects live at `<projectId>/files/<fileId>.<ext>`.

> EdgeOne KV keys may only contain letters, numbers and underscores (≤512 B), which is why every key
> above is `snake_case`. Blob keys allow slashes, so files keep a readable folder layout.

Isolation is enforced by key prefix **and** by `assertProjectAccess()` on every request — a credential
from project A can never read a prefix belonging to project B.

---

## 7. Security notes

- **Admin credentials never reach the browser.** The browser only holds a short-lived HMAC session
  token (`das_…`, 12 h). The password hash and signing secret stay in KV.
- **User credential is write-only by policy**, not by convention: `POLICY.user` contains exactly
  `data.create`, `files.upload`, `project.read`, `config.read`, `stats.read`. Anything else returns 403.
- **Every request** re-validates: token signature → project status (`active`) → rotation id →
  project ownership → action permission.
- **Rotation is instant.** Changing a user token or admin secret bumps the rotation id stored in the
  project record, which invalidates the old credential on its next request.
- **Change password → all sessions die** (the session signing secret is rotated).
- **Abuse prevention:** login 10/5 min/IP, setup 5/5 min/IP, per-project write window (default
  60/min), record cap 5,000/project, record cap 2 MB, file cap 20 MB, 2,000 files/project.
- **Uploads** are validated by extension **and** MIME; `.sh`-style executables are rejected, SVGs are
  served with `Content-Disposition: attachment` + `CSP: sandbox`.
- **Deletion** requires typing the project name; storage purge is a second explicit choice.

### Known limits (by design, documented rather than hidden)

1. KV has no atomic increment, so the rate limiter is best-effort under heavy parallel load.
2. Sessions are stateless — "sign out all devices" happens on password change, not on demand.
3. KV is eventually consistent (≤60 s across edges); the dashboard re-reads with `consistency: 'strong'`
   where available, but a freshly written record may take a moment to appear elsewhere.
4. The mock backend stores data in `localStorage`, which is per-browser and not encrypted — it exists
   only so the UI is explorable before deployment.

---

## 8. Development notes

- No UI framework, no icon fonts, no CDN — the whole bundle is ~143 KB JS / ~38 KB CSS (gzipped ~38/8 KB)
  and renders offline.
- Design system lives in `src/styles/main.css` (tokens + components), `dashboard.css` (page layouts)
  and `responsive.css` (mobile). **Import order matters:** responsive last.
- `src/pages/*` receive a `ctx` object: `{ params, projects, preview, email, navigate, setHeader,
  renderContent, refreshProjects }`.
- Adding an endpoint: add the route row in `server/app.js` `ROUTES`, then the handler; add the
  permission to `POLICY` in `server/permission-manager.js` if a non-admin scope needs it.

## 9. Verify against the live EdgeOne docs

KV/Blob quotas and SDK surface change over time. Before going live, confirm:
KV `get/put/delete/list` semantics, the 25 MB per-value ceiling, Blob `set/get/delete/list` +
`createUploadUrl`, and the KV-binding UI path in your console.
