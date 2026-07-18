// Shared utilities used across pages
const CHART_COLORS = {
  actual: "#A3792F",
  predicted: "#6e4732",
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

// ---------------------------------------------------------------
// Premium ambiance: a soft shaft of window light with drifting dust
// motes behind the content — evokes an actual reading room at golden
// hour rather than a flat gradient. Fully skipped for reduced-motion.
// ---------------------------------------------------------------
function initDustMotes() {
  if (document.getElementById("dust-canvas")) return;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const shaft = document.createElement("div");
  shaft.className = "light-shaft";
  document.body.prepend(shaft);

  if (reduceMotion) return;

  const canvas = document.createElement("canvas");
  canvas.id = "dust-canvas";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  let w, h, motes;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function makeMotes(n) {
    return Array.from({ length: n }).map(() => ({
      x: Math.random() * w,
      y: Math.random() * h + h * 0.2,
      r: Math.random() * 1.4 + 0.4,
      speed: Math.random() * 0.14 + 0.04,
      drift: (Math.random() - 0.5) * 0.1,
      alpha: Math.random() * 0.18 + 0.06,
    }));
  }
  resize();
  motes = makeMotes(Math.min(22, Math.round((w * h) / 60000)));
  window.addEventListener("resize", () => {
    resize();
    motes = makeMotes(Math.min(22, Math.round((w * h) / 60000)));
  });

  function tick() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#E4B65E";
    motes.forEach(m => {
      m.y -= m.speed;
      m.x += m.drift;
      if (m.y < -10) { m.y = h + 10; m.x = Math.random() * w; }
      ctx.globalAlpha = m.alpha;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------
// Subtle 3D tilt for card elements — tracks pointer position and
// leans the card toward it, like lifting a card out of a drawer.
// ---------------------------------------------------------------
function initTilt(selector = ".card", maxDeg = 2.5) {
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;
  document.querySelectorAll(selector).forEach(card => {
    if (card.dataset.tiltBound) return;
    card.dataset.tiltBound = "1";
    card.classList.add("tilt");
    card.addEventListener("pointermove", e => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      card.style.setProperty("--tiltY", `${(px - 0.5) * maxDeg * 2}deg`);
      card.style.setProperty("--tiltX", `${(0.5 - py) * maxDeg * 2}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--tiltX", `0deg`);
      card.style.setProperty("--tiltY", `0deg`);
    });
  });
}

// ---------------------------------------------------------------
// Wraps existing .chart-box elements in a brass card-catalog frame
// (corner brackets), without requiring any HTML changes.
// ---------------------------------------------------------------
function frameCharts(selector = ".chart-box") {
  document.querySelectorAll(selector).forEach(box => {
    if (box.parentElement && box.parentElement.classList.contains("chart-frame")) return;
    const frame = document.createElement("div");
    frame.className = "chart-frame";
    box.parentNode.insertBefore(frame, box);
    frame.appendChild(box);
    const tr = document.createElement("span"); tr.className = "bracket-tr";
    const bl = document.createElement("span"); bl.className = "bracket-bl";
    frame.appendChild(tr); frame.appendChild(bl);
  });
}

// ---------------------------------------------------------------
// Renders a minimal inline sparkline (SVG) for a series of numbers,
// with a filled area, an animated stroke draw-in, and a final dot.
// Returns the SVG string — caller inserts it wherever suits (e.g.
// appended to a .catalog-card, under the stat value).
// ---------------------------------------------------------------
function buildSparkline(values, { width = 220, height = 30, color = CHART_COLORS.actual, pad = 3 } = {}) {
  const nums = (values || []).map(Number).filter(n => !Number.isNaN(n));
  if (nums.length < 2) return "";
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const step = (width - pad * 2) / (nums.length - 1);
  const pts = nums.map((n, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (n - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const fillPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`;
  const last = pts[pts.length - 1];
  const approxLen = pts.reduce((acc, p, i) => i === 0 ? 0 : acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]), 0);

  return `<svg class="stat-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="--spark-len:${Math.ceil(approxLen + 4)}">
    <path class="spark-fill" d="${fillPath}" fill="${color}" />
    <path class="spark-line" d="${linePath}" stroke="${color}" />
    <circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}" />
  </svg>`;
}

// Small up/down/flat trend badge, e.g. buildTrendBadge(12.4) -> "+12.4%"
function buildTrendBadge(pctChange) {
  if (pctChange === null || pctChange === undefined || Number.isNaN(pctChange)) return "";
  const rounded = Math.round(pctChange * 10) / 10;
  const dir = rounded > 0.05 ? "up" : rounded < -0.05 ? "down" : "flat";
  const arrow = dir === "up"
    ? `<svg viewBox="0 0 10 10"><path d="M1 8L9 1M9 1H3M9 1V7" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : dir === "down"
      ? `<svg viewBox="0 0 10 10"><path d="M1 2L9 9M9 9H3M9 9V3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 10 10"><path d="M1 5H9" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
  const sign = rounded > 0 ? "+" : "";
  return `<span class="stat-trend ${dir}">${arrow}${sign}${rounded}%</span>`;
}

document.addEventListener("DOMContentLoaded", () => {
  initButtonRipples();
  initScrollReveal();
  initDustMotes();
  initTilt(".card");
});
