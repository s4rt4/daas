"use strict";

// Integration tests: boot the real HTTP server on an ephemeral port against an
// isolated data dir and exercise the create -> save -> publish -> export -> delete
// flow over the wire. Verifies the routes and the data layer behave together.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daas-int-"));
process.env.DAAS_DATA_DIR = TMP_DIR;

const app = require("../server.js");
const { server } = app;

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server.close();
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
});

async function api(method, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text };
}

test("GET /api/pages returns the seeded starter pages", async () => {
  const res = await api("GET", "/api/pages");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.pages));
  assert.ok(res.json.pages.length >= 1);
});

test("create -> save -> publish -> export -> delete lifecycle", async () => {
  // Create / save a new page.
  const create = await api("POST", "/api/page", {
    slug: "integration-page",
    title: "Integration Page",
    section: "Basics",
    content: "# Integration Page\n\nHello from the test.",
  });
  assert.equal(create.status, 200, create.text);

  // It exists and is not yet published.
  const fetched = await api("GET", "/api/page?slug=integration-page");
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.title, "Integration Page");
  assert.notEqual(fetched.json.status, "published");

  // Publish it.
  const published = await api("POST", "/api/page/publish", { slug: "integration-page" });
  assert.equal(published.status, 200, published.text);
  assert.equal(published.json.page.status, "published");

  // Public route now renders it.
  const docPage = await fetch(`${baseUrl}/docs/integration-page`);
  assert.equal(docPage.status, 200);
  const html = await docPage.text();
  assert.match(html, /Integration Page/);

  // Markdown export includes the page and round-trips its slug.
  const exported = await fetch(`${baseUrl}/api/export/markdown`);
  assert.equal(exported.status, 200);
  const archive = await exported.text();
  assert.match(archive, /slug: "integration-page"/);

  // Delete it.
  const deleted = await api("POST", "/api/page/delete", { slug: "integration-page" });
  assert.equal(deleted.status, 200, deleted.text);

  // It's gone.
  const gone = await api("GET", "/api/page?slug=integration-page");
  assert.equal(gone.status, 404);
});

test("renaming a page onto an existing slug is rejected with 409", async () => {
  await api("POST", "/api/page", { slug: "dup-a", title: "Dup A", section: "Basics", content: "# A" });
  await api("POST", "/api/page", { slug: "dup-b", title: "Dup B", section: "Basics", content: "# B" });
  // Rename dup-b to dup-a (originalSlug identifies the page being edited).
  const collision = await api("POST", "/api/page", {
    originalSlug: "dup-b",
    slug: "dup-a",
    title: "Dup B",
    section: "Basics",
    content: "# B",
  });
  assert.equal(collision.status, 409);
  assert.match(collision.json.error, /exists/i);
});

test("posting a page to a non-existent section returns 400 JSON, not 500", async () => {
  const res = await api("POST", "/api/page", {
    slug: "no-section",
    title: "No Section",
    section: "Does Not Exist",
    content: "# x",
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /section/i);
});

test("upload accepts an allowed image type", async () => {
  // 1x1 transparent PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
  const res = await fetch(`${baseUrl}/api/assets/upload`, { method: "POST", body: form });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.asset.url, /\/public\/uploads\/.*pixel\.png$/);
  // Uploads live in the shared public/uploads dir (not isolated by DAAS_DATA_DIR),
  // so clean up the file this test created.
  try {
    fs.rmSync(path.join(app.paths.UPLOADS_DIR, json.asset.filename));
  } catch {}
});

test("upload rejects a disallowed file type with 400", async () => {
  const form = new FormData();
  form.append("file", new Blob(["#!/bin/sh\necho hi"], { type: "text/plain" }), "script.sh");
  const res = await fetch(`${baseUrl}/api/assets/upload`, { method: "POST", body: form });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.match(json.error, /Unsupported file type/i);
});

test("oversized JSON body is rejected with 413 (via Content-Length)", async () => {
  const huge = "x".repeat(6 * 1024 * 1024); // 6 MB > 5 MB cap
  const res = await api("POST", "/api/page", { slug: "big", title: huge, section: "Basics", content: huge });
  assert.equal(res.status, 413);
  assert.match(res.json.error, /too large/i);
});

test("malformed JSON body is rejected with 400", async () => {
  const res = await fetch(`${baseUrl}/api/page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
  assert.equal(res.status, 400);
});

test("POST /api/backups/run creates a backup and GET lists it", async () => {
  const run = await api("POST", "/api/backups/run");
  assert.equal(run.status, 200, run.text);
  assert.ok(run.json.backup);
  assert.match(run.json.backup.filename, /^daas-v3-backup-.*\.zip$/);

  const list = await api("GET", "/api/backups");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.backups));
  assert.ok(list.json.backups.some((b) => b.filename === run.json.backup.filename));
});

test("static asset traversal outside /public is blocked", async () => {
  // Percent-encoded so fetch does not normalize the traversal away before sending.
  const res = await fetch(`${baseUrl}/public/%2e%2e/server.js`);
  assert.equal(res.status, 404);
});
