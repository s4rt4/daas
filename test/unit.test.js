"use strict";

// Unit tests for the pure logic in server.js: slug/tag normalization, markdown
// import/export round-tripping, ordering, broken-link detection, scheduled
// publishing and the atomic-write/recovery data layer. Uses only Node's built-in
// test runner so the project stays dependency-free.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate all file-system side effects in a throwaway dir before requiring the
// server module (it calls ensureFileSystem() at load time).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "daas-unit-"));
process.env.DAAS_DATA_DIR = TMP_DIR;

const app = require("../server.js");

test.after(() => {
  try {
    app.server.close();
  } catch {}
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
});

test("slugify lowercases, strips punctuation and joins words with dashes", () => {
  assert.equal(app.slugify("Hello World!"), "hello-world");
  assert.equal(app.slugify("  Multiple   Spaces  "), "multiple-spaces");
  assert.equal(app.slugify("Café & Crème"), "caf-crme");
});

test("normalizeTags dedupes, slugifies and caps at 12", () => {
  assert.deepEqual(app.normalizeTags("API, api, Getting Started"), ["api", "getting-started"]);
  assert.deepEqual(app.normalizeTags(["#one", "two!!", "two"]), ["one", "two"]);
  const many = app.normalizeTags(Array.from({ length: 20 }, (_, i) => `tag${i}`));
  assert.equal(many.length, 12);
});

test("normalizePageInput sanitizes slug and trims fields", () => {
  const out = app.normalizePageInput({
    slug: "My New Page!!",
    title: "  Title  ",
    section: "  ",
    tags: "a, b",
    content: "# Hi",
  });
  assert.equal(out.slug, "my-new-page");
  assert.equal(out.title, "Title");
  assert.equal(out.section, "General");
  assert.deepEqual(out.tags, ["a", "b"]);
  assert.equal(out.content, "# Hi");
});

test("parseFrontMatter parses JSON values and falls back to bare strings", () => {
  const meta = app.parseFrontMatter(
    [
      'title: "Hello"',
      "order: 3",
      "pinned: true",
      'tags: ["a","b"]',
      "section: Guides",
    ].join("\n")
  );
  assert.equal(meta.title, "Hello");
  assert.equal(meta.order, 3);
  assert.equal(meta.pinned, true);
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.equal(meta.section, "Guides");
});

test("markdown archive export -> import round-trips page metadata and content", () => {
  const docs = {
    project: {},
    sections: ["Guides"],
    pages: [
      {
        slug: "alpha",
        title: "Alpha",
        section: "Guides",
        parentSlug: "",
        description: "First page",
        tags: ["intro"],
        version: "latest",
        status: "published",
        order: 0,
        draftContent: "# Alpha\n\nBody of alpha.",
        publishedContent: "# Alpha\n\nBody of alpha.",
      },
      {
        slug: "beta",
        title: "Beta",
        section: "Guides",
        parentSlug: "alpha",
        description: "Second page",
        tags: [],
        version: "latest",
        status: "draft",
        order: 1,
        draftContent: "# Beta\n\nBody of beta with a [link](/docs/alpha).",
        publishedContent: "",
      },
    ],
  };

  const archive = app.exportMarkdownArchive(docs);
  const imported = app.parseMarkdownImport(archive);

  assert.equal(imported.length, 2);
  const [alpha, beta] = imported;
  assert.equal(alpha.slug, "alpha");
  assert.equal(alpha.title, "Alpha");
  assert.equal(alpha.section, "Guides");
  assert.equal(alpha.status, "published");
  assert.match(alpha.content, /Body of alpha/);
  assert.equal(beta.slug, "beta");
  assert.equal(beta.parentSlug, "alpha");
  assert.deepEqual(beta.tags, []);
  assert.match(beta.content, /\[link\]\(\/docs\/alpha\)/);
});

test("parseMarkdownImport handles a single plain markdown page", () => {
  const pages = app.parseMarkdownImport("# Lone Page\n\nSome text.");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, "Lone Page");
  assert.equal(pages[0].slug, "lone-page");
  assert.equal(pages[0].status, "draft");
});

test("makeUniqueSlug appends an incrementing suffix on collisions", () => {
  const pages = [{ slug: "intro" }, { slug: "intro-2" }];
  assert.equal(app.makeUniqueSlug("intro", pages), "intro-3");
  assert.equal(app.makeUniqueSlug("fresh", pages), "fresh");
});

test("normalizePageOrders keeps children directly after their parent", () => {
  const pages = [
    { slug: "child", title: "Child", section: "Guides", parentSlug: "root", order: 5 },
    { slug: "root", title: "Root", section: "Guides", parentSlug: "", order: 1 },
    { slug: "second", title: "Second", section: "Guides", parentSlug: "", order: 2 },
  ];
  const ordered = app.normalizePageOrders(pages).map((p) => p.slug);
  assert.deepEqual(ordered, ["root", "child", "second"]);
});

test("checkBrokenLinks flags missing and unpublished internal links", () => {
  const docs = {
    project: {},
    sections: ["General"],
    pages: [
      {
        slug: "home",
        title: "Home",
        section: "General",
        status: "published",
        order: 0,
        draftContent: "[ok](/docs/home) [gone](/docs/missing) [draft](/docs/hidden)",
        publishedContent: "[ok](/docs/home)",
      },
      {
        slug: "hidden",
        title: "Hidden",
        section: "General",
        status: "draft",
        order: 1,
        draftContent: "",
        publishedContent: "",
      },
    ],
  };
  const issues = app.checkBrokenLinks(docs);
  const byHref = Object.fromEntries(issues.map((i) => [i.href, i.issue]));
  assert.equal(byHref["/docs/missing"], "Missing internal page");
  assert.equal(byHref["/docs/hidden"], "Internal page is not published");
  assert.equal(byHref["/docs/home"], undefined);
});

test("estimateReadingTime returns at least one minute", () => {
  assert.equal(app.estimateReadingTime(""), 1);
  assert.equal(app.estimateReadingTime("word ".repeat(50)), 1);
  assert.equal(app.estimateReadingTime("word ".repeat(450)), 3);
});

test("runScheduledPublishes publishes due drafts and clears the schedule", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const docs = {
    project: {},
    sections: ["General"],
    pages: [
      {
        slug: "due",
        title: "Due",
        section: "General",
        status: "draft",
        order: 0,
        scheduledAt: past,
        draftContent: "# Due\n\nReady to ship.",
        publishedContent: "",
      },
      {
        slug: "later",
        title: "Later",
        section: "General",
        status: "draft",
        order: 1,
        scheduledAt: future,
        draftContent: "# Later",
        publishedContent: "",
      },
    ],
  };
  app.writeDocs(docs);
  app.runScheduledPublishes();
  const after = app.readDocs();
  const due = after.pages.find((p) => p.slug === "due");
  const later = after.pages.find((p) => p.slug === "later");
  assert.equal(due.status, "published");
  assert.equal(due.scheduledAt, "");
  assert.match(due.publishedContent, /Ready to ship/);
  assert.equal(later.status, "draft");
  assert.equal(later.scheduledAt, future);
});

test("writeDocs writes atomically and creates a backup of the prior version", () => {
  const v1 = { project: {}, sections: ["General"], pages: [], marker: "v1" };
  const v2 = { project: {}, sections: ["General"], pages: [], marker: "v2" };
  app.writeDocs(v1);
  app.writeDocs(v2);
  const current = JSON.parse(fs.readFileSync(app.paths.DATA_FILE, "utf8"));
  const backup = JSON.parse(fs.readFileSync(app.paths.BACKUP_FILE, "utf8"));
  assert.equal(current.marker, "v2");
  assert.equal(backup.marker, "v1");
  // No stray temp files left behind after the atomic rename.
  const strays = fs.readdirSync(app.paths.DATA_DIR).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(strays, []);
});

test("writeAutoBackup writes an archive and skips when content is unchanged", () => {
  app.writeDocs({ project: {}, sections: ["General"], pages: [] });
  const first = app.writeAutoBackup();
  assert.ok(first, "first backup should be written");
  assert.match(first.filename, /^daas-v3-backup-.*\.zip$/);
  assert.ok(fs.existsSync(path.join(app.paths.BACKUP_DIR, first.filename)));

  // Nothing changed -> dedup returns null and writes no new file.
  const second = app.writeAutoBackup();
  assert.equal(second, null);

  // A real, migration-surviving change (an added page) triggers a new backup.
  app.writeDocs({
    project: {},
    sections: ["General"],
    pages: [
      { slug: "p1", title: "P1", section: "General", status: "draft", order: 0, draftContent: "# P1", publishedContent: "" },
    ],
  });
  const third = app.writeAutoBackup();
  assert.ok(third);
  assert.ok(app.listBackups().length >= 2);
});

test("pruneBackups keeps only the requested number of newest archives", () => {
  // Force several archives, then prune to two.
  for (let i = 0; i < 4; i += 1) {
    app.writeAutoBackup({ force: true });
  }
  assert.ok(app.listBackups().length >= 4);
  app.pruneBackups(2);
  assert.equal(app.listBackups().length, 2);
});

test("readDocs recovers from a corrupt docs.json using the backup", () => {
  const good = {
    project: {},
    sections: ["General"],
    pages: [
      { slug: "recover-me", title: "Recover Me", section: "General", status: "draft", order: 0, draftContent: "# R", publishedContent: "" },
    ],
  };
  // Write twice so the backup snapshot also holds the good version (the backup is
  // always the *previous* write), making this independent of earlier tests.
  app.writeDocs(good);
  app.writeDocs(good);
  // Corrupt the main file; the good copy lives in the backup.
  fs.writeFileSync(app.paths.DATA_FILE, "{ this is not json");
  const recovered = app.readDocs();
  assert.ok(recovered.pages.some((p) => p.slug === "recover-me"));
  // The repaired main file is valid JSON again.
  const repaired = JSON.parse(fs.readFileSync(app.paths.DATA_FILE, "utf8"));
  assert.ok(Array.isArray(repaired.pages));
});
