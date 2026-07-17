// Shared utilities used across pages
const CHART_COLORS = {
  actual: "#2F5233",
  predicted: "#A3792F",
  grid: "rgba(28,42,63,0.08)",
  text: "#5B6B85",
};

function fmtNum(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-US");
}

function stampHtml(source) {
  if (source === "Predicted") {
    return `<span class="stamp stamp-predicted">Predicted</span>`;
  }
  return `<span class="stamp stamp-actual">Actual</span>`;
}

function baseChartOptions(extra = {}) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: CHART_COLORS.text, font: { family: "Inter", size: 12 } } },
    },
    scales: {
      x: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
      y: { ticks: { color: CHART_COLORS.text }, grid: { color: CHART_COLORS.grid } },
    },
  }, extra);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById("global-toast");
  if (!el) return;
  el.classList.remove("show");
  // restart animation even if a toast is already showing
  void el.offsetWidth;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// Animate a number counting up from its current value to `target`.
// Respects prefers-reduced-motion by snapping instantly.
function animateCount(el, target, { duration = 900, decimals = 0, formatter } = {}) {
  if (!el) return;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = formatter || (n => Number(n).toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }));
  const start = 0;
  const end = Number(target) || 0;

  if (reduceMotion) { el.textContent = fmt(end); return; }

  const startTime = performance.now();
  function tick(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
    const value = start + (end - start) * eased;
    el.textContent = fmt(value);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(end);
  }
  requestAnimationFrame(tick);
}

// Adds a staggered .row-anim class + animation-delay to freshly-rendered <tr> rows.
function staggerRows(tbody, { step = 45, max = 400 } = {}) {
  if (!tbody) return;
  [...tbody.querySelectorAll("tr")].forEach((tr, i) => {
    tr.classList.add("row-anim");
    tr.style.animationDelay = `${Math.min(i * step, max)}ms`;
  });
}

// Ripple micro-interaction for .btn elements — call once on page load.
function initButtonRipples(root = document) {
  root.querySelectorAll(".btn").forEach(btn => {
    if (btn.dataset.rippleBound) return;
    btn.dataset.rippleBound = "1";
    btn.addEventListener("click", e => {
      if (btn.disabled) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const dot = document.createElement("span");
      dot.className = "ripple-dot";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${(e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
      dot.style.top = `${(e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
      btn.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove());
    });
  });
}

// Fades sections in as they scroll into view. Elements need class="reveal".
function initScrollReveal(root = document) {
  const items = root.querySelectorAll(".reveal");
  if (!items.length) return;
  if (!("IntersectionObserver" in window)) {
    items.forEach(el => el.classList.add("in-view"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(el => io.observe(el));
}

document.addEventListener("DOMContentLoaded", () => {
  initButtonRipples();
  initScrollReveal();
});
