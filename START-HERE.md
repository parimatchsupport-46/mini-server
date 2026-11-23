# Storage Server — start here

A personal multi-project storage server for **EdgeOne Pages**. Two projects max, each with its own
namespace and two separate connection configs (write-only public credential + server-side admin
secret). TXT/JSON in KV, files in Blob, iOS-inspired dashboard.

**Status: built, tested, deployable.** 110 automated checks pass (see §3).

---

## 1. See it running

The dev server is live in the preview panel. If you need to restart it:

```bash
cd edgeone-storage-server
npm install
npm run dev          # http://localhost:5173
```

**Demo login** (mock backend — data lives in your browser's localStorage):

```
owner@storage.local
preview-admin-123
```

Nothing is seeded? Clear the `ss.preview.v1:*` keys in localStorage and reload — two projects with
records, files and activity come back.

---

## 2. What's where

| File | What it's for |
|---|---|
| **`README.md`** | full documentation: architecture, credential matrix, API, data model, security notes |
| **`DEPLOYMENT.md`** | step-by-step EdgeOne deployment + a 17-test live acceptance checklist |
| `edgeone.json` | build config (build cmd, output dir, SPA redirects) |
| `functions/api/*` | EdgeOne Pages Functions — thin entrypoints into one router |
| `server/*` | backend logic (auth, permissions, KV/Blob managers, rate limits) |
| `src/*` | dashboard (vanilla JS modules, no framework) |
| `scripts/*` | the three test suites |
| `screenshots/*` | captured UI states |

---

## 3. Test it

```bash
npm test              # 55 API/security checks + 18 EdgeOne entrypoint checks
npm run test:browser  # 37 browser E2E checks (needs `npm run dev` running)
npm run verify        # both + production build
```

What `npm test` actually proves (these are the assertions that matter):

- The **user credential cannot read, list, update or delete** anything — every attempt returns 403.
- It cannot pick its own record id, and cannot write into the other project.
- The **admin secret is confined to its own project** — cross-project reads return 403.
- A **3rd project is rejected** with `409 project_limit`.
- **Rotating a credential kills the old one instantly.**
- Deleting a project needs the **exact typed name**, and purging data is a separate decision.
- `.sh` uploads and >20 MB uploads are rejected; a 25 MB file never reaches Blob.
- The real `functions/api/*.js` entrypoints load and dispatch, with CORS preflight working.

---

## 4. Deploy

Short version — full detail in `DEPLOYMENT.md`:

1. Push the repo, import it in EdgeOne Pages (`npm run build` → `dist`).
2. **Create a KV namespace and bind it as `STORAGE_KV`.** Without this, writes do not persist.
3. Set `ADMIN_SETUP_KEY` so the first visitor can't claim your server.
4. Blob needs nothing — `storage-server` is auto-created.
5. Open `/api/health` — it must say `"kvBackend": "STORAGE_KV (bound)"` and `"persistent": true`.
6. Finish first-run setup, then create your two projects and copy both configs.

---

## 5. The permission model in one table

| | Dashboard session `das_…` | Admin secret `adm_…` | User token `etu1.…` |
|---|---|---|---|
| Where it lives | this browser | external project **server** | external project **browser** |
| Create records | ✅ | ✅ | ✅ |
| Upload files | ✅ | ✅ | ✅ |
| Read / list records | ✅ | ✅ own project | ❌ 403 |
| Update / delete | ✅ | ✅ own project | ❌ 403 |
| Other project's data | ✅ | ❌ 403 | ❌ 403 |
| Create / delete projects | ✅ | ❌ 403 | ❌ 403 |

The user token is *publishable by design* — it is a signed capability token whose policy contains
exactly `data.create`, `files.upload`, `project.read`, `config.read`. It is re-verified on every single
request (signature → rotation id → project status → ownership → action).

---

## 6. Honest caveats

- **The mock backend is not a backend.** In `npm run dev` everything is stored in your browser's
  localStorage so you can explore the UI. Real persistence starts after you deploy with KV bound.
- **KV is eventually consistent** (up to ~60 s across edges). The dashboard requests strong
  consistency where the SDK allows it, but a just-written record may take a moment elsewhere.
- **Rate limiting is best-effort.** KV has no atomic increment, so under heavy parallel load a few
  extra writes can slip through a fixed window. Fine for a personal server, not a hard quota.
- **No password reset.** Only a password *change* from Settings. Lose it and you must delete
  `ss_admin_v1` from the KV console to re-run setup.
- **Verify quotas before launch.** EdgeOne changes limits; confirm KV's 25 MB/value and Blob's
  25 MB/object (free) on your account. The server caps records at 2 MB and files at 20 MB regardless.
- **`createUploadUrl` (client-direct uploads)** is wired up defensively — if the runtime doesn't expose
  it, the endpoint reports `supported: false` and multipart upload keeps working. Multipart is the
  tested default.
