const TOTAL_STEPS = 4;
let currentStep = 1;

const stepFields = {
  1: ["Date", "Hour"],
  2: ["Temperature_C", "Humidity_pct", "Wind_Speed_ms", "Visibility_m", "Solar_Radiation_MJm2", "Rainfall_mm", "Season", "Holiday"],
  3: ["Library_Branch", "Top_Category", "Membership_Type"],
};

const fieldLabels = {
  Date: "Date", Hour: "Hour", Temperature_C: "Temperature (°C)",
  Humidity_pct: "Humidity (%)", Wind_Speed_ms: "Wind Speed (m/s)",
  Visibility_m: "Visibility (m)", Solar_Radiation_MJm2: "Solar Radiation",
  Rainfall_mm: "Rainfall (mm)", Season: "Season", Holiday: "Holiday?",
  Library_Branch: "Branch", Top_Category: "Category", Membership_Type: "Membership",
};

function showError(msg) {
  const el = document.getElementById("error-banner");
  el.textContent = msg;
  el.style.display = "block";
}
function clearError() {
  document.getElementById("error-banner").style.display = "none";
}

function validateStep(step) {
  const fields = stepFields[step] || [];
  for (const name of fields) {
    const input = document.getElementsByName(name)[0];
    if (input && input.hasAttribute("required") && !String(input.value).trim()) {
      showError(`Please fill in: ${fieldLabels[name] || name}`);
      input.focus();
      return false;
    }
  }
  if (step === 1) {
    const hour = Number(document.getElementById("Hour").value);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) { showError("Hour must be between 0 and 23"); return false; }
  }
  clearError();
  return true;
}

// Silent check (no focus/DOM side effects) used to scan steps that may not
// currently be visible — hidden elements can't reliably receive focus.
function stepHasError(step) {
  const fields = stepFields[step] || [];
  for (const name of fields) {
    const input = document.getElementsByName(name)[0];
    if (input && input.hasAttribute("required") && !String(input.value).trim()) return name;
  }
  if (step === 1) {
    const hour = Number(document.getElementById("Hour").value);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return "Hour";
  }
  return null;
}

// Re-checks every step's required fields, not just the one the user is
// currently on — protects against a field being cleared (Back navigation,
// browser autofill, etc.) after its step was already validated once.
function validateAllSteps() {
  for (const step of [1, 2, 3]) {
    if (stepHasError(step)) return step;
  }
  return null;
}

function goToStep(n) {
  const direction = n > currentStep ? "dir-fwd" : "dir-back";
  document.querySelectorAll(".wizard-step[data-step]").forEach(el => {
    if (el.dataset.step === "result") return;
    const isTarget = Number(el.dataset.step) === n;
    el.classList.toggle("active", isTarget);
    el.classList.remove("dir-fwd", "dir-back");
    if (isTarget) el.classList.add(direction);
  });
  document.querySelectorAll(".step").forEach(el => {
    const s = Number(el.dataset.step);
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  currentStep = n;

  document.getElementById("btn-back").disabled = n === 1;
  document.getElementById("btn-next").textContent = n === TOTAL_STEPS ? "Run Model & Save Forecast" : "Next";

  if (n === TOTAL_STEPS) buildReview();
}

function buildReview() {
  const grid = document.getElementById("review-grid");
  const allFields = [...stepFields[1], ...stepFields[2], ...stepFields[3]];
  grid.innerHTML = allFields.map((name, i) => {
    const el = document.getElementsByName(name)[0];
    const val = el ? (el.tagName === "SELECT" ? el.options[el.selectedIndex].text : el.value) : "";
    return `<div class="review-item reveal in-view" style="animation-delay:${i * 40}ms"><span>${fieldLabels[name] || name}</span><span>${val || "—"}</span></div>`;
  }).join("");
}

document.getElementById("btn-next").addEventListener("click", async () => {
  if (!validateStep(currentStep)) return;

  if (currentStep < TOTAL_STEPS) {
    goToStep(currentStep + 1);
    return;
  }

  // Final step -> re-check every step (not just this one) before submitting.
  const badStep = validateAllSteps();
  if (badStep) {
    goToStep(badStep);
    validateStep(badStep); // shows the message + focuses the field, now that it's visible
    return;
  }

  // Final step -> submit
  const btn = document.getElementById("btn-next");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Running forecast…`;

  const form = document.getElementById("wizard-form");
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  // Defensive normalization: trim whitespace, and accept comma decimals
  // (e.g. some keyboards/locales) on numeric fields before they reach the server.
  const numericFields = ["Temperature_C", "Humidity_pct", "Wind_Speed_ms", "Visibility_m", "Solar_Radiation_MJm2", "Rainfall_mm"];
  for (const key of numericFields) {
    if (typeof payload[key] === "string") {
      payload[key] = payload[key].trim().replace(",", ".");
    }
  }

  try {
    const res = await fetch("/api/predict-and-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "An unexpected error occurred");

    document.getElementById("result-num").textContent = Math.round(data.predicted_rentals);
    document.getElementById("result-id").textContent = `#${data.id}`;

    document.querySelectorAll(".wizard-step").forEach(el => el.classList.remove("active"));
    document.getElementById("result-step").classList.add("active");
    document.getElementById("wizard-nav").style.display = "none";
    document.getElementById("stepper").style.display = "none";
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

document.getElementById("btn-back").addEventListener("click", () => {
  clearError();
  goToStep(Math.max(currentStep - 1, 1));
});

document.getElementById("btn-new-prediction").addEventListener("click", () => {
  document.getElementById("wizard-form").reset();
  document.getElementById("result-step").classList.remove("active");
  document.getElementById("wizard-nav").style.display = "flex";
  document.getElementById("stepper").style.display = "flex";
  goToStep(1);
});

// Prevent implicit form submit on Enter
document.getElementById("wizard-form").addEventListener("submit", e => e.preventDefault());
