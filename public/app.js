const state = {
  pages: [],
  sections: [],
  selectedSlug: null,
  collapsedPageSlugs: new Set(),
  collapsedSections: new Set(),
  sidebarMenu: null,
  versions: ["latest"],
  originalSlug: "",
  currentPage: null,
  sidebarSort: localStorage.getItem("editor-sidebar-sort") || "manual",
};

const pageList = document.getElementById("page-list");
const form = document.getElementById("editor-form");
const titleInput = document.getElementById("title-input");
const slugInput = document.getElementById("slug-input");
const sectionInput = document.getElementById("section-input");
const parentSelect = document.getElementById("parent-select");
const descriptionInput = document.getElementById("description-input");
const metaTitleInput = document.getElementById("meta-title-input");
const metaDescriptionInput = document.getElementById("meta-description-input");
const canonicalUrlInput = document.getElementById("canonical-url-input");
const versionInput = document.getElementById("version-input");
const previousSlugsInput = document.getElementById("previous-slugs-input");
const contentInput = document.getElementById("content-input");
const heading = document.getElementById("editor-heading");
const pageStatusLabel = document.getElementById("page-status-label");
const deleteButton = document.getElementById("delete-button");
const publishButton = document.getElementById("publish-button");
const unpublishButton = document.getElementById("unpublish-button");
const publishMenuToggle = document.getElementById("publish-menu-toggle");
const publishMenu = document.getElementById("publish-menu");
const publishSplitAction = document.getElementById("publish-split-action");
const newPageButton = document.getElementById("new-page-button");
const previewContent = document.getElementById("preview-content");
const saveStatus = document.getElementById("save-status");
const pageStatus = document.getElementById("page-status");
const sidebarToggle = document.getElementById("sidebar-toggle");
const editorModeToggle = document.getElementById("editor-mode-toggle");
const previewModeToggle = document.getElementById("preview-mode-toggle");
const copyLinkButton = document.getElementById("copy-link-button");
const duplicateButton = document.getElementById("duplicate-button");
const exportMarkdownButton = document.getElementById("export-markdown-button");
const exportZipButton = document.getElementById("export-zip-button");
const importMarkdownButton = document.getElementById("import-markdown-button");
const importMarkdownInput = document.getElementById("import-markdown-input");
const recoverDraftButton = document.getElementById("recover-draft-button");
const brokenLinkButton = document.getElementById("broken-link-button");
const slugSafetyButton = document.getElementById("slug-safety-button");
const projectSettingsButton = document.getElementById("project-settings-button");
const versioningButton = document.getElementById("versioning-button");
const commandPaletteButton = document.getElementById("command-palette-button");
const diffButton = document.getElementById("diff-button");
const pageHealthButton = document.getElementById("page-health-button");
const mediaLibraryButton = document.getElementById("media-library-button");
const templatesButton = document.getElementById("templates-button");
const redirectManagerButton = document.getElementById("redirect-manager-button");
const newSectionButton = document.getElementById("new-section-button");
const pageSearchInput = document.getElementById("page-search-input");
const pageSortSelect = document.getElementById("page-sort-select");
const sidebarSearchWrap = document.getElementById("sidebar-search-wrap");
const sidebarSearchToggle = document.getElementById("sidebar-search-toggle");
const writePanel = document.querySelector('[data-panel="write"]');
const previewPanel = document.querySelector('[data-panel="preview"]');
const richEditorRoot = document.getElementById("rich-editor");
const appModal = document.getElementById("app-modal");
const appModalTitle = document.getElementById("app-modal-title");
const appModalMessage = document.getElementById("app-modal-message");
const appModalInputWrap = document.getElementById("app-modal-input-wrap");
const appModalInput = document.getElementById("app-modal-input");
const appModalConfirm = document.getElementById("app-modal-confirm");
const appModalCancel = document.getElementById("app-modal-cancel");

let autosaveTimer = null;
let previewTimer = null;
let richEditor = null;
let syncingEditor = false;
let currentPageStatus = "draft";
let pageSearchTerm = "";
let activeModalResolver = null;
const EMERGENCY_DRAFT_PREFIX = "daas-v3-emergency-draft:";

init();

async function init() {
  initRichEditor();
  await loadPages();
  bindEvents();
}

function initRichEditor() {
  if (!richEditorRoot) return;

  if (!window.toastui || !window.toastui.Editor) {
    richEditorRoot.innerHTML =
      '<div class="editor-fallback">Rich editor gagal dimuat. File Toast UI lokal belum terbaca, coba restart server lalu refresh halaman.</div>';
    return;
  }

  const toastPlugins =
    (window.toastui &&
      window.toastui.Editor &&
      window.toastui.Editor.plugin) ||
    {};
  const editorPlugins = [];

  if (toastPlugins.colorSyntax) editorPlugins.push(toastPlugins.colorSyntax);
  if (toastPlugins.tableMergedCell) editorPlugins.push(toastPlugins.tableMergedCell);
  if (toastPlugins.chart) editorPlugins.push(toastPlugins.chart);
  if (toastPlugins.uml) editorPlugins.push(toastPlugins.uml);
  if (toastPlugins.codeSyntaxHighlight) {
    editorPlugins.push([
      toastPlugins.codeSyntaxHighlight,
      { highlighter: window.Prism || window.hljs },
    ]);
  }

  richEditor = new window.toastui.Editor({
    el: richEditorRoot,
    height: "560px",
    initialEditType: "wysiwyg",
    previewStyle: "tab",
    hideModeSwitch: false,
    usageStatistics: false,
    initialValue: contentInput.value || "",
    plugins: editorPlugins,
    toolbarItems: [
      ["heading", "bold", "italic", "strike"],
      ...(toastPlugins.colorSyntax ? [["colorSyntax"]] : []),
      ["hr", "quote"],
      ["ul", "ol", "task", "indent", "outdent"],
      ["table", "image", "link"],
      ["code", "codeblock"],
      ...(toastPlugins.tableMergedCell ? [["tableMergedCell"]] : []),
      ...(toastPlugins.chart ? [["chart"]] : []),
      ...(toastPlugins.uml ? [["uml"]] : []),
      ["scrollSync"],
    ],
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        try {
          const asset = await uploadImageFile(blob, blob.name || "image.png");
          callback(asset.url, blob.name || "image");
        } catch (error) {
          await openAlertModal({
            title: "Upload Failed",
            message:
              error && error.message
                ? error.message
                : "Gagal upload gambar.",
          });
        }
      },
    },
  });

  richEditor.on("change", () => {
    if (syncingEditor) return;
    contentInput.value = richEditor.getMarkdown();
    saveEmergencyDraft();
    queuePreview();
    queueAutosave();
  });
}

function bindEvents() {
  form.addEventListener("submit", savePage);
  deleteButton.addEventListener("click", deletePage);
  publishButton.addEventListener("click", publishPage);
  unpublishButton.addEventListener("click", unpublishPage);
  publishMenuToggle.addEventListener("click", togglePublishMenu);
  sidebarToggle.addEventListener("click", toggleSidebar);
  sidebarSearchToggle.addEventListener("click", toggleSidebarSearch);
  copyLinkButton.addEventListener("click", copyPublicLink);
  duplicateButton.addEventListener("click", duplicatePage);
  exportMarkdownButton.addEventListener("click", exportMarkdownArchive);
  exportZipButton.addEventListener("click", exportZipBackup);
  importMarkdownButton.addEventListener("click", () => importMarkdownInput.click());
  importMarkdownInput.addEventListener("change", importMarkdownArchive);
  recoverDraftButton.addEventListener("click", recoverDraftHistory);
  brokenLinkButton.addEventListener("click", runBrokenLinkChecker);
  slugSafetyButton.addEventListener("click", showSlugSafety);
  projectSettingsButton.addEventListener("click", editProjectSettings);
  versioningButton.addEventListener("click", editVersions);
  commandPaletteButton.addEventListener("click", openCommandPalette);
  diffButton.addEventListener("click", showDraftDiff);
  pageHealthButton.addEventListener("click", showPageHealth);
  mediaLibraryButton.addEventListener("click", openMediaLibrary);
  templatesButton.addEventListener("click", openTemplates);
  redirectManagerButton.addEventListener("click", openRedirectManager);
  newSectionButton.addEventListener("click", createSection);
  pageSearchInput.addEventListener("input", () => {
    pageSearchTerm = pageSearchInput.value.trim().toLowerCase();
    renderPageList();
  });
  pageSortSelect.value = ["manual", "updated", "title"].includes(state.sidebarSort) ? state.sidebarSort : "manual";
  pageSortSelect.addEventListener("change", () => {
    state.sidebarSort = pageSortSelect.value;
    localStorage.setItem("editor-sidebar-sort", state.sidebarSort);
    renderPageList();
  });
  pageSearchInput.addEventListener("blur", () => {
    if (!document.body.classList.contains("sidebar-collapsed")) return;
    window.setTimeout(() => {
      sidebarSearchWrap.classList.remove("active");
    }, 120);
  });
  editorModeToggle.addEventListener("click", () => setWorkspaceMode("write"));
  previewModeToggle.addEventListener("click", () => setWorkspaceMode("preview"));
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleGlobalShortcuts);
  appModalConfirm.addEventListener("click", handleModalConfirm);
  appModalCancel.addEventListener("click", handleModalCancel);
  appModal.addEventListener("keydown", handleModalKeydown);
  appModalMessage.addEventListener("click", handleModalMessageClick);
  appModal.querySelectorAll("[data-modal-close]").forEach((node) => {
    node.addEventListener("click", handleModalCancel);
  });

  newPageButton.addEventListener("click", () => {
    state.selectedSlug = null;
    state.currentPage = null;
    form.reset();
    sectionInput.value = state.sections[0] || "";
    parentSelect.value = "";
    descriptionInput.value = "";
    metaTitleInput.value = "";
    metaDescriptionInput.value = "";
    canonicalUrlInput.value = "";
    previousSlugsInput.value = "";
    state.originalSlug = "";
    updateHeading();
    renderVersionOptions();
    setEditorContent("");
    previewContent.innerHTML = "<p>Mulai mengetik untuk melihat preview.</p>";
    setSaveStatus("Draft baru");
    setPageStatus("draft");
    saveEmergencyDraft();
  });

  titleInput.addEventListener("input", () => {
    if (!state.selectedSlug || !slugInput.value.trim()) {
      slugInput.value = slugify(titleInput.value);
    }
    updateHeading();
    queuePreview();
    queueAutosave();
  });

  slugInput.addEventListener("input", queueAutosave);
  sectionInput.addEventListener("change", () => {
    rebuildParentOptions();
    queueAutosave();
  });
  parentSelect.addEventListener("change", queueAutosave);
  descriptionInput.addEventListener("input", () => {
    queuePreview();
    queueAutosave();
  });
  [metaTitleInput, metaDescriptionInput, canonicalUrlInput, versionInput].forEach((input) => {
    input.addEventListener("input", queueAutosave);
    input.addEventListener("change", queueAutosave);
  });
}

async function loadPages() {
  const response = await fetch("/api/pages");
  const data = await response.json();
  state.sections = Array.isArray(data.sections) ? data.sections : [];
  state.versions = Array.isArray(data.versions) && data.versions.length ? data.versions : ["latest"];
  state.pages = data.pages;
  renderSectionOptions();
  renderVersionOptions();
  rebuildParentOptions();
  renderPageList();

  const targetSlug =
    state.selectedSlug && state.pages.some((page) => page.slug === state.selectedSlug)
      ? state.selectedSlug
      : state.pages[0] && state.pages[0].slug;

  if (targetSlug) {
    await selectPage(targetSlug);
  }
}

function renderPageList() {
  if (!state.pages.length && !state.sections.length) {
    pageList.innerHTML = `<p class="empty-state">Belum ada halaman.</p>`;
    return;
  }

  const sortedPages = sortSidebarPages([...state.pages])
    .filter((page) => {
      if (!pageSearchTerm) return true;
      const haystack = [
        page.title,
        page.slug,
        page.section,
        page.description,
        page.searchText,
      ]
        .join(" ")
        .toLowerCase();
      return (
        haystack.includes(pageSearchTerm)
      );
    });

  if (!sortedPages.length && pageSearchTerm) {
    pageList.innerHTML = `<p class="empty-state">Tidak ada halaman yang cocok.</p>`;
    return;
  }

  const pinnedPages = sortedPages.filter((page) => page.pinned);
  const regularPages = sortedPages.filter((page) => !page.pinned);
  const groupedPages = groupPages(regularPages, state.sections);
  const pinnedSection = pinnedPages.length
    ? `<section class="page-group pinned-page-group">
        <div class="page-group-header">
          <span class="page-group-title">Pinned</span>
        </div>
        <div class="page-group-list">${renderEditorTree(pinnedPages.map((page) => ({ ...page, parentSlug: "" })))}</div>
      </section>`
    : "";

  pageList.innerHTML = `${pinnedSection}${groupedPages
    .map((group) => {
      const isCollapsed = state.collapsedSections.has(group.name);
      const groupContent = renderEditorTree(group.pages);
      return `<section class="page-group">
        <div class="page-group-header">
          <button class="page-group-toggle" type="button" data-action="toggle-section" data-section="${escapeHtml(group.name)}" aria-label="${isCollapsed ? "Expand section" : "Collapse section"}" title="${isCollapsed ? "Buka section" : "Tutup section"}">
            <span class="page-group-title">${escapeHtml(group.name)}</span>
            <span class="branch-caret ${isCollapsed ? "" : "expanded"}" aria-hidden="true"></span>
          </button>
          <div class="sidebar-item-menu-wrap">
            <button class="icon-button icon-button-xs sidebar-menu-toggle" type="button" data-action="toggle-section-menu" data-section="${escapeHtml(group.name)}" aria-label="Open section menu" aria-expanded="${state.sidebarMenu && state.sidebarMenu.type === "section" && state.sidebarMenu.key === group.name ? "true" : "false"}">
              <span class="sidebar-menu-dots" aria-hidden="true"></span>
            </button>
            ${renderSectionMenu(group.name)}
          </div>
        </div>
        <div class="page-group-list ${isCollapsed ? "is-collapsed" : ""}">${isCollapsed ? "" : groupContent || '<p class="section-empty-state">Belum ada halaman di section ini.</p>'}</div>
      </section>`;
    })
    .join("")}`;

  pageList.querySelectorAll("[data-action]").forEach((button) => {
    if (button.dataset.section) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handleSectionAction(button.dataset.section, button.dataset.action);
      });
      return;
    }

    if (button.dataset.slug) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handlePageAction(button.dataset.slug, button.dataset.action);
      });
      return;
    }
  });

  pageList.querySelectorAll("[data-slug]:not([data-action])").forEach((button) => {
    button.addEventListener("click", () => selectPage(button.dataset.slug));
  });
}

function sortSidebarPages(pages) {
  if (state.sidebarSort === "updated") {
    return pages.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  if (state.sidebarSort === "title") {
    return pages.sort((a, b) => a.title.localeCompare(b.title));
  }

  return pages.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function handlePageAction(slug, action) {
  if (action === "toggle-page-menu") {
    toggleSidebarMenu("page", slug);
    return;
  }

  if (action === "toggle-branch") {
    togglePageBranch(slug);
    return;
  }

  if (action === "delete-page") {
    deletePageBySlug(slug);
    return;
  }

  if (action === "pin-page" || action === "unpin-page") {
    closeSidebarMenu();
    togglePinnedPage(slug, action === "pin-page");
    return;
  }

  closeSidebarMenu();
  movePage(slug, action);
}

function handleSectionAction(sectionName, action) {
  if (action === "toggle-section-menu") {
    toggleSidebarMenu("section", sectionName);
    return;
  }

  if (action === "toggle-section") {
    if (state.collapsedSections.has(sectionName)) {
      state.collapsedSections.delete(sectionName);
    } else {
      state.collapsedSections.add(sectionName);
    }

    persistCollapsedSections();
    renderPageList();
    return;
  }

  if (action === "move-section-up" || action === "move-section-down") {
    closeSidebarMenu();
    moveSection(sectionName, action === "move-section-up" ? "up" : "down");
    return;
  }

  if (action === "delete-section") {
    closeSidebarMenu();
    deleteSection(sectionName);
  }
}

async function selectPage(slug) {
  state.selectedSlug = slug;
  renderPageList();

  const response = await fetch(`/api/page?slug=${encodeURIComponent(slug)}`);
  const page = await response.json();
  state.currentPage = page;

  titleInput.value = page.title;
  slugInput.value = page.slug;
  state.originalSlug = page.slug;
  sectionInput.value = page.section || "General";
  rebuildParentOptions(page.slug);
  parentSelect.value = page.parentSlug || "";
  descriptionInput.value = page.description || "";
  metaTitleInput.value = page.metaTitle || "";
  metaDescriptionInput.value = page.metaDescription || "";
  canonicalUrlInput.value = page.canonicalUrl || "";
  renderVersionOptions(page.version || "latest");
  previousSlugsInput.value = (page.previousSlugs || []).join(", ");
  setEditorContent(page.content || "");
  updateHeading();
  setPageStatus(page.status || "draft");
  setSaveStatus("Saved");
  await maybeRecoverEmergencyDraft(page);
  await refreshPreview();
}

async function savePage(event) {
  event.preventDefault();
  await saveDraftSilently();
  await loadPages();
  if (state.selectedSlug) {
    await selectPage(state.selectedSlug);
  }
  setSaveStatus("Saved");
}

async function deletePage() {
  if (!state.selectedSlug) return;
  await deletePageBySlug(state.selectedSlug);
}

async function deletePageBySlug(slug) {
  if (!slug) return;
  const confirmed = await openConfirmModal({
    title: "Delete Page",
    message: "Hapus halaman ini?",
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  closeSidebarMenu();

  const response = await fetch("/api/page/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Delete Failed",
      message: "Gagal menghapus halaman.",
    });
    return;
  }

  if (state.selectedSlug === slug) {
    form.reset();
    descriptionInput.value = "";
    setEditorContent("");
    updateHeading();
    state.selectedSlug = null;
    previewContent.innerHTML = "";
    setPageStatus("draft");
  }
  await loadPages();
}

async function publishPage() {
  closePublishMenu();
  if (!state.selectedSlug) {
    await openAlertModal({
      title: "Publish Page",
      message: "Simpan draft dulu sebelum publish.",
    });
    return;
  }

  await saveDraftSilently();
  const draft = getEditorMarkdown();
  const published = state.currentPage ? state.currentPage.publishedContent || "" : "";
  const review = buildPublishReview(published, draft);
  const confirmed = await openConfirmModal({
    title: currentPageStatus === "published" ? "Publish Update" : "Publish Page",
    messageHtml: renderPublishReview(review),
    confirmLabel: currentPageStatus === "published" ? "Publish Update" : "Publish",
    wide: true,
  });

  if (!confirmed) {
    setSaveStatus("Publish canceled");
    return;
  }

  const response = await fetch("/api/page/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: state.selectedSlug }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Publish Failed",
      message: "Gagal publish halaman.",
    });
    return;
  }

  const data = await response.json();
  setPageStatus(data.page.status || "published");
  setSaveStatus("Published");
  await loadPages();
  await selectPage(state.selectedSlug);
}

async function unpublishPage() {
  closePublishMenu();
  if (!state.selectedSlug) return;

  const response = await fetch("/api/page/unpublish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: state.selectedSlug }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Unpublish Failed",
      message: "Gagal unpublish halaman.",
    });
    return;
  }

  const data = await response.json();
  setPageStatus(data.page.status || "draft");
  setSaveStatus("Moved to draft");
  await loadPages();
  await selectPage(state.selectedSlug);
}

function togglePublishMenu(event) {
  event.stopPropagation();
  const isOpen = !publishMenu.hidden;
  publishMenu.hidden = isOpen;
  publishMenuToggle.setAttribute("aria-expanded", String(!isOpen));
}

function closePublishMenu() {
  publishMenu.hidden = true;
  publishMenuToggle.setAttribute("aria-expanded", "false");
}

function handleDocumentClick(event) {
  if (!publishSplitAction.contains(event.target)) {
    closePublishMenu();
  }

  if (!event.target.closest(".sidebar-item-menu-wrap")) {
    closeSidebarMenu();
  }
}

async function duplicatePage() {
  if (!state.selectedSlug) {
    await openAlertModal({
      title: "Duplicate Page",
      message: "Pilih halaman dulu untuk diduplikasi.",
    });
    return;
  }

  const response = await fetch("/api/page/duplicate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: state.selectedSlug }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Duplicate Failed",
      message: "Gagal menduplikasi halaman.",
    });
    return;
  }

  const data = await response.json();
  state.selectedSlug = data.page.slug;
  setSaveStatus("Page duplicated");
  await loadPages();
  await selectPage(data.page.slug);
}

async function copyPublicLink() {
  if (!state.selectedSlug) {
    await openAlertModal({
      title: "Copy Public Link",
      message: "Pilih halaman dulu.",
    });
    return;
  }

  if (currentPageStatus !== "published") {
    await openAlertModal({
      title: "Copy Public Link",
      message: "Publish halaman dulu sebelum menyalin link publik.",
    });
    return;
  }

  const url = `${window.location.origin}/docs/${state.selectedSlug}`;
  try {
    await navigator.clipboard.writeText(url);
    setSaveStatus("Public link copied");
  } catch {
    await openAlertModal({
      title: "Copy Public Link",
      message: url,
    });
  }
}

function exportMarkdownArchive() {
  window.location.href = "/api/export/markdown";
}

function exportZipBackup() {
  window.location.href = "/api/export/zip";
}

function buildPublishReview(before, after) {
  const beforeLines = String(before || "").split("\n");
  const afterLines = String(after || "").split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index] || "";
    const newLine = afterLines[index] || "";
    if (oldLine === newLine) continue;
    if (oldLine && newLine) {
      changed += 1;
    } else if (newLine) {
      added += 1;
    } else {
      removed += 1;
    }
  }

  const words = stripMarkdownForStats(after).split(/\s+/).filter(Boolean).length;
  const headings = String(after || "").split("\n").filter((line) => /^#{1,3}\s+/.test(line.trim())).length;

  return {
    added,
    removed,
    changed,
    words,
    headings,
    hasChanges: added + removed + changed > 0,
    preview: summarizeForPublish(after),
  };
}

function renderPublishReview(review) {
  return `<div class="publish-review">
    <p class="tool-summary">${
      review.hasChanges
        ? "Review singkat sebelum draft ini dipublish ke docs publik."
        : "Tidak ada perubahan konten yang terdeteksi, tapi kamu tetap bisa publish ulang halaman ini."
    }</p>
    <div class="publish-stat-grid">
      <div class="publish-stat"><strong>${review.added}</strong><span>Added lines</span></div>
      <div class="publish-stat"><strong>${review.changed}</strong><span>Changed lines</span></div>
      <div class="publish-stat"><strong>${review.removed}</strong><span>Removed lines</span></div>
      <div class="publish-stat"><strong>${review.words}</strong><span>Words</span></div>
    </div>
    <article class="publish-preview-card">
      <span>${review.headings} heading${review.headings === 1 ? "" : "s"} detected</span>
      <p>${escapeHtml(review.preview || "Konten kosong.")}</p>
    </article>
  </div>`;
}

function stripMarkdownForStats(markdown) {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeForPublish(markdown) {
  return stripMarkdownForStats(markdown).slice(0, 220);
}

async function importMarkdownArchive(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const confirmed = await openConfirmModal({
    title: "Import Markdown",
    message: "Import akan menambahkan halaman baru atau memperbarui halaman dengan slug yang sama. Lanjutkan?",
    confirmLabel: "Import",
  });

  if (!confirmed) {
    importMarkdownInput.value = "";
    return;
  }

  const markdown = await file.text();
  const response = await fetch("/api/import/markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
  });

  importMarkdownInput.value = "";

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    await openAlertModal({
      title: "Import Failed",
      message: data.error || "Gagal import markdown.",
    });
    return;
  }

  const data = await response.json();
  setSaveStatus(`Imported ${data.imported} page${data.imported === 1 ? "" : "s"}`);
  await loadPages();
}

async function recoverDraftHistory() {
  if (!state.selectedSlug) {
    await openAlertModal({
      title: "Draft History",
      message: "Pilih halaman dulu untuk melihat riwayat draft.",
    });
    return;
  }

  const response = await fetch(`/api/page/history?slug=${encodeURIComponent(state.selectedSlug)}`);
  if (!response.ok) {
    await openAlertModal({
      title: "Draft History",
      message: "Riwayat draft gagal dimuat.",
    });
    return;
  }

  const data = await response.json();
  const history = Array.isArray(data.history) ? data.history : [];
  if (!history.length) {
    await openAlertModal({
      title: "Draft History",
      message: "Belum ada snapshot draft untuk halaman ini.",
    });
    return;
  }

  await openAlertModal({
    title: `Draft History (${history.length})`,
    messageHtml: renderDraftHistoryList(history),
    confirmLabel: "Close",
    wide: true,
  });
}

function renderDraftHistoryList(history) {
  return `<div class="history-report">
    <p class="tool-summary">Pilih snapshot untuk mengembalikan draft halaman aktif. Restore hanya mengganti draft, tidak langsung publish.</p>
    ${history
      .slice(0, 12)
      .map((entry) => {
        const savedAt = new Date(entry.savedAt).toLocaleString();
        return `<article class="history-card">
          <div>
            <strong>${escapeHtml(entry.title || "Draft snapshot")}</strong>
            <span>${escapeHtml(savedAt)} · ${escapeHtml(entry.reason || "autosave")}</span>
            <p>${escapeHtml(entry.summary || "Tidak ada ringkasan konten.")}</p>
          </div>
          <button class="ghost-button history-restore-button" type="button" data-restore-history="${escapeHtml(entry.id)}">Restore</button>
        </article>`;
      })
      .join("")}
  </div>`;
}

async function restoreDraftSnapshot(historyId) {
  if (!state.selectedSlug || !historyId) return;
  const confirmed = await openConfirmModal({
    title: "Restore Draft",
    message: "Draft sekarang akan diganti dengan snapshot yang dipilih. Lanjutkan?",
    confirmLabel: "Restore",
  });
  if (!confirmed) return;

  const restoreResponse = await fetch("/api/page/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: state.selectedSlug, historyId }),
  });

  if (!restoreResponse.ok) {
    await openAlertModal({
      title: "Restore Failed",
      message: "Gagal restore draft.",
    });
    return;
  }

  setSaveStatus("Draft restored");
  await selectPage(state.selectedSlug);
}

async function runBrokenLinkChecker() {
  const response = await fetch("/api/tools/broken-links");
  if (!response.ok) {
    await openAlertModal({
      title: "Broken Link Checker",
      message: "Gagal menjalankan broken link checker.",
    });
    return;
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) {
    await openAlertModal({
      title: "Broken Link Checker",
      message: "Tidak ditemukan broken link di halaman docs.",
    });
    return;
  }

  await openAlertModal({
    title: `Broken Links (${results.length})`,
    messageHtml: renderBrokenLinkReport(results),
    confirmLabel: "Close",
    wide: true,
  });
}

function renderBrokenLinkReport(results) {
  const visibleResults = results.slice(0, 20);
  const hiddenCount = Math.max(results.length - visibleResults.length, 0);
  const cards = visibleResults
    .map((item, index) => {
      const fields = Array.isArray(item.fields) && item.fields.length ? item.fields.join(" + ") : "Content";
      const line = item.line ? `Line ${item.line}` : "Line tidak terdeteksi";
      const type = item.type === "image" ? "Image" : "Link";
      const pageUrl = `/docs/${item.slug}`;

      return `<article class="broken-link-card">
        <div class="broken-link-card-head">
          <span class="broken-link-index">${index + 1}</span>
          <div>
            <strong>${escapeHtml(item.page || item.slug)}</strong>
            <p>${escapeHtml(fields)} · ${escapeHtml(line)} · ${escapeHtml(type)}</p>
          </div>
        </div>
        <dl class="broken-link-detail">
          <div>
            <dt>Masalah</dt>
            <dd>${escapeHtml(item.issue || "Broken link")}</dd>
          </div>
          <div>
            <dt>Target rusak</dt>
            <dd><code>${escapeHtml(item.href || "")}</code></dd>
          </div>
          <div>
            <dt>Teks / alt</dt>
            <dd>${escapeHtml(item.label || "-")}</dd>
          </div>
          <div>
            <dt>Public URL</dt>
            <dd><code>${escapeHtml(pageUrl)}</code></dd>
          </div>
        </dl>
        <div class="broken-link-actions">
          <button class="ghost-button button-subtle broken-link-open" type="button" data-open-broken-link="${escapeHtml(item.slug)}">
            Buka halaman ini
          </button>
          <span>Perbaiki di field Content, lalu save/publish ulang.</span>
        </div>
      </article>`;
    })
    .join("");

  return `<div class="broken-link-report">
    <p class="broken-link-summary">Ditemukan ${results.length} masalah. Klik halaman terkait, lalu cari target rusak di editor Content.</p>
    ${cards}
    ${hiddenCount ? `<p class="broken-link-more">+ ${hiddenCount} masalah lain tidak ditampilkan agar modal tetap ringan.</p>` : ""}
  </div>`;
}

async function showSlugSafety() {
  if (!state.selectedSlug) {
    await openAlertModal({
      title: "Slug Change Safety",
      message: "Pilih halaman dulu untuk melihat slug safety.",
    });
    return;
  }

  const previous = previousSlugsInput.value.trim();
  await openAlertModal({
    title: "Slug Change Safety",
    message: previous
      ? `Slug lama halaman ini:\n${previous}\n\nJika URL lama dibuka, docs publik akan redirect otomatis ke slug aktif.`
      : "Belum ada slug lama. Saat kamu mengubah slug halaman ini, slug sebelumnya akan disimpan otomatis dan dibuat redirect.",
  });
}

async function editProjectSettings() {
  const response = await fetch("/api/project");
  const data = response.ok ? await response.json() : { project: {}, versions: state.versions };
  const project = data.project || {};

  const title = await openPromptModal({
    title: "Project Settings",
    message: "Nama docs publik:",
    value: project.title || "DaaS Local Docs",
    placeholder: "Nama project",
    confirmLabel: "Next",
  });
  if (!title) return;

  const description = await openPromptModal({
    title: "Project Settings",
    message: "Deskripsi docs publik:",
    value: project.description || "",
    placeholder: "Deskripsi singkat project",
    confirmLabel: "Save",
  });

  const saveResponse = await fetch("/api/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      defaultTheme: project.defaultTheme || "light",
      versions: data.versions || state.versions,
    }),
  });

  if (!saveResponse.ok) {
    await openAlertModal({ title: "Project Settings", message: "Gagal menyimpan project settings." });
    return;
  }

  setSaveStatus("Project settings saved");
}

async function editVersions() {
  const current = state.versions.join(", ");
  const value = await openPromptModal({
    title: "Versioning",
    message: "Masukkan daftar versi, pisahkan dengan koma. Contoh: latest, v1, v2",
    value: current,
    placeholder: "latest, v1",
    confirmLabel: "Save",
  });
  if (!value) return;

  const versions = value.split(",").map((item) => item.trim()).filter(Boolean);
  const response = await fetch("/api/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versions }),
  });

  if (!response.ok) {
    await openAlertModal({ title: "Versioning", message: "Gagal menyimpan versi." });
    return;
  }

  const data = await response.json();
  state.versions = Array.isArray(data.versions) && data.versions.length ? data.versions : ["latest"];
  renderVersionOptions(versionInput.value);
  setSaveStatus("Versions saved");
}

async function openCommandPalette() {
  const pageActions = state.pages
    .slice(0, 8)
    .map(
      (page) =>
        `<button class="command-item" type="button" data-command="open-page" data-slug="${escapeHtml(page.slug)}">
          <strong>${escapeHtml(page.title)}</strong>
          <span>/docs/${escapeHtml(page.slug)}</span>
        </button>`
    )
    .join("");

  await openAlertModal({
    title: "Command Palette",
    messageHtml: `<div class="command-palette">
      <button class="command-item" type="button" data-command="new-page"><strong>New Page</strong><span>Buat halaman dokumentasi baru</span></button>
      <button class="command-item" type="button" data-command="zip-backup"><strong>Export ZIP Backup</strong><span>Download docs.json, Markdown export, dan uploads</span></button>
      <button class="command-item" type="button" data-command="page-health"><strong>Page Health</strong><span>Cek kualitas halaman aktif</span></button>
      <button class="command-item" type="button" data-command="draft-diff"><strong>Compare Draft</strong><span>Lihat perubahan draft vs published</span></button>
      <button class="command-item" type="button" data-command="media-library"><strong>Media Library</strong><span>Lihat uploaded assets dan penggunaannya</span></button>
      <button class="command-item" type="button" data-command="templates"><strong>Templates</strong><span>Insert starter block ke editor</span></button>
      <button class="command-item" type="button" data-command="redirect-manager"><strong>Redirect Manager</strong><span>Kelola previous slugs</span></button>
      <button class="command-item" type="button" data-command="broken-links"><strong>Broken Link Checker</strong><span>Scan link dan gambar rusak</span></button>
      ${pageActions ? `<p class="command-section-label">Open Page</p>${pageActions}` : ""}
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

async function showDraftDiff() {
  if (!state.currentPage) {
    await openAlertModal({ title: "Compare Draft", message: "Pilih halaman dulu untuk melihat diff." });
    return;
  }

  const draft = getEditorMarkdown();
  const published = state.currentPage.publishedContent || "";
  const diff = buildLineDiff(published, draft);

  await openAlertModal({
    title: "Draft vs Published",
    messageHtml: `<div class="diff-report">
      <p class="tool-summary">Membandingkan versi live dengan isi editor saat ini.</p>
      ${diff || '<p class="tool-empty">Tidak ada perubahan konten yang terdeteksi.</p>'}
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

async function showPageHealth() {
  const checks = buildPageHealthChecks();
  const passed = checks.filter((item) => item.ok).length;
  const score = Math.round((passed / checks.length) * 100);

  await openAlertModal({
    title: `Page Health (${score})`,
    messageHtml: `<div class="health-report">
      <p class="tool-summary">${passed}/${checks.length} check lolos. Fokus perbaikan yang merah dulu.</p>
      ${checks
        .map(
          (item) => `<div class="health-item ${item.ok ? "is-ok" : "is-warning"}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.message)}</span>
          </div>`
        )
        .join("")}
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

async function openMediaLibrary() {
  const response = await fetch("/api/media");
  if (!response.ok) {
    await openAlertModal({ title: "Media Library", message: "Gagal memuat media library." });
    return;
  }

  const data = await response.json();
  const assets = Array.isArray(data.assets) ? data.assets : [];

  await openAlertModal({
    title: `Media Library (${assets.length})`,
    messageHtml: `<div class="media-report">
      <p class="tool-summary">Klik copy markdown untuk memakai asset di editor. Asset orphan berarti belum dipakai halaman mana pun.</p>
      ${
        assets.length
          ? assets
              .slice(0, 30)
              .map(
                (asset) => `<article class="media-card">
                  <img src="${escapeHtml(asset.url)}" alt="" loading="lazy" />
                  <div>
                    <strong>${escapeHtml(asset.name)}</strong>
                    <span>${formatBytes(asset.size)} · ${asset.orphan ? "Orphan" : `Dipakai ${asset.usedBy.length} halaman`}</span>
                    <code>${escapeHtml(asset.url)}</code>
                    <button class="ghost-button button-subtle media-copy-button" type="button" data-copy-markdown="${escapeHtml(`![${asset.name}](${asset.url})`)}">Copy markdown</button>
                  </div>
                </article>`
              )
              .join("")
          : '<p class="tool-empty">Belum ada uploaded asset.</p>'
      }
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

async function openTemplates() {
  const templates = getDocTemplates();
  await openAlertModal({
    title: "Templates",
    messageHtml: `<div class="template-grid">
      ${templates
        .map(
          (template) => `<button class="template-card" type="button" data-insert-template="${escapeHtml(template.id)}">
            <strong>${escapeHtml(template.title)}</strong>
            <span>${escapeHtml(template.description)}</span>
          </button>`
        )
        .join("")}
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

async function openRedirectManager() {
  const response = await fetch("/api/redirects");
  if (!response.ok) {
    await openAlertModal({ title: "Redirect Manager", message: "Gagal memuat redirect manager." });
    return;
  }

  const data = await response.json();
  const redirects = Array.isArray(data.redirects) ? data.redirects : [];
  await openAlertModal({
    title: `Redirect Manager (${redirects.length})`,
    messageHtml: `<div class="redirect-report">
      <p class="tool-summary">Previous slug akan redirect ke slug aktif di public docs.</p>
      <button class="primary-button redirect-add-button" type="button" data-command="add-redirect">Add redirect for current page</button>
      ${
        redirects.length
          ? redirects
              .map(
                (item) => `<article class="redirect-card">
                  <div>
                    <strong>${escapeHtml(item.previousSlug)} → ${escapeHtml(item.slug)}</strong>
                    <span>${escapeHtml(item.title)} · ${escapeHtml(item.status)}</span>
                  </div>
                  <button class="ghost-button button-subtle" type="button" data-delete-redirect="${escapeHtml(item.previousSlug)}" data-slug="${escapeHtml(item.slug)}">Delete</button>
                </article>`
              )
              .join("")
          : '<p class="tool-empty">Belum ada redirect slug lama.</p>'
      }
    </div>`,
    confirmLabel: "Close",
    wide: true,
  });
}

function renderVersionOptions(selectedValue = versionInput.value || "latest") {
  const versions = state.versions.length ? state.versions : ["latest"];
  versionInput.innerHTML = versions
    .map((version) => `<option value="${escapeHtml(version)}">${escapeHtml(version)}</option>`)
    .join("");
  versionInput.value = versions.includes(selectedValue) ? selectedValue : versions[0];
}

function getEditorMarkdown() {
  return richEditor ? richEditor.getMarkdown() : contentInput.value || "";
}

function buildLineDiff(before, after) {
  const beforeLines = String(before || "").split("\n");
  const afterLines = String(after || "").split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const rows = [];

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index] || "";
    const newLine = afterLines[index] || "";
    if (oldLine === newLine) continue;
    if (oldLine) rows.push(`<div class="diff-line removed"><span>-</span><code>${escapeHtml(oldLine)}</code></div>`);
    if (newLine) rows.push(`<div class="diff-line added"><span>+</span><code>${escapeHtml(newLine)}</code></div>`);
    if (rows.length >= 80) {
      rows.push('<p class="tool-summary">Diff dipotong agar modal tetap ringan.</p>');
      break;
    }
  }

  return rows.join("");
}

function buildPageHealthChecks() {
  const content = getEditorMarkdown();
  const links = Array.from(content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)).map((match) => match[1]);
  const h1Count = (content.match(/^#\s+/gm) || []).length;
  const title = titleInput.value.trim();
  const slug = slugInput.value.trim();

  return [
    {
      title: "Title",
      ok: title.length >= 3 && title.length <= 72,
      message: title ? "Panjang title cukup aman." : "Title masih kosong.",
    },
    {
      title: "Slug",
      ok: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
      message: slug ? "Slug URL-friendly." : "Slug masih kosong.",
    },
    {
      title: "Description",
      ok: descriptionInput.value.trim().length >= 30,
      message: "Description membantu search dan SEO preview.",
    },
    {
      title: "Meta Description",
      ok: metaDescriptionInput.value.trim().length === 0 || metaDescriptionInput.value.trim().length <= 160,
      message: "Meta description idealnya di bawah 160 karakter.",
    },
    {
      title: "Heading H1",
      ok: h1Count === 1,
      message: h1Count === 1 ? "Ada satu H1." : `Terdeteksi ${h1Count} H1. Idealnya tepat satu.`,
    },
    {
      title: "Content Length",
      ok: content.trim().length >= 250,
      message: "Konten minimal sudah cukup untuk halaman docs.",
    },
    {
      title: "Images & Links",
      ok: links.every((href) => href.trim().length > 0),
      message: links.length ? `${links.length} link/image terdeteksi.` : "Belum ada link atau gambar.",
    },
    {
      title: "Publish State",
      ok: currentPageStatus === "published",
      message: currentPageStatus === "published" ? "Halaman sudah published." : "Halaman masih draft.",
    },
  ];
}

function getDocTemplates() {
  return [
    {
      id: "api",
      title: "API Endpoint",
      description: "Struktur endpoint, parameter, response, dan error.",
      content: "\n## Endpoint\n\n`GET /api/example`\n\n## Parameter\n\n| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n| `id` | string | yes | Identifier resource |\n\n## Response\n\n```json\n{\n  \"ok\": true\n}\n```\n",
    },
    {
      id: "guide",
      title: "Step-by-step Guide",
      description: "Template tutorial berurutan.",
      content: "\n## Tujuan\n\nJelaskan hasil akhir yang akan dicapai user.\n\n## Prasyarat\n\n* Akses ke dashboard\n* Data contoh\n\n## Langkah\n\n1. Buka halaman terkait.\n2. Ikuti instruksi utama.\n3. Verifikasi hasilnya.\n\n## Troubleshooting\n\n:::tip\nTambahkan solusi untuk kasus yang paling sering terjadi.\n:::\n",
    },
    {
      id: "faq",
      title: "FAQ",
      description: "Pertanyaan dan jawaban ringkas.",
      content: "\n## FAQ\n\n### Pertanyaan pertama?\n\nJawaban singkat dan jelas.\n\n### Pertanyaan kedua?\n\nJawaban singkat dan jelas.\n",
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      description: "Masalah, penyebab, dan solusi.",
      content: "\n## Gejala\n\nJelaskan apa yang user lihat.\n\n## Penyebab umum\n\n* Konfigurasi belum lengkap\n* Data belum tersimpan\n* Cache masih lama\n\n## Solusi\n\n1. Cek konfigurasi.\n2. Ulangi langkah utama.\n3. Refresh halaman.\n",
    },
    {
      id: "changelog",
      title: "Changelog",
      description: "Catatan perubahan versi.",
      content: "\n## Changelog\n\n### Unreleased\n\n#### Added\n\n* Fitur baru.\n\n#### Changed\n\n* Perubahan perilaku.\n\n#### Fixed\n\n* Bug yang diperbaiki.\n",
    },
    {
      id: "overview",
      title: "Product Overview",
      description: "Ringkasan fitur dan use case.",
      content: "\n## Overview\n\nJelaskan produk secara singkat.\n\n## Use Case\n\n* Use case pertama\n* Use case kedua\n* Use case ketiga\n\n## Batasan\n\nJelaskan hal yang belum didukung agar ekspektasi user jelas.\n",
    },
  ];
}

function insertTemplate(templateId) {
  const template = getDocTemplates().find((item) => item.id === templateId);
  if (!template) return;

  insertIntoEditor(`\n${template.content}`);
  setSaveStatus("Template inserted");
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "waktu tidak diketahui" : date.toLocaleString();
}

async function uploadImageFile(file, fallbackName) {
  const formData = new FormData();
  formData.append("file", file, fallbackName || file.name || "image.png");

  const response = await fetch("/api/assets/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Upload Failed",
      message: "Gagal upload gambar.",
    });
    throw new Error("Gagal upload gambar.");
  }

  const data = await response.json();
  return data.asset;
}

async function movePage(slug, direction) {
  const response = await fetch("/api/pages/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, direction }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Reorder Failed",
      message: "Gagal mengubah urutan halaman.",
    });
    return;
  }

  await loadPages();
}

async function togglePinnedPage(slug, pinned) {
  const response = await fetch("/api/page/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, pinned }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Pin Failed",
      message: "Gagal mengubah status pinned halaman.",
    });
    return;
  }

  await loadPages();
}

function queueAutosave() {
  saveEmergencyDraft();
  setSaveStatus("Saving...");
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(async () => {
    if (!canAutosave()) {
      setSaveStatus("Isi title dan slug untuk autosave");
      return;
    }

    try {
      await saveDraftSilently();
      setSaveStatus("Saved");
      await loadPages();
    } catch {
      setSaveStatus("Autosave gagal");
    }
  }, 700);
}

function queuePreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    refreshPreview();
  }, 180);
}

async function refreshPreview() {
  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: contentInput.value }),
  });

  if (!response.ok) {
    previewContent.innerHTML = "<p>Preview gagal dimuat.</p>";
    return;
  }

  const data = await response.json();
  previewContent.innerHTML = renderPreviewShell(data);
}

function canAutosave() {
  return Boolean(titleInput.value.trim() && slugInput.value.trim());
}

function currentPayload() {
  return {
    originalSlug: state.originalSlug || state.selectedSlug || "",
    title: titleInput.value,
    slug: slugInput.value,
    section: sectionInput.value || state.sections[0] || "General",
    parentSlug: parentSelect.value || "",
    description: descriptionInput.value,
    metaTitle: metaTitleInput.value,
    metaDescription: metaDescriptionInput.value,
    canonicalUrl: canonicalUrlInput.value,
    version: versionInput.value || "latest",
    content: contentInput.value,
  };
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
}

function setPageStatus(status) {
  currentPageStatus = status;
  pageStatusLabel.textContent = status === "published" ? "Published" : "Draft";
  pageStatus.className = `page-status ${status === "published" ? "published" : "draft"}`;
}

function setEditorContent(value) {
  const markdown = value || "";
  contentInput.value = markdown;
  if (!richEditor) return;
  syncingEditor = true;
  richEditor.setMarkdown(markdown, false);
  window.setTimeout(() => {
    syncingEditor = false;
  }, 0);
}

function getEmergencyDraftKey(slug = "") {
  const stableSlug = String(slug || state.originalSlug || state.selectedSlug || slugInput.value || "__new").trim() || "__new";
  return `${EMERGENCY_DRAFT_PREFIX}${stableSlug}`;
}

function getEmergencyDraftCandidateKeys(page = state.currentPage || {}) {
  return Array.from(
    new Set([
      getEmergencyDraftKey(page.slug),
      getEmergencyDraftKey(state.originalSlug),
      getEmergencyDraftKey(state.selectedSlug),
      getEmergencyDraftKey(slugInput.value),
      `${EMERGENCY_DRAFT_PREFIX}__new`,
    ])
  );
}

function saveEmergencyDraft() {
  try {
    const payload = currentPayload();
    const hasMeaningfulDraft = payload.title.trim() || payload.slug.trim() || payload.content.trim();
    if (!hasMeaningfulDraft) return;

    localStorage.setItem(
      getEmergencyDraftKey(payload.originalSlug || payload.slug),
      JSON.stringify({
        ...payload,
        savedAt: new Date().toISOString(),
      })
    );
  } catch {
    // localStorage can fail in private mode or when quota is full.
  }
}

function clearEmergencyDrafts(page = state.currentPage || {}) {
  try {
    for (const key of getEmergencyDraftCandidateKeys(page)) {
      localStorage.removeItem(key);
    }
  } catch {
    // Safe to ignore; this backup layer should never block primary saves.
  }
}

function readEmergencyDraft(page = state.currentPage || {}) {
  try {
    return getEmergencyDraftCandidateKeys(page)
      .map((key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const draft = JSON.parse(raw);
        return draft && draft.savedAt ? { ...draft, storageKey: key } : null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0] || null;
  } catch {
    return null;
  }
}

async function maybeRecoverEmergencyDraft(page) {
  const draft = readEmergencyDraft(page);
  if (!draft) return;

  const draftTime = new Date(draft.savedAt).getTime();
  const serverTime = new Date(page.updatedAt || 0).getTime();
  const hasNewerDraft = draftTime > serverTime + 1000;
  const isDifferent =
    draft.title !== page.title ||
    draft.slug !== page.slug ||
    draft.content !== (page.content || "") ||
    draft.description !== (page.description || "");

  if (!hasNewerDraft || !isDifferent) {
    clearEmergencyDrafts(page);
    return;
  }

  const confirmed = await openConfirmModal({
    title: "Recover Local Draft",
    message: `Ada draft lokal yang lebih baru dari server (${formatDateTime(draft.savedAt)}). Pulihkan draft ini?`,
    confirmLabel: "Recover",
  });

  if (!confirmed) return;
  applyEmergencyDraft(draft);
}

function applyEmergencyDraft(draft) {
  titleInput.value = draft.title || "";
  slugInput.value = draft.slug || "";
  sectionInput.value = draft.section || sectionInput.value || state.sections[0] || "General";
  rebuildParentOptions(state.originalSlug || state.selectedSlug);
  parentSelect.value = draft.parentSlug || "";
  descriptionInput.value = draft.description || "";
  metaTitleInput.value = draft.metaTitle || "";
  metaDescriptionInput.value = draft.metaDescription || "";
  canonicalUrlInput.value = draft.canonicalUrl || "";
  renderVersionOptions(draft.version || "latest");
  setEditorContent(draft.content || "");
  updateHeading();
  setSaveStatus("Recovered local draft");
  queuePreview();
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  if (!collapsed) {
    sidebarSearchWrap.classList.remove("active");
  }
  localStorage.setItem("editor-sidebar-collapsed", collapsed ? "1" : "0");
}

function toggleSidebarSearch() {
  if (!document.body.classList.contains("sidebar-collapsed")) {
    pageSearchInput.focus();
    return;
  }

  sidebarSearchWrap.classList.toggle("active");
  if (sidebarSearchWrap.classList.contains("active")) {
    window.setTimeout(() => pageSearchInput.focus(), 0);
  }
}

(function restoreSidebarState() {
  const collapsed = localStorage.getItem("editor-sidebar-collapsed") === "1";
  if (collapsed) {
    document.body.classList.add("sidebar-collapsed");
  }
})();

(function restoreCollapsedBranches() {
  try {
    const raw = JSON.parse(localStorage.getItem("editor-collapsed-page-branches") || "[]");
    state.collapsedPageSlugs = new Set(Array.isArray(raw) ? raw : []);
  } catch {
    state.collapsedPageSlugs = new Set();
  }
})();

(function restoreCollapsedSections() {
  try {
    const raw = JSON.parse(localStorage.getItem("editor-collapsed-sections") || "[]");
    state.collapsedSections = new Set(Array.isArray(raw) ? raw : []);
  } catch {
    state.collapsedSections = new Set();
  }
})();

(function restoreWorkspaceMode() {
  const mode = localStorage.getItem("editor-workspace-mode") || "write";
  setWorkspaceMode(mode);
})();

function renderPreviewShell(data) {
  const title = escapeHtml(titleInput.value.trim() || "Untitled Page");
  const article = data.html || "<p>Mulai mengetik untuk melihat preview.</p>";
  const description = descriptionInput.value.trim();

  return `<div class="preview-docs-shell">
    <div class="preview-docs-navbar">
      <div>
        <p class="eyebrow">Docs preview</p>
        <strong>${title}</strong>
      </div>
      <span class="preview-badge">${escapeHtml(slugInput.value.trim() || "draft-page")}</span>
    </div>
    <div class="preview-main">
      <article class="docs-prose preview-prose">
        ${description ? `<p class="preview-description">${escapeHtml(description)}</p>` : ""}
        ${article}
      </article>
    </div>
  </div>`;
}

function renderSectionMenu(sectionName) {
  const isOpen =
    state.sidebarMenu &&
    state.sidebarMenu.type === "section" &&
    state.sidebarMenu.key === sectionName;

  if (!isOpen) return "";

  return `<div class="sidebar-item-menu" role="menu">
    <button class="sidebar-item-menu-action" type="button" data-action="move-section-up" data-section="${escapeHtml(sectionName)}" role="menuitem">Move Up</button>
    <button class="sidebar-item-menu-action" type="button" data-action="move-section-down" data-section="${escapeHtml(sectionName)}" role="menuitem">Move Down</button>
    <button class="sidebar-item-menu-action is-danger" type="button" data-action="delete-section" data-section="${escapeHtml(sectionName)}" role="menuitem">Delete</button>
  </div>`;
}

function renderPageMenu(page, canOutdent) {
  const isOpen =
    state.sidebarMenu &&
    state.sidebarMenu.type === "page" &&
    state.sidebarMenu.key === page.slug;

  if (!isOpen) return "";

  return `<div class="sidebar-item-menu" role="menu">
    <button class="sidebar-item-menu-action" type="button" data-action="${page.pinned ? "unpin-page" : "pin-page"}" data-slug="${page.slug}" role="menuitem">${page.pinned ? "Unpin Page" : "Pin Page"}</button>
    <button class="sidebar-item-menu-action" type="button" data-action="up" data-slug="${page.slug}" role="menuitem">Move Up</button>
    <button class="sidebar-item-menu-action" type="button" data-action="down" data-slug="${page.slug}" role="menuitem">Move Down</button>
    <button class="sidebar-item-menu-action" type="button" data-action="indent" data-slug="${page.slug}" role="menuitem">Make Sub-page</button>
    <button class="sidebar-item-menu-action" type="button" data-action="outdent" data-slug="${page.slug}" role="menuitem" ${canOutdent ? "" : "disabled"}>Move Out</button>
    <button class="sidebar-item-menu-action is-danger" type="button" data-action="delete-page" data-slug="${page.slug}" role="menuitem">Delete</button>
  </div>`;
}

function toggleSidebarMenu(type, key) {
  if (state.sidebarMenu && state.sidebarMenu.type === type && state.sidebarMenu.key === key) {
    state.sidebarMenu = null;
  } else {
    state.sidebarMenu = { type, key };
  }

  renderPageList();
}

function closeSidebarMenu() {
  if (!state.sidebarMenu) return;
  state.sidebarMenu = null;
  renderPageList();
}

function setWorkspaceMode(mode) {
  const isPreview = mode === "preview";
  writePanel.classList.toggle("active", !isPreview);
  previewPanel.classList.toggle("active", isPreview);
  editorModeToggle.classList.toggle("active", !isPreview);
  previewModeToggle.classList.toggle("active", isPreview);
  editorModeToggle.setAttribute("aria-pressed", String(!isPreview));
  previewModeToggle.setAttribute("aria-pressed", String(isPreview));
  localStorage.setItem("editor-workspace-mode", isPreview ? "preview" : "write");
  updateHeading();
  if (isPreview) {
    refreshPreview();
  }
}

function updateHeading() {
  const isPreview = previewPanel.classList.contains("active");
  const title = titleInput.value.trim() || (state.selectedSlug ? "Untitled Page" : "New Page");
  heading.textContent = `${isPreview ? "Preview" : "Editing"}: ${title}`;
}

async function saveDraftSilently() {
  if (!canAutosave()) return;
  const previousPage = { slug: state.originalSlug || state.selectedSlug || slugInput.value || "__new" };
  const response = await fetch("/api/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentPayload()),
  });

  if (!response.ok) {
    throw new Error("Failed to save draft");
  }

  const data = await response.json();
  state.selectedSlug = data.page.slug;
  state.originalSlug = data.page.slug;
  state.currentPage = { ...(state.currentPage || {}), ...data.page, content: data.page.draftContent || "" };
  setPageStatus(data.page.status || currentPageStatus);
  clearEmergencyDrafts(previousPage);
  clearEmergencyDrafts(data.page);
}

function insertIntoEditor(markdown) {
  if (richEditor && typeof richEditor.insertText === "function") {
    richEditor.insertText(markdown);
    return;
  }

  const next = `${contentInput.value || ""}${markdown}`;
  setEditorContent(next);
  queuePreview();
  queueAutosave();
}

function groupPages(pages, sectionOrder = []) {
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
    ...sectionOrder.filter((name) => !map.has(name)),
    ...Array.from(map.keys()).filter((name) => !sectionOrder.includes(name)),
  ];
  return orderedNames.map((name) => ({ name, pages: map.get(name) || [] }));
}

function renderEditorTree(pages, parentSlug = "", depth = 0) {
  return pages
    .filter((page) => (page.parentSlug || "") === parentSlug)
    .map((page) => {
      const active = page.slug === state.selectedSlug ? "page-card active" : "page-card";
      const titleClass = page.title.length > 20 ? "page-line is-scrollable" : "page-line";
      const hasChildren = pages.some((item) => (item.parentSlug || "") === page.slug);
        const branchLockedOpen = hasSelectedDescendant(page.slug);
        const isCollapsed = hasChildren && state.collapsedPageSlugs.has(page.slug) && !branchLockedOpen;
        const children = hasChildren && !isCollapsed ? renderEditorTree(pages, page.slug, depth + 1) : "";
        const canOutdent = Boolean(page.parentSlug);
        const isPageMenuOpen =
          state.sidebarMenu &&
          state.sidebarMenu.type === "page" &&
          state.sidebarMenu.key === page.slug;
        return `<div class="page-tree-node depth-${depth}">
          <div class="${active}" data-title="${escapeHtml(page.title)}">
            ${
              hasChildren
                ? `<button class="icon-button page-branch-toggle" type="button" data-action="toggle-branch" data-slug="${page.slug}" aria-label="${isCollapsed ? "Expand child pages" : "Collapse child pages"}" title="${isCollapsed ? "Buka child pages" : "Tutup child pages"}">
                  <span class="branch-caret ${isCollapsed ? "" : "expanded"}" aria-hidden="true"></span>
                </button>`
              : `<span class="page-branch-spacer" aria-hidden="true"></span>`
          }
            <div class="page-card-body">
                <button class="page-card-main" data-slug="${page.slug}">
                  <strong class="${titleClass}" title="${escapeHtml(page.title)}">
                    <span class="page-status-marker ${page.status || "draft"}" title="${page.status === "published" ? "Published" : "Draft"}" aria-label="${page.status === "published" ? "Published" : "Draft"}"></span>
                    <span class="page-title-text">${escapeHtml(page.title)}</span>
                  </strong>
                </button>
                <div class="page-card-meta">
                  <div class="page-card-actions sidebar-item-controls ${isPageMenuOpen ? "is-open" : ""}">
                    <div class="sidebar-item-menu-wrap ${isPageMenuOpen ? "is-open" : ""}">
                      <button class="icon-button sidebar-menu-toggle" type="button" data-action="toggle-page-menu" data-slug="${page.slug}" aria-label="Open page menu" aria-expanded="${isPageMenuOpen ? "true" : "false"}">
                        <span class="sidebar-menu-dots" aria-hidden="true"></span>
                      </button>
                      ${renderPageMenu(page, canOutdent)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          ${children}
        </div>`;
    })
    .join("");
}

function togglePageBranch(slug) {
  if (state.collapsedPageSlugs.has(slug)) {
    state.collapsedPageSlugs.delete(slug);
  } else {
    state.collapsedPageSlugs.add(slug);
  }

  persistCollapsedBranches();
  renderPageList();
}

function hasSelectedDescendant(parentSlug) {
  if (!state.selectedSlug) {
    return false;
  }

  return isDescendantSlug(state.selectedSlug, parentSlug);
}

function persistCollapsedBranches() {
  localStorage.setItem("editor-collapsed-page-branches", JSON.stringify(Array.from(state.collapsedPageSlugs)));
}

function persistCollapsedSections() {
  localStorage.setItem("editor-collapsed-sections", JSON.stringify(Array.from(state.collapsedSections)));
}

function rebuildParentOptions(currentSlug = state.selectedSlug) {
  const currentSection = sectionInput.value || state.sections[0] || "General";
  const pages = state.pages
    .filter(
      (page) =>
        page.slug !== currentSlug &&
        (page.section || "General") === currentSection &&
        !isDescendantSlug(page.slug, currentSlug)
    )
    .sort((a, b) => a.title.localeCompare(b.title));

  const selected = parentSelect.value;
  parentSelect.innerHTML = `<option value="">No parent</option>${pages
    .map((page) => `<option value="${escapeHtml(page.slug)}">${escapeHtml(page.title)}</option>`)
    .join("")}`;
  parentSelect.value = pages.some((page) => page.slug === selected) ? selected : "";
}

function renderSectionOptions(selectedValue = sectionInput.value) {
  const options = state.sections.length ? state.sections : ["General"];
  sectionInput.innerHTML = options
    .map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`)
    .join("");
  sectionInput.value = options.includes(selectedValue) ? selectedValue : options[0];
}

async function createSection() {
  const nextName = await openPromptModal({
    title: "New Section",
    message: "Masukkan nama section baru untuk sidebar dokumentasi.",
    placeholder: "Mis. Guides atau API Reference",
    confirmLabel: "Create",
  });
  if (!nextName) {
    return;
  }

  const response = await fetch("/api/sections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nextName }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    await openAlertModal({
      title: "Section Failed",
      message: data.error || "Gagal membuat section.",
    });
    return;
  }

  const data = await response.json();
  state.sections = Array.isArray(data.sections) ? data.sections : state.sections;
  renderSectionOptions(nextName.trim().replace(/\s+/g, " "));
  rebuildParentOptions();
  queueAutosave();
}

async function moveSection(name, direction) {
  const response = await fetch("/api/sections/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, direction }),
  });

  if (!response.ok) {
    await openAlertModal({
      title: "Section Reorder Failed",
      message: "Gagal mengubah urutan section.",
    });
    return;
  }

  const data = await response.json();
  state.sections = Array.isArray(data.sections) ? data.sections : state.sections;
  renderPageList();
  renderSectionOptions(sectionInput.value);
}

async function deleteSection(name) {
  const confirmed = await openConfirmModal({
    title: "Delete Section",
    message: `Hapus section "${name}"? Section hanya bisa dihapus kalau sudah kosong.`,
    confirmLabel: "Delete",
  });
  if (!confirmed) {
    return;
  }

  const response = await fetch("/api/sections/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    await openAlertModal({
      title: "Section Delete Failed",
      message: data.error || "Gagal menghapus section.",
    });
    return;
  }

  const data = await response.json();
  state.sections = Array.isArray(data.sections) ? data.sections : state.sections;
  state.collapsedSections.delete(name);
  persistCollapsedSections();
  renderSectionOptions();
  rebuildParentOptions();
  renderPageList();
}

function openModal({
  title,
  message,
  messageHtml = "",
  mode = "alert",
  value = "",
  placeholder = "",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  wide = false,
}) {
  closePublishMenu();
  appModal.hidden = false;
  appModal.classList.toggle("modal-wide", wide);
  appModalTitle.textContent = title;
  if (messageHtml) {
    appModalMessage.innerHTML = messageHtml;
  } else {
    appModalMessage.textContent = message || "";
  }
  appModalConfirm.textContent = confirmLabel;
  appModalCancel.textContent = cancelLabel;
  appModalInputWrap.hidden = mode !== "prompt";
  appModalCancel.hidden = mode === "alert";
  appModalInput.value = value;
  appModalInput.placeholder = placeholder;

  return new Promise((resolve) => {
    activeModalResolver = { resolve, mode };
    window.setTimeout(() => {
      if (mode === "prompt") {
        appModalInput.focus();
        appModalInput.select();
      } else {
        appModalConfirm.focus();
      }
    }, 0);
  });
}

function closeModal() {
  appModal.hidden = true;
  appModal.classList.remove("modal-wide");
  appModalMessage.textContent = "";
  activeModalResolver = null;
}

function handleModalConfirm() {
  if (!activeModalResolver) return;
  const { resolve, mode } = activeModalResolver;
  const result = mode === "prompt" ? appModalInput.value.trim() : true;
  closeModal();
  resolve(result);
}

function handleModalCancel() {
  if (!activeModalResolver) return;
  const { resolve, mode } = activeModalResolver;
  closeModal();
  resolve(mode === "prompt" ? "" : false);
}

function handleModalKeydown(event) {
  if (!activeModalResolver) return;
  if (event.key === "Escape") {
    event.preventDefault();
    handleModalCancel();
    return;
  }
  if (event.key === "Enter" && activeModalResolver.mode === "prompt") {
    event.preventDefault();
    handleModalConfirm();
  }
}

function handleModalMessageClick(event) {
  const commandButton = event.target.closest("[data-command]");
  if (commandButton) {
    const command = commandButton.dataset.command;
    const slug = commandButton.dataset.slug || "";
    const resolver = activeModalResolver;
    closeModal();
    if (resolver) resolver.resolve(true);
    executeCommand(command, slug);
    return;
  }

  const templateButton = event.target.closest("[data-insert-template]");
  if (templateButton) {
    const resolver = activeModalResolver;
    closeModal();
    if (resolver) resolver.resolve(true);
    insertTemplate(templateButton.dataset.insertTemplate);
    return;
  }

  const copyButton = event.target.closest("[data-copy-markdown]");
  if (copyButton) {
    navigator.clipboard.writeText(copyButton.dataset.copyMarkdown || "");
    copyButton.textContent = "Copied";
    return;
  }

  const deleteRedirectButton = event.target.closest("[data-delete-redirect]");
  if (deleteRedirectButton) {
    const resolver = activeModalResolver;
    closeModal();
    if (resolver) resolver.resolve(true);
    deleteRedirect(deleteRedirectButton.dataset.slug, deleteRedirectButton.dataset.deleteRedirect);
    return;
  }

  const restoreHistoryButton = event.target.closest("[data-restore-history]");
  if (restoreHistoryButton) {
    const historyId = restoreHistoryButton.dataset.restoreHistory;
    const resolver = activeModalResolver;
    closeModal();
    if (resolver) resolver.resolve(true);
    restoreDraftSnapshot(historyId);
    return;
  }

  const button = event.target.closest("[data-open-broken-link]");
  if (!button) return;

  const slug = button.dataset.openBrokenLink;
  if (!slug) return;

  const resolver = activeModalResolver;
  closeModal();
  if (resolver) {
    resolver.resolve(true);
  }
  selectPage(slug);
}

function handleGlobalShortcuts(event) {
  const key = event.key.toLowerCase();
  const isMod = event.ctrlKey || event.metaKey;

  if (isMod && key === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }

  if (isMod && key === "s") {
    event.preventDefault();
    if (!canAutosave()) {
      setSaveStatus("Isi title dan slug untuk save");
      return;
    }

    saveDraftSilently()
      .then(() => {
        setSaveStatus("Saved");
        return loadPages();
      })
      .catch(() => setSaveStatus("Save gagal"));
    return;
  }

  if (isMod && event.shiftKey && key === "p") {
    event.preventDefault();
    publishPage();
    return;
  }

  if (isMod && event.shiftKey && key === "d") {
    event.preventDefault();
    showDraftDiff();
    return;
  }

  if (isMod && event.shiftKey && key === "h") {
    event.preventDefault();
    recoverDraftHistory();
    return;
  }

  if (event.altKey && key === "n") {
    event.preventDefault();
    newPageButton.click();
  }
}

function executeCommand(command, slug = "") {
  if (command === "new-page") {
    newPageButton.click();
    return;
  }
  if (command === "open-page" && slug) {
    selectPage(slug);
    return;
  }
  if (command === "zip-backup") return exportZipBackup();
  if (command === "page-health") return showPageHealth();
  if (command === "draft-diff") return showDraftDiff();
  if (command === "media-library") return openMediaLibrary();
  if (command === "templates") return openTemplates();
  if (command === "redirect-manager") return openRedirectManager();
  if (command === "broken-links") return runBrokenLinkChecker();
  if (command === "add-redirect") return addRedirectForCurrentPage();
}

async function addRedirectForCurrentPage() {
  if (!state.selectedSlug) {
    await openAlertModal({ title: "Redirect Manager", message: "Pilih halaman dulu sebelum menambah redirect." });
    return;
  }

  const previousSlug = await openPromptModal({
    title: "Add Redirect",
    message: "Masukkan slug lama yang harus redirect ke halaman ini.",
    placeholder: "slug-lama",
    confirmLabel: "Add",
  });
  if (!previousSlug) return;

  const response = await fetch("/api/redirects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", slug: state.selectedSlug, previousSlug }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    await openAlertModal({ title: "Redirect Failed", message: data.error || "Gagal menambah redirect." });
    return;
  }

  await selectPage(state.selectedSlug);
  setSaveStatus("Redirect added");
}

async function deleteRedirect(slug, previousSlug) {
  const response = await fetch("/api/redirects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", slug, previousSlug }),
  });

  if (!response.ok) {
    await openAlertModal({ title: "Redirect Failed", message: "Gagal menghapus redirect." });
    return;
  }

  if (state.selectedSlug === slug) {
    await selectPage(slug);
  }
  setSaveStatus("Redirect deleted");
}

function openAlertModal({ title, message, messageHtml = "", confirmLabel = "OK", wide = false }) {
  return openModal({ title, message, messageHtml, mode: "alert", confirmLabel, wide });
}

function openConfirmModal({ title, message, messageHtml = "", confirmLabel = "OK", cancelLabel = "Cancel", wide = false }) {
  return openModal({ title, message, messageHtml, mode: "confirm", confirmLabel, cancelLabel, wide });
}

function openPromptModal({ title, message, value = "", placeholder = "", confirmLabel = "OK", cancelLabel = "Cancel" }) {
  return openModal({ title, message, mode: "prompt", value, placeholder, confirmLabel, cancelLabel });
}

function isDescendantSlug(candidateSlug, ancestorSlug) {
  if (!candidateSlug || !ancestorSlug) {
    return false;
  }

  let cursor = state.pages.find((page) => page.slug === candidateSlug) || null;
  while (cursor && cursor.parentSlug) {
    if (cursor.parentSlug === ancestorSlug) {
      return true;
    }
    cursor = state.pages.find((page) => page.slug === cursor.parentSlug) || null;
  }

  return false;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
