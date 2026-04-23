const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3017;
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_FILE = path.join(DATA_DIR, "docs.json");
const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

ensureFileSystem();

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  try {
    if (pathname.startsWith("/public/")) {
      return serveStatic(pathname, res);
    }

    if (req.method === "GET" && pathname === "/") {
      const docs = readDocs();
      const firstPage = getPublishedPages(docs)[0];
      redirect(res, firstPage ? `/docs/${firstPage.slug}` : "/app");
      return;
    }

    if (req.method === "GET" && pathname === "/app") {
      return sendHtml(res, renderAppShell());
    }

    if (req.method === "GET" && pathname === "/api/pages") {
      const docs = readDocs();
      return sendJson(res, {
        project: docs.project,
        versions: docs.versions || ["latest"],
        sections: docs.sections || [],
        pages: docs.pages.map((page) => ({
          slug: page.slug,
          title: page.title,
          section: page.section || "General",
          parentSlug: page.parentSlug || "",
          description: page.description || "",
          searchText: summarizeSearchText(page.draftContent || page.publishedContent || ""),
          updatedAt: page.updatedAt,
          order: page.order || 0,
          status: page.status || "draft",
          pinned: Boolean(page.pinned),
          publishedAt: page.publishedAt || null,
        })),
      });
    }

    if (req.method === "GET" && pathname === "/api/page") {
      const slug = parsedUrl.searchParams.get("slug");
      const docs = readDocs();
      const page = docs.pages.find((item) => item.slug === slug);

      if (!page) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      return sendJson(res, {
        ...page,
        content: page.draftContent || "",
        parentSlug: page.parentSlug || "",
      });
    }

    if (req.method === "POST" && pathname === "/api/page") {
      const payload = await readBody(req);
      const docs = readDocs();
      const normalized = normalizePageInput(payload);
      const originalSlug = String(payload.originalSlug || "").trim();
      const existingIndex = docs.pages.findIndex((item) => item.slug === (originalSlug || normalized.slug));
      const existingPage = existingIndex >= 0 ? docs.pages[existingIndex] : null;
      const slugCollision = docs.pages.some((item, index) => item.slug === normalized.slug && index !== existingIndex);
      if (slugCollision) {
        return sendJson(res, { error: "Slug already exists" }, 409);
      }
      validateSectionExists(docs.sections || [], normalized.section);
      validateParentAssignment(docs.pages, normalized, existingPage);
      const now = new Date().toISOString();
      const previousSlugs = mergePreviousSlugs(existingPage, normalized.slug);

      const page = {
        slug: normalized.slug,
        title: normalized.title,
        section: normalized.section,
        parentSlug: normalized.parentSlug,
        description: normalized.description,
        metaTitle: normalized.metaTitle,
        metaDescription: normalized.metaDescription,
        canonicalUrl: normalized.canonicalUrl,
        version: normalized.version,
        previousSlugs,
        draftContent: normalized.content,
        publishedContent: existingPage ? existingPage.publishedContent || "" : "",
        updatedAt: now,
        publishedAt: existingPage ? existingPage.publishedAt || null : null,
        status: existingPage ? existingPage.status || "draft" : "draft",
        pinned: existingPage ? Boolean(existingPage.pinned) : false,
        order: existingIndex >= 0 ? existingPage.order || existingIndex : docs.pages.length,
        history: existingPage ? appendPageHistory(existingPage, now) : [],
      };

      if (existingIndex >= 0) {
        docs.pages[existingIndex] = page;
      } else {
        docs.pages.push(page);
      }

      docs.pages = normalizePageOrders(docs.pages);
      writeDocs(docs);
      return sendJson(res, { ok: true, page });
    }

    if (req.method === "GET" && pathname === "/api/project") {
      const docs = readDocs();
      return sendJson(res, {
        project: docs.project,
        versions: docs.versions || ["latest"],
      });
    }

    if (req.method === "POST" && pathname === "/api/project") {
      const payload = await readBody(req);
      const docs = readDocs();
      docs.project = {
        title: String(payload.title || docs.project.title || "DaaS Local Docs").trim(),
        description: String(payload.description || docs.project.description || "").trim(),
        defaultTheme: payload.defaultTheme === "dark" ? "dark" : "light",
      };
      docs.versions = normalizeVersions(payload.versions || docs.versions || ["latest"]);
      writeDocs(docs);
      return sendJson(res, { ok: true, project: docs.project, versions: docs.versions });
    }

    if (req.method === "POST" && pathname === "/api/versions") {
      const payload = await readBody(req);
      const docs = readDocs();
      docs.versions = normalizeVersions(payload.versions || docs.versions || ["latest"]);
      writeDocs(docs);
      return sendJson(res, { ok: true, versions: docs.versions });
    }

    if (req.method === "GET" && pathname === "/api/tools/broken-links") {
      const docs = readDocs();
      return sendJson(res, { results: checkBrokenLinks(docs) });
    }

    if (req.method === "GET" && pathname === "/api/media") {
      const docs = readDocs();
      return sendJson(res, { assets: listMediaAssets(docs) });
    }

    if (req.method === "GET" && pathname === "/api/redirects") {
      const docs = readDocs();
      return sendJson(res, { redirects: listRedirects(docs) });
    }

    if (req.method === "POST" && pathname === "/api/redirects") {
      const payload = await readBody(req);
      const docs = readDocs();
      const action = String(payload.action || "add");
      const page = docs.pages.find((item) => item.slug === String(payload.slug || ""));

      if (!page) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      const previousSlug = slugify(payload.previousSlug || "");
      if (!previousSlug) {
        return sendJson(res, { error: "Previous slug is required" }, 400);
      }

      if (docs.pages.some((item) => item.slug === previousSlug && item.slug !== page.slug)) {
        return sendJson(res, { error: "Previous slug is already an active page slug" }, 409);
      }

      const current = Array.isArray(page.previousSlugs) ? page.previousSlugs : [];
      if (action === "delete") {
        page.previousSlugs = current.filter((item) => item !== previousSlug);
      } else {
        page.previousSlugs = Array.from(new Set([...current, previousSlug])).filter((item) => item !== page.slug);
      }

      page.updatedAt = new Date().toISOString();
      writeDocs(docs);
      return sendJson(res, { ok: true, redirects: listRedirects(docs), page });
    }

    if (req.method === "GET" && pathname === "/api/export/markdown") {
      const docs = readDocs();
      const markdown = exportMarkdownArchive(docs);
      return sendTextDownload(res, markdown, `daas-v3-export-${new Date().toISOString().slice(0, 10)}.md`);
    }

    if (req.method === "GET" && pathname === "/api/export/zip") {
      const docs = readDocs();
      const archive = createBackupArchive(docs);
      return sendBinaryDownload(res, archive, `daas-v3-backup-${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
    }

    if (req.method === "POST" && pathname === "/api/import/markdown") {
      const payload = await readBody(req);
      const docs = readDocs();
      const importedPages = parseMarkdownImport(String(payload.markdown || ""));

      if (!importedPages.length) {
        return sendJson(res, { error: "No markdown pages found" }, 400);
      }

      const now = new Date().toISOString();
      for (const imported of importedPages) {
        if (!docs.sections.some((section) => section.toLowerCase() === imported.section.toLowerCase())) {
          docs.sections.push(imported.section);
        }
        docs.versions = normalizeVersions(docs.versions || ["latest"]);
        if (!docs.versions.includes(imported.version)) {
          docs.versions.push(imported.version);
        }

        const existingIndex = docs.pages.findIndex((page) => page.slug === imported.slug);
        const existingPage = existingIndex >= 0 ? docs.pages[existingIndex] : null;
        const page = {
          slug: imported.slug,
          title: imported.title,
          section: imported.section,
          parentSlug: imported.parentSlug,
          description: imported.description,
          metaTitle: imported.metaTitle,
          metaDescription: imported.metaDescription,
          canonicalUrl: imported.canonicalUrl,
          version: imported.version,
          previousSlugs: mergeImportedPreviousSlugs(existingPage, imported.previousSlugs),
          draftContent: imported.content,
          publishedContent: existingPage ? existingPage.publishedContent || "" : imported.status === "published" ? imported.content : "",
          status: existingPage ? existingPage.status || "draft" : imported.status,
          pinned: imported.pinned !== null && imported.pinned !== undefined ? Boolean(imported.pinned) : existingPage ? Boolean(existingPage.pinned) : false,
          publishedAt: existingPage ? existingPage.publishedAt || null : imported.status === "published" ? now : null,
          updatedAt: now,
          order: Number.isFinite(imported.order) ? imported.order : existingIndex >= 0 ? existingPage.order || existingIndex : docs.pages.length,
          history: existingPage ? appendPageHistory(existingPage, now, "import") : [],
        };

        if (existingIndex >= 0) {
          docs.pages[existingIndex] = page;
        } else {
          docs.pages.push(page);
        }
      }

      docs.sections = Array.from(new Set(docs.sections.map((section) => normalizeSectionName(section)).filter(Boolean)));
      docs.pages = normalizePageOrders(docs.pages);
      writeDocs(docs);
      return sendJson(res, { ok: true, imported: importedPages.length, pages: docs.pages });
    }

    if (req.method === "GET" && pathname === "/api/page/history") {
      const slug = parsedUrl.searchParams.get("slug");
      const docs = readDocs();
      const page = docs.pages.find((item) => item.slug === slug);

      if (!page) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      return sendJson(res, {
        history: (page.history || []).map((entry) => ({
          id: entry.id,
          savedAt: entry.savedAt,
          reason: entry.reason || "autosave",
          title: entry.title || page.title,
          summary: summarizeMarkdown(entry.content || ""),
        })),
      });
    }

    if (req.method === "POST" && pathname === "/api/page/pin") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const pageIndex = docs.pages.findIndex((page) => page.slug === slug);

      if (pageIndex < 0) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      docs.pages[pageIndex].pinned = Boolean(payload.pinned);
      docs.pages[pageIndex].updatedAt = new Date().toISOString();
      writeDocs(docs);
      return sendJson(res, { ok: true, page: docs.pages[pageIndex] });
    }

    if (req.method === "POST" && pathname === "/api/page/restore") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const historyId = String(payload.historyId || "");
      const pageIndex = docs.pages.findIndex((page) => page.slug === slug);

      if (pageIndex < 0) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      const page = docs.pages[pageIndex];
      const entry = (page.history || []).find((item) => item.id === historyId);
      if (!entry) {
        return sendJson(res, { error: "History entry not found" }, 404);
      }

      const now = new Date().toISOString();
      docs.pages[pageIndex] = {
        ...page,
        draftContent: entry.content || "",
        updatedAt: now,
        history: appendPageHistory(page, now, "restore"),
      };
      writeDocs(docs);
      return sendJson(res, { ok: true, page: docs.pages[pageIndex] });
    }

    if (req.method === "POST" && pathname === "/api/sections") {
      const payload = await readBody(req);
      const docs = readDocs();
      const sectionName = normalizeSectionName(payload.name);

      if (!sectionName) {
        return sendJson(res, { error: "Section name is required" }, 400);
      }

      const exists = (docs.sections || []).some((section) => section.toLowerCase() === sectionName.toLowerCase());
      if (exists) {
        return sendJson(res, { error: "Section already exists" }, 409);
      }

      docs.sections = [...(docs.sections || []), sectionName];
      writeDocs(docs);
      return sendJson(res, { ok: true, sections: docs.sections });
    }

    if (req.method === "POST" && pathname === "/api/sections/reorder") {
      const payload = await readBody(req);
      const docs = readDocs();
      const name = normalizeSectionName(payload.name);
      const direction = String(payload.direction || "");
      const sections = [...(docs.sections || [])];
      const currentIndex = sections.findIndex((section) => section === name);

      if (currentIndex < 0) {
        return sendJson(res, { error: "Section not found" }, 404);
      }

      const targetIndex = direction === "up" ? currentIndex - 1 : direction === "down" ? currentIndex + 1 : currentIndex;
      if (targetIndex < 0 || targetIndex >= sections.length) {
        return sendJson(res, { ok: true, sections });
      }

      const [moved] = sections.splice(currentIndex, 1);
      sections.splice(targetIndex, 0, moved);
      docs.sections = sections;
      writeDocs(docs);
      return sendJson(res, { ok: true, sections });
    }

    if (req.method === "POST" && pathname === "/api/sections/delete") {
      const payload = await readBody(req);
      const docs = readDocs();
      const name = normalizeSectionName(payload.name);
      const sections = [...(docs.sections || [])];

      if (!sections.includes(name)) {
        return sendJson(res, { error: "Section not found" }, 404);
      }

      if (sections.length <= 1) {
        return sendJson(res, { error: "At least one section is required" }, 400);
      }

      const hasPages = docs.pages.some((page) => (page.section || "General") === name);
      if (hasPages) {
        return sendJson(res, { error: "Section masih dipakai halaman. Kosongkan dulu sebelum dihapus." }, 409);
      }

      docs.sections = sections.filter((section) => section !== name);
      writeDocs(docs);
      return sendJson(res, { ok: true, sections: docs.sections });
    }

    if (req.method === "POST" && pathname === "/api/page/publish") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const pageIndex = docs.pages.findIndex((item) => item.slug === slug);

      if (pageIndex < 0) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      const now = new Date().toISOString();
      docs.pages[pageIndex] = {
        ...docs.pages[pageIndex],
        publishedContent: docs.pages[pageIndex].draftContent || "",
        publishedAt: now,
        updatedAt: now,
        status: "published",
      };

      writeDocs(docs);
      return sendJson(res, { ok: true, page: docs.pages[pageIndex] });
    }

    if (req.method === "POST" && pathname === "/api/page/unpublish") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const pageIndex = docs.pages.findIndex((item) => item.slug === slug);

      if (pageIndex < 0) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      docs.pages[pageIndex] = {
        ...docs.pages[pageIndex],
        status: "draft",
      };

      writeDocs(docs);
      return sendJson(res, { ok: true, page: docs.pages[pageIndex] });
    }

    if (req.method === "POST" && pathname === "/api/page/delete") {
      const payload = await readBody(req);
      const docs = readDocs();
      const nextPages = docs.pages.filter((item) => item.slug !== payload.slug);

      if (nextPages.length === docs.pages.length) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      docs.pages = nextPages.map((page, index) => ({ ...page, order: index }));
      writeDocs(docs);
      return sendJson(res, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/page/duplicate") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const sourcePage = docs.pages.find((item) => item.slug === slug);

      if (!sourcePage) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      const nextSlug = makeUniqueSlug(`${sourcePage.slug}-copy`, docs.pages);
      const duplicate = {
        ...sourcePage,
        slug: nextSlug,
        title: `${sourcePage.title} Copy`,
        parentSlug: "",
        status: "draft",
        pinned: false,
        publishedAt: null,
        order: docs.pages.length,
        updatedAt: new Date().toISOString(),
      };

      docs.pages.push(duplicate);
      writeDocs(docs);
      return sendJson(res, { ok: true, page: duplicate });
    }

    if (req.method === "POST" && pathname === "/api/preview") {
      const payload = await readBody(req);
      const rendered = renderMarkdown(String(payload.content || ""));
      return sendJson(res, rendered);
    }

    if (req.method === "POST" && pathname === "/api/pages/reorder") {
      const payload = await readBody(req);
      const docs = readDocs();
      const slug = String(payload.slug || "");
      const direction = String(payload.direction || "");
      const currentPage = docs.pages.find((item) => item.slug === slug);

      if (!currentPage) {
        return sendJson(res, { error: "Page not found" }, 404);
      }

      const didChange =
        direction === "up" || direction === "down"
          ? movePageAmongSiblings(docs.pages, currentPage, direction)
          : direction === "indent"
            ? indentPage(docs.pages, currentPage)
            : direction === "outdent"
              ? outdentPage(docs.pages, currentPage)
              : false;

      if (!didChange) {
        return sendJson(res, { ok: true, pages: docs.pages });
      }

      docs.pages = normalizePageOrders(docs.pages);
      writeDocs(docs);

      return sendJson(res, { ok: true, pages: docs.pages });
    }

    if (req.method === "POST" && pathname === "/api/assets/upload") {
      const contentType = req.headers["content-type"] || "";
      const match = contentType.match(/boundary=(.+)$/);

      if (!match) {
        return sendJson(res, { error: "Missing multipart boundary" }, 400);
      }

      const body = await readRawBody(req);
      const file = parseMultipartFile(body, match[1]);

      if (!file || !file.filename || !file.content) {
        return sendJson(res, { error: "No file uploaded" }, 400);
      }

      const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      const uniqueName = `${Date.now()}-${safeName}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, uniqueName), file.content);

      return sendJson(res, {
        ok: true,
        asset: {
          filename: uniqueName,
          url: `/public/uploads/${uniqueName}`,
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/search") {
      const query = String(parsedUrl.searchParams.get("q") || "").trim();
      const docs = readDocs();
      const results = searchPublishedPages(getPublishedPages(docs), query);
      return sendJson(res, { query, results });
    }

    if (req.method === "GET" && pathname.startsWith("/docs/")) {
      const slug = pathname.replace("/docs/", "") || "getting-started";
      const docs = readDocs();
      const publishedPages = getPublishedPages(docs);
      const page = publishedPages.find((item) => item.slug === slug);
      const redirectedPage = !page
        ? publishedPages.find((item) => (item.previousSlugs || []).includes(slug))
        : null;

      if (redirectedPage) {
        redirect(res, `/docs/${redirectedPage.slug}`, 301);
        return;
      }

      if (!page) {
        return sendHtml(res, renderNotFound(docs, slug), 404);
      }

      return sendHtml(res, renderDocsPage(docs, page));
    }

    sendHtml(res, renderNotFound(readDocs(), pathname), 404);
  } catch (error) {
    sendHtml(
      res,
      `<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h1>Server error</h1><pre>${escapeHtml(
        error.stack || String(error)
      )}</pre></body></html>`,
      500
    );
  }
});

server.listen(PORT, () => {
  console.log(`DaaS local docs running on http://localhost:${PORT}`);
});

function ensureFileSystem() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
  const starter = {
      project: {
        title: "DaaS Local Docs",
        description: "Dokumentasi lokal yang mudah dipakai tim kecil.",
      },
      sections: ["Basics"],
      pages: [
        {
          slug: "getting-started",
          title: "Getting Started",
          section: "Basics",
          parentSlug: "",
          description: "Mulai cepat menggunakan DaaS local MVP.",
          draftContent: `# Getting Started

Selamat datang di DaaS local MVP. Kamu bisa edit halaman ini dari dashboard lalu lihat hasilnya langsung.

:::tip Cepat Dipakai
Buka \`/app\`, pilih halaman, lalu simpan. Perubahan akan langsung tampil di renderer.
:::

## Kenapa versi ini sederhana

- Tidak ada login
- Tidak ada payment gateway
- Tidak ada deploy pipeline
- Fokus ke pengalaman menulis docs

## Contoh kode

\`\`\`js title="server.js"
console.log("Local docs are ready");
\`\`\`
`,
          publishedContent: `# Getting Started

Selamat datang di DaaS local MVP. Kamu bisa edit halaman ini dari dashboard lalu lihat hasilnya langsung.

:::tip Cepat Dipakai
Buka \`/app\`, pilih halaman, lalu simpan. Perubahan akan langsung tampil di renderer.
:::

## Kenapa versi ini sederhana

- Tidak ada login
- Tidak ada payment gateway
- Tidak ada deploy pipeline
- Fokus ke pengalaman menulis docs

## Contoh kode

\`\`\`js title="server.js"
console.log("Local docs are ready");
\`\`\`
`,
          status: "published",
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          order: 0,
        },
        {
          slug: "writing-docs",
          title: "Writing Docs",
          section: "Basics",
          parentSlug: "",
          description: "Panduan singkat menulis dokumentasi.",
          draftContent: `# Writing Docs

Gunakan heading seperti biasa:

## Section

Paragraf biasa mendukung **bold**, \`inline code\`, dan [link](https://example.com).

:::warning Catatan
Parser markdown di MVP ini dibuat ringan. Fokusnya agar alur bikin docs cepat, bukan syntax lengkap.
:::
`,
          publishedContent: `# Writing Docs

Gunakan heading seperti biasa:

## Section

Paragraf biasa mendukung **bold**, \`inline code\`, dan [link](https://example.com).

:::warning Catatan
Parser markdown di MVP ini dibuat ringan. Fokusnya agar alur bikin docs cepat, bukan syntax lengkap.
:::
`,
          status: "published",
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          order: 1,
        },
      ],
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2));
  }
}

function readDocs() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const migrated = migrateDocs(raw);

  if (JSON.stringify(raw) !== JSON.stringify(migrated)) {
    writeDocs(migrated);
  }

  return migrated;
}

function writeDocs(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalizePageInput(payload) {
  const slug = String(payload.slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const title = String(payload.title || "").trim();
  const section = String(payload.section || "General").trim() || "General";
  const parentSlug = String(payload.parentSlug || "").trim();
  const description = String(payload.description || "").trim();
  const metaTitle = String(payload.metaTitle || "").trim();
  const metaDescription = String(payload.metaDescription || "").trim();
  const canonicalUrl = String(payload.canonicalUrl || "").trim();
  const version = String(payload.version || "latest").trim() || "latest";
  const content = String(payload.content || "");

  if (!slug || !title) {
    throw new Error("Slug and title are required.");
  }

  if (parentSlug && parentSlug === slug) {
    throw new Error("Page cannot be its own parent.");
  }

  return { slug, title, section, parentSlug, description, metaTitle, metaDescription, canonicalUrl, version, content };
}

function normalizeSectionName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateSectionExists(sections, sectionName) {
  const hasMatch = sections.some((section) => section.toLowerCase() === sectionName.toLowerCase());
  if (!hasMatch) {
    throw new Error("Section must be created first.");
  }
}

function validateParentAssignment(pages, normalized, existingPage) {
  if (!normalized.parentSlug) {
    return;
  }

  const parentPage = pages.find((page) => page.slug === normalized.parentSlug);
  if (!parentPage) {
    throw new Error("Parent page not found.");
  }

  if ((parentPage.section || "General") !== normalized.section) {
    throw new Error("Parent page must stay in the same section.");
  }

  const currentSlug = existingPage ? existingPage.slug : normalized.slug;
  if (currentSlug && isDescendantOf(pages, normalized.parentSlug, currentSlug)) {
    throw new Error("Page cannot be assigned under its own descendant.");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartFile(body, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let start = body.indexOf(boundaryBuffer);

  while (start !== -1) {
    const next = body.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;
    const part = body.slice(start + boundaryBuffer.length + 2, next - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));

    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("utf8");
      const dispositionMatch = headerText.match(/filename="([^"]+)"/);
      if (dispositionMatch) {
        return {
          filename: dispositionMatch[1],
          content: part.slice(headerEnd + 4),
        };
      }
    }

    start = next;
  }

  return null;
}

function migrateDocs(raw) {
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const discoveredSections = Array.from(
    new Set(pages.map((page) => normalizeSectionName(page.section || "General")).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const sections = Array.isArray(raw.sections) && raw.sections.length
    ? Array.from(new Set(raw.sections.map((section) => normalizeSectionName(section)).filter(Boolean)))
    : discoveredSections.length
      ? discoveredSections
      : ["General"];

  return {
      project: {
        title: "DaaS Local Docs",
        description: "Dokumentasi lokal yang mudah dipakai tim kecil.",
        defaultTheme: "light",
        ...(raw.project || {}),
      },
      versions: normalizeVersions(raw.versions || ["latest"]),
      sections,
      pages: pages.map((page, index) => {
      const legacyContent = page.content || "";
      const publishedContent =
        page.publishedContent !== undefined
          ? page.publishedContent
          : legacyContent;

      return {
        slug: page.slug,
        title: page.title || "Untitled",
        section: sections.includes(normalizeSectionName(page.section || "")) ? normalizeSectionName(page.section) : sections[0],
          parentSlug: page.parentSlug || "",
          description: page.description || "",
          metaTitle: page.metaTitle || "",
          metaDescription: page.metaDescription || "",
          canonicalUrl: page.canonicalUrl || "",
          version: page.version || "latest",
          previousSlugs: Array.isArray(page.previousSlugs) ? page.previousSlugs.filter(Boolean) : [],
          draftContent: page.draftContent !== undefined ? page.draftContent : legacyContent,
        publishedContent,
          status: page.status || (publishedContent.trim() ? "published" : "draft"),
          pinned: Boolean(page.pinned),
          updatedAt: page.updatedAt || new Date().toISOString(),
          publishedAt: page.publishedAt || (publishedContent.trim() ? page.updatedAt || new Date().toISOString() : null),
          order: page.order !== undefined ? page.order : index,
          history: Array.isArray(page.history) ? page.history.slice(0, 25) : [],
        };
      }),
    };
  }

function appendPageHistory(page, savedAt = new Date().toISOString(), reason = "autosave") {
  const content = page.draftContent || "";
  if (!content.trim()) {
    return Array.isArray(page.history) ? page.history.slice(0, 25) : [];
  }

  const history = Array.isArray(page.history) ? page.history : [];
  const latest = history[0];
  if (latest && latest.content === content) {
    return history.slice(0, 25);
  }

  return [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt,
      reason,
      title: page.title || "Untitled",
      content,
    },
    ...history,
  ].slice(0, 25);
}

function mergePreviousSlugs(existingPage, nextSlug) {
  if (!existingPage) return [];
  const previous = Array.isArray(existingPage.previousSlugs) ? existingPage.previousSlugs : [];
  const next = [...previous];
  if (existingPage.slug && existingPage.slug !== nextSlug && !next.includes(existingPage.slug)) {
    next.unshift(existingPage.slug);
  }
  return next.filter((slug) => slug && slug !== nextSlug).slice(0, 12);
}

function normalizeVersions(value) {
  const versions = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\n]/)
        .map((item) => item.trim());
  const cleaned = versions.map((item) => String(item || "").trim()).filter(Boolean);
  return Array.from(new Set(cleaned.length ? cleaned : ["latest"]));
}

function checkBrokenLinks(docs) {
  const pages = docs.pages || [];
  const publishedSlugs = new Set(getPublishedPages(docs).map((page) => page.slug));
  const allSlugs = new Set(pages.map((page) => page.slug));
  const results = [];
  const seen = new Map();

  for (const page of pages) {
    const sources = [
      { field: "Draft content", markdown: page.draftContent || "" },
      { field: "Published content", markdown: page.publishedContent || "" },
    ];

    for (const source of sources) {
      const links = extractMarkdownLinks(source.markdown);
      for (const link of links) {
        const status = validateLinkTarget(link.href, publishedSlugs, allSlugs);
        if (status.ok) continue;

        const key = [page.slug, link.href, status.issue, link.line, link.label].join("::");
        if (seen.has(key)) {
          const existing = seen.get(key);
          if (!existing.fields.includes(source.field)) {
            existing.fields.push(source.field);
          }
          continue;
        }

        const result = {
          page: page.title || page.slug,
          slug: page.slug,
          label: link.label,
          href: link.href,
          issue: status.issue,
          line: link.line,
          type: link.type,
          fields: [source.field],
        };
        seen.set(key, result);
        results.push(result);
      }
    }
  }

  return results;
}

function listMediaAssets(docs) {
  if (!fs.existsSync(UPLOADS_DIR)) return [];

  const pages = docs.pages || [];
  return fs
    .readdirSync(UPLOADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(UPLOADS_DIR, entry.name);
      const stat = fs.statSync(filePath);
      const url = `/public/uploads/${entry.name}`;
      const usedBy = pages
        .filter((page) => `${page.draftContent || ""}\n${page.publishedContent || ""}`.includes(url))
        .map((page) => ({ title: page.title || page.slug, slug: page.slug }));

      return {
        name: entry.name,
        url,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        usedBy,
        orphan: usedBy.length === 0,
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function listRedirects(docs) {
  return (docs.pages || [])
    .flatMap((page) =>
      (Array.isArray(page.previousSlugs) ? page.previousSlugs : []).map((previousSlug) => ({
        previousSlug,
        slug: page.slug,
        title: page.title || page.slug,
        status: page.status || "draft",
      }))
    )
    .sort((a, b) => a.previousSlug.localeCompare(b.previousSlug));
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(markdown))) {
    const before = markdown.slice(0, match.index);
    const line = before ? before.split("\n").length : 1;
    links.push({
      label: match[1] || match[2],
      href: match[2],
      line,
      type: match[0].startsWith("!") ? "image" : "link",
    });
  }
  return links;
}

function validateLinkTarget(href, publishedSlugs, allSlugs) {
  const cleanHref = String(href || "").split("#")[0].trim();
  if (!cleanHref || cleanHref.startsWith("http://") || cleanHref.startsWith("https://") || cleanHref.startsWith("mailto:")) {
    return { ok: true };
  }

  if (cleanHref.startsWith("/docs/")) {
    const slug = cleanHref.replace("/docs/", "").replace(/^\/+|\/+$/g, "");
    if (!allSlugs.has(slug)) return { ok: false, issue: "Missing internal page" };
    if (!publishedSlugs.has(slug)) return { ok: false, issue: "Internal page is not published" };
    return { ok: true };
  }

  if (cleanHref.startsWith("/public/uploads/")) {
    const filePath = path.join(__dirname, cleanHref);
    return fs.existsSync(filePath) ? { ok: true } : { ok: false, issue: "Missing uploaded asset" };
  }

  if (cleanHref.startsWith("/")) {
    return { ok: fs.existsSync(path.join(__dirname, cleanHref)), issue: "Missing local file" };
  }

  return { ok: true };
}

function summarizeMarkdown(markdown) {
  return stripInlineMarkdown(
    String(markdown || "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/:::\w+[\s\S]*?:::/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 120);
}

function exportMarkdownArchive(docs) {
  const pages = sortPagesByOrder(docs.pages || []);
  const chunks = [
    "<!-- DAAS-V3-MARKDOWN-ARCHIVE -->",
    `<!-- Exported: ${new Date().toISOString()} -->`,
    "",
  ];

  for (const page of pages) {
    chunks.push("---");
    chunks.push(`slug: ${JSON.stringify(page.slug || "")}`);
    chunks.push(`title: ${JSON.stringify(page.title || "Untitled")}`);
    chunks.push(`section: ${JSON.stringify(page.section || "General")}`);
    chunks.push(`parentSlug: ${JSON.stringify(page.parentSlug || "")}`);
    chunks.push(`description: ${JSON.stringify(page.description || "")}`);
    chunks.push(`metaTitle: ${JSON.stringify(page.metaTitle || "")}`);
    chunks.push(`metaDescription: ${JSON.stringify(page.metaDescription || "")}`);
    chunks.push(`canonicalUrl: ${JSON.stringify(page.canonicalUrl || "")}`);
    chunks.push(`version: ${JSON.stringify(page.version || "latest")}`);
    chunks.push(`order: ${JSON.stringify(page.order || 0)}`);
    chunks.push(`previousSlugs: ${JSON.stringify(Array.isArray(page.previousSlugs) ? page.previousSlugs : [])}`);
    chunks.push(`status: ${JSON.stringify(page.status || "draft")}`);
    chunks.push(`pinned: ${JSON.stringify(Boolean(page.pinned))}`);
    chunks.push("---");
    chunks.push(page.draftContent || "");
    chunks.push("<!-- /DAAS-PAGE -->");
    chunks.push("");
  }

  return chunks.join("\n");
}

function createBackupArchive(docs) {
  const entries = [
    {
      name: "data/docs.json",
      content: Buffer.from(`${JSON.stringify(docs, null, 2)}\n`, "utf8"),
    },
    {
      name: "docs-export.md",
      content: Buffer.from(exportMarkdownArchive(docs), "utf8"),
    },
  ];

  if (fs.existsSync(UPLOADS_DIR)) {
    for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filePath = path.join(UPLOADS_DIR, entry.name);
      entries.push({
        name: `public/uploads/${entry.name}`,
        content: fs.readFileSync(filePath),
      });
    }
  }

  return createZip(entries);
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content || ""), "utf8");
    const crc = crc32(content);
    const { time, date } = getDosDateTime(new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localFiles = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFiles.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localFiles, centralDirectory, end]);
}

function getDosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseMarkdownImport(markdown) {
  const value = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!value) return [];

  if (!value.includes("<!-- /DAAS-PAGE -->")) {
    return [parseSingleMarkdownPage(value)];
  }

  return value
    .split("<!-- /DAAS-PAGE -->")
    .map((chunk) => chunk.replace("<!-- DAAS-V3-MARKDOWN-ARCHIVE -->", "").replace(/<!-- Exported:.*?-->/, "").trim())
    .filter(Boolean)
    .map(parseArchivePage)
    .filter(Boolean);
}

function parseArchivePage(chunk) {
  const match = chunk.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return parseSingleMarkdownPage(chunk);

  const meta = parseFrontMatter(match[1]);
  const content = match[2].trim();
  const title = meta.title || inferMarkdownTitle(content);
  const slug = slugify(meta.slug || title);

  if (!slug || !title) return null;

  return {
    slug,
    title,
    section: normalizeSectionName(meta.section || "General") || "General",
    parentSlug: String(meta.parentSlug || "").trim(),
    description: String(meta.description || "").trim(),
    metaTitle: String(meta.metaTitle || "").trim(),
    metaDescription: String(meta.metaDescription || "").trim(),
    canonicalUrl: String(meta.canonicalUrl || "").trim(),
    version: String(meta.version || "latest").trim() || "latest",
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : null,
    previousSlugs: Array.isArray(meta.previousSlugs) ? meta.previousSlugs.map((item) => slugify(item)).filter(Boolean) : [],
    status: meta.status === "published" ? "published" : "draft",
    pinned: meta.pinned === true || meta.pinned === "true",
    content,
  };
}

function parseSingleMarkdownPage(markdown) {
  const content = String(markdown || "").trim();
  const title = inferMarkdownTitle(content);
  return {
    slug: slugify(title),
    title,
    section: "General",
    parentSlug: "",
    description: "",
    metaTitle: "",
    metaDescription: "",
    canonicalUrl: "",
    version: "latest",
    order: null,
    previousSlugs: [],
    status: "draft",
    pinned: false,
    content,
  };
}

function mergeImportedPreviousSlugs(existingPage, importedPreviousSlugs = []) {
  const existing = existingPage && Array.isArray(existingPage.previousSlugs) ? existingPage.previousSlugs : [];
  return Array.from(new Set([...existing, ...importedPreviousSlugs].map((item) => slugify(item)).filter(Boolean)));
}

function inferMarkdownTitle(markdown) {
  const match = String(markdown || "").match(/^#\s+(.+)$/m);
  return match ? stripInlineMarkdown(match[1]).trim() || "Imported Page" : "Imported Page";
}

function parseFrontMatter(frontMatter) {
  const meta = {};
  for (const line of String(frontMatter || "").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();
    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return meta;
}

function searchPublishedPages(pages, query) {
  if (!query) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return pages
    .map((page) => {
      const haystack = [
        page.title,
        page.slug,
        page.section,
        page.description,
        stripInlineMarkdown(page.publishedContent || ""),
      ]
        .join(" ")
        .toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { page, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
    .slice(0, 12)
    .map(({ page }) => ({
      title: page.title,
      slug: page.slug,
      section: page.section || "General",
      description: page.description || summarizeMarkdown(page.publishedContent || ""),
    }));
}

function summarizeSearchText(markdown) {
  return stripInlineMarkdown(markdown || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function estimateReadingTime(markdown) {
  const words = stripInlineMarkdown(markdown || "")
    .split(/\s+/)
    .filter(Boolean).length;
  if (!words) return 1;
  return Math.max(1, Math.ceil(words / 200));
}

function getPublishedPages(docs) {
  return docs.pages
    .filter((page) => page.status === "published" && (page.publishedContent || "").trim())
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function makeUniqueSlug(baseSlug, pages) {
  const existing = new Set(pages.map((page) => page.slug));
  if (!existing.has(baseSlug)) {
    return baseSlug;
  }

  let counter = 2;
  while (existing.has(`${baseSlug}-${counter}`)) {
    counter += 1;
  }

  return `${baseSlug}-${counter}`;
}

function sortPagesByOrder(pages) {
  return [...pages].sort((a, b) => {
    const orderDelta = (a.order || 0) - (b.order || 0);
    if (orderDelta !== 0) return orderDelta;
    return a.title.localeCompare(b.title);
  });
}

function normalizePageOrders(pages) {
  const sorted = sortPagesByOrder(pages);
  const sectionNames = [];

  for (const page of sorted) {
    const section = page.section || "General";
    if (!sectionNames.includes(section)) {
      sectionNames.push(section);
    }
  }

  const ordered = [];

  for (const sectionName of sectionNames) {
    const sectionPages = sorted.filter((page) => (page.section || "General") === sectionName);
    const included = new Set();
    const roots = sectionPages.filter(
      (page) => !page.parentSlug || !sectionPages.some((candidate) => candidate.slug === page.parentSlug)
    );

    const walk = (parentSlug = "") => {
      const children = sectionPages
        .filter((page) => (page.parentSlug || "") === parentSlug && !included.has(page.slug))
        .sort((a, b) => {
          const orderDelta = (a.order || 0) - (b.order || 0);
          if (orderDelta !== 0) return orderDelta;
          return a.title.localeCompare(b.title);
        });

      for (const child of children) {
        included.add(child.slug);
        ordered.push(child);
        walk(child.slug);
      }
    };

    for (const root of roots.sort((a, b) => (a.order || 0) - (b.order || 0))) {
      if (included.has(root.slug)) continue;
      included.add(root.slug);
      ordered.push(root);
      walk(root.slug);
    }

    for (const leftover of sectionPages) {
      if (included.has(leftover.slug)) continue;
      included.add(leftover.slug);
      ordered.push({ ...leftover, parentSlug: "" });
      walk(leftover.slug);
    }
  }

  return ordered.map((page, index) => ({ ...page, order: index }));
}

function movePageAmongSiblings(pages, currentPage, direction) {
  const siblings = sortPagesByOrder(
    pages.filter(
      (page) =>
        (page.section || "General") === (currentPage.section || "General") &&
        (page.parentSlug || "") === (currentPage.parentSlug || "")
    )
  );
  const currentIndex = siblings.findIndex((page) => page.slug === currentPage.slug);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
    return false;
  }

  const targetPage = siblings[targetIndex];
  const currentOrder = currentPage.order || 0;
  currentPage.order = targetPage.order || 0;
  targetPage.order = currentOrder;
  return true;
}

function indentPage(pages, currentPage) {
  const siblings = sortPagesByOrder(
    pages.filter(
      (page) =>
        (page.section || "General") === (currentPage.section || "General") &&
        (page.parentSlug || "") === (currentPage.parentSlug || "")
    )
  );
  const currentIndex = siblings.findIndex((page) => page.slug === currentPage.slug);
  if (currentIndex <= 0) {
    return false;
  }

  const nextParent = siblings[currentIndex - 1];
  currentPage.parentSlug = nextParent.slug;
  currentPage.order = Math.max(...pages.map((page) => page.order || 0), 0) + 1;
  return true;
}

function outdentPage(pages, currentPage) {
  if (!currentPage.parentSlug) {
    return false;
  }

  const parentPage = pages.find((page) => page.slug === currentPage.parentSlug);
  if (!parentPage) {
    currentPage.parentSlug = "";
    return true;
  }

  currentPage.parentSlug = parentPage.parentSlug || "";
  currentPage.section = parentPage.section || currentPage.section;
  currentPage.order = (parentPage.order || 0) + 0.5;
  return true;
}

function isDescendantOf(pages, candidateSlug, ancestorSlug) {
  let cursor = pages.find((page) => page.slug === candidateSlug) || null;

  while (cursor && cursor.parentSlug) {
    if (cursor.parentSlug === ancestorSlug) {
      return true;
    }
    cursor = pages.find((page) => page.slug === cursor.parentSlug) || null;
  }

  return false;
}

function serveStatic(pathname, res) {
  const filePath = path.join(__dirname, pathname);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    return sendHtml(res, "<h1>Not found</h1>", 404);
  }

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };

  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}

function renderAppShell() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DaaS Local Editor</title>
    <link rel="stylesheet" href="/public/vendor/toastui/toastui-editor-3.2.2.min.css" />
    <link rel="stylesheet" href="/public/style.css" />
  </head>
  <body class="app-shell">
    <div class="editor-layout">
      <aside class="editor-sidebar">
        <div class="brand-block">
          <div class="brand-header">
            <div class="brand-lockup" aria-label="DaaS v3">
              <div class="brand-mark" aria-hidden="true"></div>
              <span class="brand-separator" aria-hidden="true"></span>
              <strong class="brand-wordmark">DAAS V3</strong>
            </div>
            <button id="project-settings-button" class="icon-button brand-settings-button" type="button" aria-label="Project Settings" title="Project Settings">
              <span class="button-icon asset-settings" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="sidebar-toolbar">
          <button id="new-page-button" class="primary-button">
            <span class="button-icon asset-circle-plus" aria-hidden="true"></span>
            <span class="button-label">New Page</span>
          </button>
          <button id="sidebar-toggle" class="ghost-button sidebar-toggle" type="button" aria-label="Toggle sidebar">
            <span class="sidebar-toggle-icon" aria-hidden="true"></span>
          </button>
          </div>
          <div class="sidebar-body">
            <div id="sidebar-search-wrap" class="sidebar-search-wrap">
            <label class="sidebar-search-label" for="page-search-input">Search</label>
            <button id="sidebar-search-toggle" class="sidebar-search-toggle" type="button" aria-label="Open search">
              <span class="sidebar-search-icon" aria-hidden="true"></span>
            </button>
            <input id="page-search-input" class="sidebar-search-input" type="text" placeholder="Cari halaman..." />
          </div>
          <label class="sidebar-sort-label" for="page-sort-select">Sort</label>
          <select id="page-sort-select" class="sidebar-sort-select">
            <option value="manual">Manual order</option>
            <option value="updated">Last edited</option>
            <option value="title">A-Z title</option>
          </select>
          <div id="page-list" class="page-list"></div>
        </div>
      </aside>
      <main class="editor-main">
        <div class="editor-topbar">
          <div class="editor-heading-block">
            <div class="editor-heading-row">
              <h2 id="editor-heading">Editor</h2>
              <span id="page-status" class="page-status draft">
                <span class="page-status-dot" aria-hidden="true"></span>
                <span id="page-status-label">Draft</span>
              </span>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="topbar-primary-actions">
              <div class="workspace-toggle" role="tablist" aria-label="Workspace mode">
                <button id="editor-mode-toggle" class="workspace-toggle-button active" type="button" data-mode="write" aria-pressed="true">Editor</button>
                <button id="preview-mode-toggle" class="workspace-toggle-button" type="button" data-mode="preview" aria-pressed="false">Preview</button>
              </div>
            </div>
            <div class="topbar-utility-actions">
              <button id="export-markdown-button" class="icon-button topbar-icon-button" type="button" aria-label="Export Markdown" title="Export Markdown">
                <span class="button-icon asset-file-down" aria-hidden="true"></span>
              </button>
              <button id="export-zip-button" class="icon-button topbar-icon-button" type="button" aria-label="Export ZIP Backup" title="Export ZIP Backup">
                <span class="button-icon asset-archive" aria-hidden="true"></span>
              </button>
              <button id="import-markdown-button" class="icon-button topbar-icon-button" type="button" aria-label="Import Markdown" title="Import Markdown">
                <span class="button-icon asset-file-up" aria-hidden="true"></span>
              </button>
              <button id="recover-draft-button" class="icon-button topbar-icon-button" type="button" aria-label="Draft History" title="Draft History">
                <span class="button-icon asset-history" aria-hidden="true"></span>
              </button>
              <button id="broken-link-button" class="icon-button topbar-icon-button" type="button" aria-label="Broken Link Checker" title="Broken Link Checker">
                <span class="button-icon asset-cable" aria-hidden="true"></span>
              </button>
              <button id="slug-safety-button" class="icon-button topbar-icon-button" type="button" aria-label="Slug Safety" title="Slug Change Safety">
                <span class="button-icon asset-square-pen" aria-hidden="true"></span>
              </button>
              <button id="versioning-button" class="icon-button topbar-icon-button" type="button" aria-label="Versioning" title="Versioning">
                <span class="button-icon asset-git-fork" aria-hidden="true"></span>
              </button>
              <button id="command-palette-button" class="icon-button topbar-icon-button" type="button" aria-label="Command Palette" title="Command Palette (Ctrl+K)">
                <span class="button-icon asset-command" aria-hidden="true"></span>
              </button>
              <button id="diff-button" class="icon-button topbar-icon-button" type="button" aria-label="Compare Draft" title="Compare Draft vs Published">
                <span class="button-icon asset-scale" aria-hidden="true"></span>
              </button>
              <button id="page-health-button" class="icon-button topbar-icon-button" type="button" aria-label="Page Health" title="Page Health">
                <span class="button-icon asset-heart-pulse" aria-hidden="true"></span>
              </button>
              <button id="media-library-button" class="icon-button topbar-icon-button" type="button" aria-label="Media Library" title="Media Library">
                <span class="button-icon asset-image-upload" aria-hidden="true"></span>
              </button>
              <button id="templates-button" class="icon-button topbar-icon-button" type="button" aria-label="Templates" title="Templates">
                <span class="button-icon asset-layout-panel-top" aria-hidden="true"></span>
              </button>
              <button id="redirect-manager-button" class="icon-button topbar-icon-button" type="button" aria-label="Redirect Manager" title="Redirect Manager">
                <span class="button-icon asset-trending-up-down" aria-hidden="true"></span>
              </button>
              <input id="import-markdown-input" type="file" accept=".md,.markdown,text/markdown,text/plain" hidden />
              <button id="copy-link-button" class="icon-button topbar-icon-button" type="button" aria-label="Copy public link" title="Copy Public Link">
                <span class="link-glyph" aria-hidden="true"></span>
              </button>
              <button id="duplicate-button" class="icon-button topbar-icon-button" type="button" aria-label="Duplicate page" title="Duplicate">
                <span class="duplicate-glyph" aria-hidden="true"></span>
              </button>
            </div>
            <a class="icon-button topbar-icon-button topbar-open-docs" href="/" target="_blank" rel="noreferrer" aria-label="Open Docs" title="Open Docs">
              <span class="open-docs-glyph" aria-hidden="true"></span>
            </a>
          </div>
        </div>
        <form id="editor-form" class="editor-form workspace-panel active" data-panel="write">
          <div class="editor-meta-grid">
            <label>
              <span>Title</span>
              <input id="title-input" name="title" type="text" placeholder="Getting Started" required />
            </label>
            <label>
              <span>Slug</span>
              <input id="slug-input" name="slug" type="text" placeholder="getting-started" required />
            </label>
          <label>
            <span>Section</span>
            <div class="section-field">
              <select id="section-input" name="section"></select>
            </div>
            <button id="new-section-button" class="inline-meta-button" type="button">+ New Section</button>
          </label>
          <label class="parent-field">
            <span>Parent</span>
            <div class="section-field">
              <select id="parent-select" name="parentSlug">
                <option value="">No parent</option>
              </select>
            </div>
          </label>
          <label class="description-field">
            <span>Description</span>
            <input id="description-input" name="description" type="text" placeholder="Ringkasan singkat halaman" />
            </label>
          </div>
          <label class="editor-content-field">
            <span>Content</span>
            <textarea id="content-input" name="content" placeholder="# Tulis dokumentasi di sini" hidden></textarea>
            <div id="rich-editor" class="rich-editor-shell"></div>
            </label>
            <details class="seo-panel">
              <summary>
                <span>SEO & Metadata</span>
                <small>Meta title, description, canonical, version</small>
              </summary>
              <div class="seo-panel-grid">
                <label>
                  <span>Meta Title</span>
                  <input id="meta-title-input" name="metaTitle" type="text" placeholder="Default mengikuti title halaman" />
                </label>
                <label>
                  <span>Meta Description</span>
                  <input id="meta-description-input" name="metaDescription" type="text" placeholder="Default mengikuti description halaman" />
                </label>
                <label>
                  <span>Canonical URL</span>
                  <input id="canonical-url-input" name="canonicalUrl" type="url" placeholder="Opsional, mis. https://docs.example.com/page" />
                </label>
                <label>
                  <span>Version</span>
                  <select id="version-input" name="version"></select>
                </label>
                <label class="previous-slugs-field">
                  <span>Previous Slugs</span>
                  <input id="previous-slugs-input" type="text" readonly placeholder="Slug lama akan tersimpan otomatis saat slug berubah" />
                </label>
              </div>
            </details>
            <div class="editor-actions">
              <div class="editor-actions-primary">
                <div class="split-action" id="publish-split-action">
                  <button id="publish-button" type="button" class="primary-button split-action-main">Publish</button>
                  <button
                    id="publish-menu-toggle"
                    type="button"
                  class="primary-button split-action-toggle"
                  aria-label="Open publish options"
                  aria-haspopup="menu"
                  aria-expanded="false"
                >
                  <span class="branch-caret" aria-hidden="true"></span>
                </button>
                <div id="publish-menu" class="split-action-menu" role="menu" hidden>
                    <button id="unpublish-button" type="button" class="split-action-menu-item" role="menuitem">Unpublish</button>
                  </div>
                </div>
                <button type="submit" class="ghost-button button-strong">Save Draft</button>
                <p id="save-status" class="save-status">Saved</p>
              </div>
              <div class="editor-actions-secondary">
              </div>
              <div class="editor-actions-danger">
              <button id="delete-button" type="button" class="danger-button">
                <span class="button-icon asset-trash" aria-hidden="true"></span>
                <span class="button-label">Delete</span>
              </button>
            </div>
          </div>
        </form>
        <section id="preview-panel" class="preview-panel workspace-panel" data-panel="preview">
          <article id="preview-content" class="docs-prose preview-prose"></article>
        </section>
      </main>
    </div>
    <div id="app-modal" class="app-modal" hidden>
      <div class="app-modal-backdrop" data-modal-close></div>
      <div class="app-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
        <div class="app-modal-brand">
          <div class="brand-lockup modal-brand-lockup" aria-label="DaaS v3">
            <div class="brand-mark" aria-hidden="true"></div>
            <span class="brand-separator" aria-hidden="true"></span>
            <strong class="brand-wordmark">DAAS V3</strong>
          </div>
        </div>
        <div class="app-modal-header">
          <h3 id="app-modal-title">Dialog</h3>
          <p id="app-modal-message" class="app-modal-message"></p>
        </div>
        <div id="app-modal-input-wrap" class="app-modal-input-wrap" hidden>
          <input id="app-modal-input" class="app-modal-input" type="text" />
        </div>
        <div class="app-modal-actions">
          <button id="app-modal-cancel" class="ghost-button button-subtle" type="button">Cancel</button>
          <button id="app-modal-confirm" class="primary-button" type="button">OK</button>
        </div>
      </div>
    </div>
    <script src="/public/vendor/toastui/toastui-editor-3.2.2-all.min.js"></script>
    <script src="/public/app.js"></script>
  </body>
</html>`;
}

function renderDocsPage(docs, currentPage) {
  const rendered = renderMarkdown(currentPage.publishedContent || "");
  const pageTitle = currentPage.metaTitle || currentPage.title;
  const pageDescription = currentPage.metaDescription || currentPage.description || docs.project.description || "";
  const canonicalUrl = currentPage.canonicalUrl || "";
  const orderedPages = getPublishedPages(docs);
  const currentIndex = orderedPages.findIndex((page) => page.slug === currentPage.slug);
  const prevPage = currentIndex > 0 ? orderedPages[currentIndex - 1] : null;
  const nextPage = currentIndex >= 0 && currentIndex < orderedPages.length - 1 ? orderedPages[currentIndex + 1] : null;
  const sidebar = renderDocsSidebar(orderedPages, currentPage.slug, docs.sections || []);
  const breadcrumbs = renderDocsBreadcrumbs(orderedPages, currentPage);
  const childList = renderDocsChildren(orderedPages, currentPage);
  const readingTime = estimateReadingTime(currentPage.publishedContent || "");

  const toc = rendered.toc.length
    ? rendered.toc
        .map(
          (item) =>
            `<a class="toc-link toc-level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`
        )
        .join("")
    : `<p class="toc-empty">Tambahkan heading agar ToC muncul.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)} | ${escapeHtml(docs.project.title)}</title>
    ${pageDescription ? `<meta name="description" content="${escapeHtml(pageDescription)}" />` : ""}
    ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />` : ""}
    <link rel="stylesheet" href="/public/style.css" />
  </head>
  <body>
    <div class="docs-shell" data-theme="${escapeHtml(docs.project.defaultTheme || "light")}">
      <header class="docs-navbar">
        <div>
          <p class="eyebrow">Local docs MVP</p>
          <strong>${escapeHtml(docs.project.title)}</strong>
        </div>
        <div class="navbar-actions">
          <div class="docs-search" role="search">
            <input id="docs-search-input" class="docs-search-input" type="search" placeholder="Search docs..." autocomplete="off" />
            <div id="docs-search-results" class="docs-search-results" hidden></div>
          </div>
          <a class="ghost-button" href="/app">Edit Content</a>
          <button id="theme-toggle" class="ghost-button theme-toggle-button" type="button" aria-label="Toggle theme">
            <span class="button-icon asset-sun-moon" aria-hidden="true"></span>
          </button>
        </div>
      </header>
      <div class="docs-layout">
        <aside class="docs-sidebar">
          <p class="sidebar-label">Pages</p>
          ${sidebar}
        </aside>
        <main class="docs-main">
          <article class="docs-prose">
            ${breadcrumbs}
            <div class="docs-page-meta">
              <span>${readingTime} min read</span>
              ${currentPage.version ? `<span>Version ${escapeHtml(currentPage.version)}</span>` : ""}
              ${currentPage.publishedAt ? `<span>Updated ${escapeHtml(new Date(currentPage.publishedAt).toLocaleDateString("id-ID"))}</span>` : ""}
            </div>
            ${currentPage.description ? `<p class="preview-description">${escapeHtml(currentPage.description)}</p>` : ""}
            ${rendered.html}
            ${childList}
            ${renderPagination(prevPage, nextPage)}
          </article>
        </main>
        <aside class="docs-toc">
          <p class="sidebar-label">On this page</p>
          ${toc}
        </aside>
      </div>
    </div>
    <script src="/public/theme.js"></script>
    <script src="/public/docs-search.js"></script>
  </body>
</html>`;
}

function renderNotFound(docs, slug) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Not found</title>
    <link rel="stylesheet" href="/public/style.css" />
  </head>
  <body class="not-found-shell">
    <div class="not-found-card">
      <p class="eyebrow">Missing page</p>
      <h1>Halaman tidak ditemukan</h1>
      <p><code>${escapeHtml(slug)}</code> belum ada atau belum dipublish.</p>
      <div class="editor-actions">
        <a class="primary-button" href="/app">Open Editor</a>
        <a class="ghost-button" href="/docs/${getPublishedPages(docs)[0] ? getPublishedPages(docs)[0].slug : ""}">Back to Docs</a>
      </div>
    </div>
  </body>
</html>`;
}

function renderPagination(prevPage, nextPage) {
  if (!prevPage && !nextPage) return "";

  return `<nav class="docs-pagination">
    ${
      prevPage
        ? `<a class="pagination-card" href="/docs/${prevPage.slug}">
            <span class="pagination-label">Previous</span>
            <strong>${escapeHtml(prevPage.title)}</strong>
          </a>`
        : `<span></span>`
    }
    ${
      nextPage
        ? `<a class="pagination-card pagination-next" href="/docs/${nextPage.slug}">
            <span class="pagination-label">Next</span>
            <strong>${escapeHtml(nextPage.title)}</strong>
          </a>`
        : `<span></span>`
    }
  </nav>`;
}

function renderDocsSidebar(pages, activeSlug, sectionOrder = []) {
  const sections = groupPagesBySection(pages, sectionOrder);
  return sections
    .map(
      (section) => `<section class="sidebar-group">
        <p class="sidebar-group-title">${escapeHtml(section.name)}</p>
        <div class="sidebar-group-links">
          ${renderSidebarTree(section.pages, activeSlug)}
        </div>
      </section>`
    )
    .join("");
}

function groupPagesBySection(pages, sectionOrder = []) {
  const map = new Map();
  for (const page of pages) {
    const key = page.section || "General";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(page);
  }

  const orderedNames = [
    ...sectionOrder.filter((name) => map.has(name)),
    ...Array.from(map.keys()).filter((name) => !sectionOrder.includes(name)),
  ];

  return orderedNames.map((name) => ({ name, pages: map.get(name) || [] }));
}

function renderSidebarTree(pages, activeSlug, parentSlug = "", depth = 0) {
  return pages
    .filter((page) => (page.parentSlug || "") === parentSlug)
    .map((page) => renderSidebarNode(page, pages, activeSlug, depth))
    .join("");
}

function renderSidebarNode(page, allPages, activeSlug, depth) {
  const children = allPages.filter((item) => (item.parentSlug || "") === page.slug);
  const active = page.slug === activeSlug ? "sidebar-link active" : "sidebar-link";

  if (!children.length) {
    return `<div class="sidebar-tree-node depth-${depth}">
      <a class="${active}" href="/docs/${page.slug}">${escapeHtml(page.title)}</a>
    </div>`;
  }

  const childMarkup = children
    .map((child) => renderSidebarNode(child, allPages, activeSlug, depth + 1))
    .join("");
  const shouldOpen = hasActiveDescendant(page.slug, allPages, activeSlug) || page.slug === activeSlug;

  return `<details class="sidebar-tree-node sidebar-collapsible depth-${depth}" ${shouldOpen ? "open" : ""}>
    <summary class="sidebar-summary">
      <a class="${active}" href="/docs/${page.slug}">${escapeHtml(page.title)}</a>
      <span class="sidebar-caret" aria-hidden="true"></span>
    </summary>
    <div class="sidebar-children">
      ${childMarkup}
    </div>
  </details>`;
}

function hasActiveDescendant(parentSlug, allPages, activeSlug) {
  const children = allPages.filter((item) => (item.parentSlug || "") === parentSlug);
  for (const child of children) {
    if (child.slug === activeSlug || hasActiveDescendant(child.slug, allPages, activeSlug)) {
      return true;
    }
  }
  return false;
}

function renderDocsBreadcrumbs(pages, currentPage) {
  const trail = [];
  let cursor = currentPage;

  while (cursor) {
    trail.unshift(cursor);
    cursor = cursor.parentSlug ? pages.find((page) => page.slug === cursor.parentSlug) || null : null;
  }

  if (trail.length <= 1) {
    return "";
  }

  const sectionName = currentPage.section || "General";
  const items = [
    `<span class="docs-breadcrumb-section">${escapeHtml(sectionName)}</span>`,
    ...trail.map((page, index) => {
      const isCurrent = index === trail.length - 1;
      if (isCurrent) {
        return `<span class="docs-breadcrumb-current">${escapeHtml(page.title)}</span>`;
      }
      return `<a href="/docs/${page.slug}">${escapeHtml(page.title)}</a>`;
    }),
  ];

  return `<nav class="docs-breadcrumbs" aria-label="Breadcrumb">${items.join('<span class="docs-breadcrumb-separator" aria-hidden="true">/</span>')}</nav>`;
}

function renderDocsChildren(pages, currentPage) {
  const children = pages.filter((page) => (page.parentSlug || "") === currentPage.slug);
  if (!children.length) {
    return "";
  }

  const items = children
    .map(
      (child) => `<a class="docs-child-card" href="/docs/${child.slug}">
        <strong>${escapeHtml(child.title)}</strong>
        ${child.description ? `<span>${escapeHtml(child.description)}</span>` : `<span>Buka halaman turunan ini.</span>`}
      </a>`
    )
    .join("");

  return `<section class="docs-children">
    <div class="docs-children-header">
      <p class="sidebar-label">Subpages</p>
      <h2>Lanjut ke bagian berikutnya</h2>
    </div>
    <div class="docs-children-grid">
      ${items}
    </div>
  </section>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  let paragraph = [];
  let listItems = [];
  let codeBlock = null;
  let admonition = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushAdmonition = () => {
    if (!admonition) return;
    const body = renderMarkdown(admonition.body.join("\n"));
    html.push(`
      <div class="admonition ${admonition.type}">
        <div class="admonition-title">${escapeHtml(admonition.title || admonition.type)}</div>
        <div class="admonition-body">${body.html}</div>
      </div>
    `);
    toc.push(...body.toc);
    admonition = null;
  };

  for (const line of lines) {
    if (codeBlock) {
      if (line.startsWith("```")) {
        html.push(renderCodeBlock(codeBlock));
        codeBlock = null;
      } else {
        codeBlock.content.push(line);
      }
      continue;
    }

    if (admonition) {
      if (line.trim() === ":::") {
        flushAdmonition();
      } else {
        admonition.body.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const meta = line.replace("```", "").trim();
      const titleMatch = meta.match(/title="([^"]+)"/);
      codeBlock = {
        language: meta.split(" ")[0] || "text",
        title: titleMatch ? titleMatch[1] : "",
        content: [],
      };
      continue;
    }

    if (line.startsWith(":::")) {
      flushParagraph();
      flushList();
      const match = line.match(/^:::(\w+)\s*(.*)$/);
      admonition = {
        type: match ? match[1] : "note",
        title: match ? match[2] : "",
        body: [],
      };
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const tocText = stripInlineMarkdown(text);
      const id = slugify(text);
      toc.push({ level, text: tocText, id });
      html.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushAdmonition();

  return { html: html.join("\n"), toc };
}

function renderCodeBlock(block) {
  const title = block.title ? `<div class="code-title">${escapeHtml(block.title)}</div>` : "";
  return `<div class="code-block">${title}<pre><code data-language="${escapeHtml(block.language)}">${escapeHtml(
    block.content.join("\n")
  )}</code></pre></div>`;
}

function renderInline(text) {
  let value = escapeHtml(text);
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />');
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return value;
}

function stripInlineMarkdown(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendHtml(res, html, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendTextDownload(res, text, filename) {
  res.writeHead(200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(text);
}

function sendBinaryDownload(res, buffer, filename, contentType = "application/octet-stream") {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(buffer);
}

function redirect(res, location, statusCode = 302) {
  res.writeHead(statusCode, { Location: location });
  res.end();
}
