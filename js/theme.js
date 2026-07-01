// ============================================================================
//  Theme switcher — three design systems, EACH with a light + dark mode.
//  The look is a CSS [data-theme="…"] block (+ a wheel style in wheel.js); the
//  light/dark mode is a separate [data-mode] attribute, toggled independently.
//  Both are remembered in localStorage; changing either fires
//  "storyclub:themechange" so the app redraws the wheel.
// ============================================================================

// Three book-club design systems. The ids are historical (kept so the CSS
// [data-theme] blocks and wheel.js styles don't all have to change at once); the
// names below are what readers actually see in the Theme picker:
//   a24     -> "Default"  : clean editorial black-on-white
//   strokes -> "Web 1.0"  : loud retro Win95 / GeoCities throwback
const THEMES = [
  { id: "a24",     name: "Default", bg: "#ffffff", darkBg: "#0e0f13", accent: "#0a0a0a" },
  { id: "strokes", name: "Web 1.0", bg: "#0a1aa8", darkBg: "#05083a", accent: "#cc1f1f" },
];
const KEY = "storyclub_theme";
const MODE_KEY = "storyclub_mode";
const DEFAULT = "a24";

function saved() {
  try {
    const id = localStorage.getItem(KEY) || DEFAULT;
    return THEMES.some((t) => t.id === id) ? id : DEFAULT; // old "noir" -> default
  } catch (_) { return DEFAULT; }
}
function remember(id) { try { localStorage.setItem(KEY, id); } catch (_) {} }
// Follow the OS colour-scheme on first visit (no explicit choice saved yet), so a
// dark-mode device isn't hit with a full-white screen. Once the user toggles, that
// choice is remembered and wins from then on.
function prefersDark() {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch (_) { return false; }
}
function savedMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "dark" || m === "light") return m;
    return prefersDark() ? "dark" : "light";
  } catch (_) { return "light"; }
}
function rememberMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (_) {} }

const root = document.documentElement;
const curTheme = () => root.getAttribute("data-theme") || DEFAULT;
const isDarkMode = () => root.getAttribute("data-mode") === "dark";

// Keep the browser/PWA chrome colour in step with theme + mode.
function paintMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = THEMES.find((x) => x.id === curTheme());
  if (meta && t) meta.setAttribute("content", isDarkMode() ? (t.darkBg || "#0e0f13") : t.bg);
}

function apply(id) {
  if (!THEMES.some((t) => t.id === id)) id = DEFAULT;
  root.setAttribute("data-theme", id);
  paintMeta();
  window.dispatchEvent(new CustomEvent("storyclub:themechange", { detail: id }));
}
function applyMode(m) {
  root.setAttribute("data-mode", m === "dark" ? "dark" : "light");
  paintMeta();
  updateModeBtn();
  window.dispatchEvent(new CustomEvent("storyclub:themechange", { detail: curTheme() }));
}

function updateModeBtn() {
  const btn = document.getElementById("mode-btn");
  if (btn) btn.textContent = isDarkMode() ? "Light" : "Dark";
}
function wireMode() {
  const btn = document.getElementById("mode-btn");
  if (!btn) return;
  updateModeBtn();
  btn.addEventListener("click", () => {
    const next = isDarkMode() ? "light" : "dark";
    applyMode(next);
    rememberMode(next);
  });
}

function buildPicker() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;

  const pop = document.createElement("div");
  pop.className = "theme-pop hidden";
  pop.innerHTML = THEMES.map(
    (t) => `
    <button class="theme-opt" data-theme-id="${t.id}">
      <span class="theme-swatch" style="background: linear-gradient(135deg, ${t.bg} 0 52%, ${t.accent} 52% 100%)"></span>
      <span class="theme-name">${t.name}</span>
    </button>`
  ).join("");
  document.body.appendChild(pop);

  const mark = () => {
    const cur = curTheme();
    pop.querySelectorAll(".theme-opt").forEach((o) =>
      o.classList.toggle("active", o.dataset.themeId === cur)
    );
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  };
  const open = () => { place(); mark(); pop.classList.remove("hidden"); };
  const close = () => pop.classList.add("hidden");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.contains("hidden") ? open() : close();
  });
  pop.addEventListener("click", (e) => {
    const opt = e.target.closest(".theme-opt");
    if (!opt) return;
    apply(opt.dataset.themeId);
    remember(opt.dataset.themeId);
    mark();
    close();
  });
  document.addEventListener("click", (e) => {
    if (e.target !== btn && !pop.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  window.addEventListener("resize", () => { if (!pop.classList.contains("hidden")) place(); });
}

apply(saved());
applyMode(savedMode());
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { buildPicker(); wireMode(); });
} else {
  buildPicker();
  wireMode();
}
