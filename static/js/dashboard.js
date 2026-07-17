function showSkeletonStats() {
  document.querySelectorAll("#stat-grid .stat-value").forEach(el => {
    el.innerHTML = `<span class="skeleton" style="width:70px;"></span>`;
  });
}

function showSkeletonTable() {
  const tbody = document.querySelector("#recent-table tbody");
  tbody.innerHTML = Array.from({ length: 5 }).map(() => `
    <tr class="skeleton-row">
      ${Array.from({ length: 6 }).map(() => `<td><span class="skeleton"></span></td>`).join("")}
    </tr>`).join("");
}

function waitForChart(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (typeof Chart !== "undefined") return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if (typeof Chart !== "undefined") {
        clearInterval(iv);
        resolve();
      } else if (window.__chartLoadFailed || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error("Chart.js could not be loaded"));
      }
    }, 100);
  });
}

function showChartsUnavailable() {
  document.querySelectorAll(".chart-box").forEach(box => {
    box.innerHTML = `<div class="empty-state">Charts couldn't load — the Chart.js library was blocked by your network. Data above is still accurate.</div>`;
  });
}

async function loadDashboard() {
  showSkeletonStats();
  showSkeletonTable();

  let statsData = null;

  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
    const s = await res.json();
    statsData = s;

    // Stat cards — count up instead of snapping to the final value
    const cards = document.querySelectorAll("#stat-grid .stat-value");
    cards[0].textContent = "0";
    cards[1].textContent = "0";
    cards[2].textContent = "0";
    cards[3].textContent = "0";
    animateCount(cards[0], s.total, { duration: 900 });
    animateCount(cards[1], s.actual, { duration: 900 });
    animateCount(cards[2], s.predicted, { duration: 900 });
    animateCount(cards[3], s.avg_rentals, { duration: 900, decimals: 1 });

    const subs = document.querySelectorAll("#stat-grid .card");
    subs[0].insertAdjacentHTML("beforeend", `<div class="stat-sub">${s.date_min || "—"} → ${s.date_max || "—"}</div>`);
    subs[1].insertAdjacentHTML("beforeend", `<div class="stat-sub">Documented historical records</div>`);
    subs[2].insertAdjacentHTML("beforeend", `<div class="stat-sub">Forecasts added by the system</div>`);
    subs[3].insertAdjacentHTML("beforeend", `<div class="stat-sub">Across ${s.branches} branches</div>`);
  } catch (err) {
    console.error(err);
    showToast(err.message || "Could not load dashboard data");
    document.querySelectorAll("#stat-grid .stat-value").forEach(el => el.textContent = "—");
  }

  // Charts depend on the Chart.js library, which may still be loading (or
  // may have failed over to a fallback CDN) — wait for it independently of
  // the stats above so a slow/blocked CDN never throws inside renderCharts.
  if (statsData) {
    try {
      await waitForChart();
      renderCharts(statsData);
    } catch (err) {
      console.error(err);
      showChartsUnavailable();
      showToast("Charts unavailable — network blocked the chart library");
    }
  }

  // Recent records table
  try {
    const recRes = await fetch("/api/records?per_page=8");
    const rec = await recRes.json();
    const tbody = document.querySelector("#recent-table tbody");
    if (!rec.rows || rec.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No data yet</td></tr>`;
    } else {
      tbody.innerHTML = rec.rows.map(r => `
        <tr>
          <td class="mono">${r.Date}</td>
          <td class="mono">${r.Hour}</td>
          <td>${r.Library_Branch}</td>
          <td>${r.Top_Category}</td>
          <td class="mono">${Math.round(r.Rentals_Count)}</td>
          <td>${stampHtml(r.Data_Source)}</td>
        </tr>`).join("");
      staggerRows(tbody, { step: 55 });
    }
  } catch (err) {
    console.error(err);
  }

  initButtonRipples();
}

function renderCharts(s) {
  const animBase = {
    duration: 1000,
    easing: "easeOutQuart",
  };

  // Daily trend (actual vs predicted)
  const dates = [...new Set((s.daily_trend || []).map(r => r.Date))].sort();
  const actualMap = {}, predMap = {};
  (s.daily_trend || []).forEach(r => {
    if (r.Data_Source === "Actual") actualMap[r.Date] = r.avg_rentals;
    else predMap[r.Date] = r.avg_rentals;
  });
  new Chart(document.getElementById("chart-daily").getContext("2d"), {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        { label: "Actual", data: dates.map(d => actualMap[d] ?? null), borderColor: CHART_COLORS.actual, backgroundColor: "transparent", tension: .3, spanGaps: true, pointRadius: 0, borderWidth: 2 },
        { label: "Predicted", data: dates.map(d => predMap[d] ?? null), borderColor: CHART_COLORS.predicted, backgroundColor: "transparent", tension: .3, spanGaps: true, pointRadius: 3, borderDash: [4, 3], borderWidth: 2 },
      ],
    },
    options: baseChartOptions({
      animation: { ...animBase, delay: (ctx) => ctx.type === "data" ? ctx.dataIndex * 4 : 0 },
      interaction: { mode: "index", intersect: false },
      plugins: { tooltip: { animation: { duration: 150 } } },
    }),
  });

  // Hourly averages
  const hours = [...Array(24).keys()];
  const hourlyActual = {};
  (s.hourly || []).forEach(r => { if (r.Data_Source === "Actual") hourlyActual[r.Hour] = r.avg_rentals; });
  new Chart(document.getElementById("chart-hourly").getContext("2d"), {
    type: "bar",
    data: {
      labels: hours,
      datasets: [{ label: "Avg. rentals", data: hours.map(h => hourlyActual[h] ?? 0), backgroundColor: CHART_COLORS.actual, borderRadius: 3 }],
    },
    options: baseChartOptions({
      plugins: { legend: { display: false } },
      animation: { ...animBase, delay: (ctx) => ctx.type === "data" ? ctx.dataIndex * 18 : 0 },
    }),
  });

  // By branch
  new Chart(document.getElementById("chart-branch").getContext("2d"), {
    type: "bar",
    data: {
      labels: (s.by_branch || []).map(r => r.Library_Branch),
      datasets: [{ label: "Avg. rentals", data: (s.by_branch || []).map(r => r.avg_rentals), backgroundColor: CHART_COLORS.predicted, borderRadius: 3 }],
    },
    options: baseChartOptions({
      indexAxis: "y",
      plugins: { legend: { display: false } },
      animation: { ...animBase, delay: (ctx) => ctx.type === "data" ? ctx.dataIndex * 60 : 0 },
    }),
  });

  // By category (doughnut)
  new Chart(document.getElementById("chart-category").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: (s.by_category || []).map(r => r.Top_Category),
      datasets: [{ data: (s.by_category || []).map(r => r.n), backgroundColor: ["#A3792F","#2F5233","#8B3A32","#7C5B21","#1C2A3F","#7C879B","#E4B65E","#EDE8D9"] }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { ...animBase, animateRotate: true, animateScale: true },
      plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.text, font: { family: "Inter", size: 11 }, boxWidth: 12 } } },
    },
  });
}

loadDashboard();
