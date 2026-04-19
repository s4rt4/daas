const docsSearchInput = document.getElementById("docs-search-input");
const docsSearchResults = document.getElementById("docs-search-results");

let docsSearchTimer = null;

if (docsSearchInput && docsSearchResults) {
  docsSearchInput.addEventListener("input", () => {
    clearTimeout(docsSearchTimer);
    docsSearchTimer = window.setTimeout(runDocsSearch, 180);
  });

  docsSearchInput.addEventListener("focus", () => {
    if (docsSearchInput.value.trim()) runDocsSearch();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".docs-search")) {
      docsSearchResults.hidden = true;
    }
  });
}

async function runDocsSearch() {
  const query = docsSearchInput.value.trim();
  if (!query) {
    docsSearchResults.hidden = true;
    docsSearchResults.innerHTML = "";
    return;
  }

  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    docsSearchResults.hidden = false;
    docsSearchResults.innerHTML = `<p class="docs-search-empty">Search gagal dimuat.</p>`;
    return;
  }

  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  docsSearchResults.hidden = false;
  docsSearchResults.innerHTML = results.length
    ? results.map(renderDocsSearchResult).join("")
    : `<p class="docs-search-empty">Tidak ada hasil.</p>`;
}

function renderDocsSearchResult(item) {
  return `<a class="docs-search-result" href="/docs/${escapeSearchHtml(item.slug)}">
    <span>${escapeSearchHtml(item.section || "Docs")}</span>
    <strong>${escapeSearchHtml(item.title)}</strong>
    ${item.description ? `<small>${escapeSearchHtml(item.description)}</small>` : ""}
  </a>`;
}

function escapeSearchHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
