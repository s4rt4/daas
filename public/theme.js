const shell = document.querySelector(".docs-shell");
const toggle = document.getElementById("theme-toggle");
const savedTheme = localStorage.getItem("docs-theme") || "light";

applyTheme(savedTheme);

toggle?.addEventListener("click", () => {
  const nextTheme = shell.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

function applyTheme(theme) {
  shell.dataset.theme = theme;
  localStorage.setItem("docs-theme", theme);
}
