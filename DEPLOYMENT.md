# Deployment checklist — EdgeOne Pages

Step-by-step, in order. Everything here has already been verified locally by
`npm test` (73 checks) and `npm run test:browser` (37 checks).

---

## 0. Before you start

| Requirement | Notes |
|---|---|
| EdgeOne Pages account | KV must be enabled for your account (some regions require it to be turned on) |
| Node ≥ 18 locally | only for building/testing, the runtime is EdgeOne's |
| A git repo | EdgeOne deploys from Git (GitHub/GitLab) or from the CLI |

---

## 1. Build locally first

```bash
npm install
npm run verify          # 55 API checks + 18 function-entry checks + production build
npm run test:browser    # 37 browser checks (needs `npm run dev` in another terminal)
```

Everything must be green before you deploy — these are the same assertions that guard the permission
model.

---

## 2. Push and create the Pages project

```bash
git init && git add . && git commit -m "EdgeOne personal storage server"
git remote add origin <your-repo-url>
git push -u origin main
```

EdgeOne console → **Pages → Create project → Import Git repository**.

| Setting | Value |
|---|---|
| Framework preset | `Other` / static |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20.18.0` |
| Functions directory | `functions` (default — do not change) |

`edgeone.json` already declares the build command, output directory and the SPA redirects, so the
console should pick these up automatically.

---

## 3. Create the KV namespace (required for persistence)

1. Console → **Storage → KV → Create namespace** (name it e.g. `storage-server-kv`).
2. Project → **Settings → Bindings → KV namespace → Add**.
3. Variable name: **`STORAGE_KV`** (exact — the code looks for this first, then `STORAGE`, `KV`,
   `MY_KV`, `STORAGE_KV_NAMESPACE` as fallbacks).
4. Redeploy.

**How to confirm it worked:** open `https://<your-domain>/api/health` and check:

```json
{
  "ok": true,
  "data": {
    "runtime": "edgeone",
    "kvBackend": "STORAGE_KV (bound)",
    "kvBackendKind": "kv",
    "persistent": true
  }
}
```

If you see `"STORAGE_KV (unbound)"` and `"persistent": false`, the binding is missing — writes will be
lost when the isolate recycles. Fix the binding, don't work around it.

---

## 4. Blob storage

Nothing to do. `getStore("storage-server")` creates the namespace on first write. To rename it, set the
environment variable `BLOB_STORE_NAME` and redeploy.

Verify: `blobBackend` in `/api/health` should be `blob (bound)` once a function has initialised the SDK.
Inside EdgeOne the SDK authenticates itself through the deploy credential; outside it (your laptop) it
logs `deployCredential` errors — that is expected and harmless.

---

## 5. Environment variables

Project → **Settings → Environment variables**:

| Name | Value | Why |
|---|---|---|
| `ADMIN_SETUP_KEY` | a long random string (**set this**) | Without it, the first visitor to hit `/api/auth/setup` becomes the admin. With it, setup requires `X-Setup-Key`. |
| `ADMIN_EMAIL` | `you@example.com` | pre-fills the setup form |
| `BLOB_STORE_NAME` | optional, default `storage-server` | Blob namespace |

Generate the setup key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 6. First-run setup

1. Open the dashboard URL. With no admin in KV, you get **Set up your server**.
2. Enter the admin email + a password ≥ 10 characters.
3. If `ADMIN_SETUP_KEY` is set, paste it in the setup-key field.
4. You land on an empty dashboard.

> Setup is single-use: the second call returns `409 already_initialised`.
> **There is no password reset.** If you lose it, delete `ss_admin_v1` in the KV console and reload.
> Change the password from **Settings → Authentication** instead of re-running setup.

---

## 7. Create your two projects

Dashboard → **New project** (twice — the cap is hard-enforced at 2).

Each project gives you:

- a project id like `prj_9f3k2m1x0q`
- a **User Panel Config** — `etu1.…`, write-only, safe in a public frontend
- an **Admin Panel Config** — `adm_…`, full access inside that project, **server-side only**

Copy them from the "Project created" sheet (the token is also re-viewable in
Project → Connection, and you can download a `.env` or a JS client helper there).

---

## 8. Wire up an external project

In the external site (server-side if it needs admin access, browser if it only writes):

```bash
curl -X POST https://<your-domain>/api/data \
  -H "Authorization: Bearer $STORAGE_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"prj_xxxxxxxx","type":"json","kind":"contact","key":"contact-form",
       "content":{"name":"Aarav","email":"aarav@example.com"}}'
```

From a browser you must use `fetch` (the endpoint sends CORS headers and allows `Authorization`):

```js
await fetch("https://<your-domain>/api/data", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${import.meta.env.VITE_STORAGE_USER_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    projectId: "prj_xxxxxxxx",
    type: "json",
    kind: "contact",
    key: "contact-form",
    content: { name: "Aarav", email: "aarav@example.com" },
  }),
});
```

Then confirm the record appears in the dashboard **Storage → Records**.

---

## 9. Acceptance tests on the live deployment

Run these once against production. They are the highest-value checks.

| # | Test | Expected |
|---|---|---|
| 1 | `GET /api/health` | `runtime: edgeone`, `kvBackend: STORAGE_KV (bound)`, `persistent: true` |
| 2 | User token → `GET /api/data?projectId=…` | `403 forbidden` |
| 3 | User token → `GET /api/data/<id>` | `403` |
| 4 | User token → `PUT /api/data/<id>` | `403` |
| 5 | User token → `DELETE /api/data/<id>` | `403` |
| 6 | User token → `POST /api/data` | `200`, returns `{ id, key, type, createdAt }` only |
| 7 | Project A admin secret → `projectId=<B>` | `403` |
| 8 | Project A admin secret → `GET /api/projects` | `403` |
| 9 | Create a 3rd project | `409 project_limit` |
| 10 | Delete a project with a wrong `confirmName` | `422 confirm_mismatch` |
| 11 | Rotate the user token, then reuse the old one | `403` |
| 12 | Upload `evil.sh` | `415 unsupported_file` |
| 13 | Upload a 25 MB file | `415` / `413` |
| 14 | 61 writes in one minute with a user token | the 61st returns `429 rate_limited` |
| 15 | Pause the project, then write | `403 Project is paused` |
| 16 | Upload a file, reload the page, download it | bytes match |
| 17 | Create a record, wait 60 s, reload from a different device/network | record still there (KV persistence) |

A quick scripted pass for the read/write matrix:

```bash
BASE=https://<your-domain>
UT=<user token>
AS=<admin secret>
PRJ=<project id>

for path in "GET /data?projectId=$PRJ" "GET /data/rec_x?projectId=$PRJ" "PUT /data/rec_x?projectId=$PRJ" "DELETE /data/rec_x?projectId=$PRJ"; do
  method=${path%% *}; rest=${path#* }
  printf "%-6s %-28s -> " "$method" "$rest"
  curl -s -o /dev/null -w "%{http_code}\n" -X "$method" "$BASE/api$rest" -H "Authorization: Bearer $UT"
done
# expected: 403 403 403 403
```

---

## 10. Operational notes

**Backups.** KV has no export button, but the API does: `GET /api/export?projectId=…` as the dashboard
admin returns every record plus file metadata as JSON. Run it weekly:

```bash
curl -s "$BASE/api/export?projectId=$PRJ" -H "Authorization: Bearer $SESSION" > backup-$PRJ.json
```

**Rotating credentials.** Project → Connection → *Rotate*. The moment you rotate, the old credential
returns 403 — update the external project in the same window, or take a brief outage.

**Deleting a project.** Two confirmations: *Continue* → *Delete project + data / Keep my data* → type
the project name. If you choose "Keep my data", the records/files become **orphaned** and can be
inspected and purged later from **Settings → Maintenance → Scan**.

**What breaks if KV is unbound.** Setup, login and projects appear to work, then vanish on the next
cold start, because data lives in a per-isolate memory map. `/api/health` is the tell — check it after
every deployment.

**Free-tier ceilings.** EdgeOne KV: 25 MB per value. Blob: 25 MB per object on the free edition
(512 MB on professional). The server caps records at 2 MB and files at 20 MB, which keeps you well
inside both and stops a single upload from blowing the namespace quota.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `kvBackend: "STORAGE_KV (unbound)"` | namespace not bound / wrong variable name | bind as `STORAGE_KV`, redeploy |
| Dashboard loads but every call 404s | functions directory not deployed | project settings → functions directory `functions` |
| `Cannot access 'x' before initialization` | stale bundle | hard-refresh / clear build cache and redeploy |
| Setup returns 409 | admin already exists | sign in, or delete `ss_admin_v1` in KV |
| Blob errors containing `deployCredential` | SDK running outside EdgeOne | expected locally; on EdgeOne it means Blob isn't enabled for the project |
| Records disappear after redeploy | KV unbound (see above) | bind KV |
| Preview shows "Demo" banner in production | `/api/health` did not return JSON | check the functions route; the dashboard needs it to switch to live mode |
