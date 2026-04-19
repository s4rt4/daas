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

This keeps the MVP simple and fast to iterate. For multi-user or production use, the next hardening steps are:

- Add safer concurrent write handling.
- Add automatic zip backups including uploads.
- Add authentication.
- Add tests around import/export and publish flows.
- Add a database layer when collaboration becomes necessary.

## Scripts

```bash
npm start
npm run dev
```

Both scripts currently run `node server.js`.

## License

MIT License. See [LICENSE](./LICENSE).
