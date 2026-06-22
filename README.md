# DaaS V3

DaaS V3 is a local-first documentation builder for teams that want to write, preview, publish, and maintain docs without setting up auth, billing, deployment pipelines, or a database on day one.

It runs on localhost, stores content in a local JSON file, and ships with a public docs renderer plus a rich editor dashboard.

## Highlights

- Local-first docs builder that runs on `localhost`.
- Rich text / Markdown editor powered by Toast UI, vendored locally for offline use.
- Draft and published content flow.
- Public docs renderer at `/docs/:slug`.
- Sidebar sections, parent/child pages, and manual ordering.
- SEO metadata per page: meta title, description, canonical URL, version.
- Markdown import/export for backups and portability.
- Public docs search.
- Broken link checker for internal docs links and uploaded assets.
- Slug safety with previous slug redirects.
- Lightweight versioning.
- Media library for uploaded images.
- Page health checks.
- Draft vs published diff.
- Command palette with `Ctrl + K`.
- Templates for API pages, guides, FAQ, troubleshooting, changelog, and overview pages.
- Project settings and redirect manager.

## Quick Start

Requirements:

- Node.js 18 or newer.
- Windows users can use the included `.bat` helpers.

Run with npm:

```bash
npm start
```

Or run directly:

```bash
node server.js
```

On Windows, you can also run:

```powershell
.\run-local.bat
```

Then open:

- Editor: [http://localhost:3017/app](http://localhost:3017/app)
- Public docs: [http://localhost:3017](http://localhost:3017)

If port `3017` is already in use, set `PORT` before running:

```powershell
$env:PORT=3020
node server.js
```

## Project Structure

```text
daas-v3/
├─ data/
│  └─ docs.json              # Local docs database
├─ public/
│  ├─ app.js                 # Editor dashboard logic
│  ├─ style.css              # App and docs styling
│  ├─ docs-search.js         # Public docs search
│  ├─ assets/                # App icons
│  ├─ uploads/               # Uploaded images
│  └─ vendor/toastui/        # Offline Toast UI editor assets
├─ server.js                 # Local HTTP server and API routes
├─ run-local.bat             # Windows launcher
├─ stop-local.bat            # Windows port stopper helper
└─ package.json
```

## Data Model

All page data lives in `data/docs.json`. Each page can contain:

- `slug`
- `title`
- `section`
- `parentSlug`
- `description`
- `metaTitle`
- `metaDescription`
- `canonicalUrl`
- `version`
- `previousSlugs`
- `draftContent`
- `publishedContent`
- `status`
- `order`
- `history`

Because this is local-first, you should back up `data/docs.json` and `public/uploads/` if you care about preserving both text and images.

## Markdown Export / Import

The editor can export all docs as a Markdown archive. The export includes page frontmatter so it can be imported back into DaaS V3 later.

Current export fields include:

- slug
- title
- section
- parent slug
- description
- SEO metadata
- version
- order
- previous slugs
- status

Note: uploaded images are referenced by path. If you move the Markdown archive to another machine, also copy `public/uploads/`.

## Offline Editor

Toast UI Editor is vendored under:

```text
public/vendor/toastui/
```

The app does not need the Toast UI CDN at runtime. If the editor fails to load, restart the local server and hard refresh the browser.

## Local-First Notes

DaaS V3 intentionally avoids external infrastructure for now:

- No database server.
- No auth.
- No payment gateway.
- No hosted deployment pipeline.

This keeps the MVP simple and fast to iterate.

Recent hardening:

- **Crash-safe writes.** `docs.json` and `audit.json` are written atomically (temp file + `fsync` + rename), so a crash mid-write can never leave a half-written, corrupt database.
- **Automatic recovery.** Before each save, the current `docs.json` is snapshotted to `docs.json.bak`. If the main file is ever unreadable, it is restored from the backup on the next read (the bad file is kept aside as `docs.json.corrupt.<timestamp>`) instead of failing every request.
- **Validation errors return 4xx.** Bad input (unknown section, invalid parent, slug collision, malformed JSON) now returns a JSON `400`/`409` instead of an HTML `500`, and unexpected errors no longer leak stack traces to clients.
- **Request limits.** JSON request bodies are capped at 5 MB and uploads at 10 MB (returning `413` instead of growing memory unbounded). Uploaded files are restricted to image types (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`); anything else is rejected with `400`.

- **Automatic backups.** A full zip backup (`docs.json` + Markdown export + everything in `public/uploads/`) is written to `data/backups/` on startup and every 6 hours. Identical content is not re-archived, and only the newest backups are kept.

For multi-user or production use, the remaining hardening steps are:

- Add authentication.
- Add a database layer when collaboration becomes necessary.

### Backups

| What | Where |
| --- | --- |
| Automatic, rotated zip backups | `data/backups/` |
| Crash-recovery snapshot of `docs.json` | `data/docs.json.bak` |
| On-demand download | "Export ZIP" in the editor, or `GET /api/export/zip` |

Backup behavior is configurable via environment variables:

- `DAAS_BACKUP_INTERVAL_MS` — milliseconds between automatic backups (default `21600000` = 6h; set `0` to disable).
- `DAAS_BACKUP_KEEP` — number of automatic backups to retain (default `10`).
- `DAAS_BACKUP_DIR` — override where automatic backups are stored.

You can also trigger a backup on demand with `POST /api/backups/run` and list existing ones with `GET /api/backups`.

## Testing

Tests use Node's built-in test runner — no extra dependencies.

```bash
npm test
```

- `test/unit.test.js` covers the pure logic: slug/tag normalization, Markdown export/import round-trips, page ordering, broken-link detection, scheduled publishing, and the atomic-write / backup-recovery data layer.
- `test/integration.test.js` boots the real HTTP server on an ephemeral port against an isolated data directory and exercises the create → save → publish → export → delete lifecycle.

Tests are isolated via the `DAAS_DATA_DIR` environment variable, which overrides where `docs.json` and `audit.json` live. Set it to run the app against a scratch data directory:

```powershell
$env:DAAS_DATA_DIR="C:\tmp\daas-data"
node server.js
```

## Scripts

```bash
npm start
npm run dev
```

Both scripts currently run `node server.js`.

## License

MIT License. See [LICENSE](./LICENSE).
