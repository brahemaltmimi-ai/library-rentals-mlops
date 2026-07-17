let state = { page: 1, per_page: 20, source: "", branch: "", q: "" };
let selected = new Set();
let pendingDeleteIds = null;

async function loadBranches() {
  const res = await fetch("/api/branches");
  const data = await res.json();
  const sel = document.getElementById("f-branch");
  data.branches.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b; opt.textContent = b;
    sel.appendChild(opt);
  });
}

function showSkeletonRecords() {
  const tbody = document.querySelector("#records-table tbody");
  tbody.innerHTML = Array.from({ length: 8 }).map(() => `
    <tr class="skeleton-row">
      ${Array.from({ length: 10 }).map(() => `<td><span class="skeleton"></span></td>`).join("")}
    </tr>`).join("");
}

async function loadRecords() {
  showSkeletonRecords();

  const params = new URLSearchParams({
    page: state.page, per_page: state.per_page,
    source: state.source, branch: state.branch, q: state.q,
  });
  const res = await fetch(`/api/records?${params}`);
  const data = await res.json();

  selected.clear();
  updateBulkDeleteButton();
  document.getElementById("chk-all").checked = false;

  const tbody = document.querySelector("#records-table tbody");
  if (data.rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No matching results</td></tr>`;
  } else {
    tbody.innerHTML = data.rows.map(r => `
      <tr data-id="${r.id}">
        <td><input type="checkbox" class="row-check" data-id="${r.id}"></td>
        <td class="mono">${r.id}</td>
        <td class="mono">${r.Date}</td>
        <td class="mono">${r.Hour}</td>
        <td>${r.Library_Branch}</td>
        <td>${r.Top_Category}</td>
        <td>${r.Membership_Type}</td>
        <td class="mono">${Math.round(r.Rentals_Count)}</td>
        <td>${stampHtml(r.Data_Source)}</td>
        <td class="mono">${(r.Created_At || "").slice(0, 16).replace("T", " ")}</td>
        <td><button class="row-delete-btn" data-id="${r.id}" title="Delete record">✕</button></td>
      </tr>`).join("");
    staggerRows(tbody, { step: 30, max: 300 });
  }

  const totalPages = Math.max(Math.ceil(data.total / data.per_page), 1);
  document.getElementById("pg-info").textContent = `Page ${data.page} of ${totalPages} — ${fmtNum(data.total)} records`;
  document.getElementById("pg-prev").disabled = data.page <= 1;
  document.getElementById("pg-next").disabled = data.page >= totalPages;

  document.querySelectorAll(".row-check").forEach(chk => {
    chk.addEventListener("change", () => {
      const id = chk.dataset.id;
      if (chk.checked) selected.add(id); else selected.delete(id);
      updateBulkDeleteButton();
    });
  });
  document.querySelectorAll(".row-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => openDeleteModal([btn.dataset.id], "record"));
  });
}

function updateBulkDeleteButton() {
  const btn = document.getElementById("btn-bulk-delete");
  btn.disabled = selected.size === 0;
  btn.textContent = selected.size > 0 ? `Delete Selected (${selected.size})` : "Delete Selected";
}

function openDeleteModal(ids, kind) {
  pendingDeleteIds = ids;
  const modal = document.getElementById("delete-modal");
  const title = document.getElementById("delete-modal-title");
  const body = document.getElementById("delete-modal-body");
  title.textContent = ids.length > 1 ? `Delete ${ids.length} records?` : "Delete this record?";
  body.textContent = "This will permanently remove the record" + (ids.length > 1 ? "s" : "") + " from the database. This can't be undone.";
  modal.classList.add("open");
}
function closeDeleteModal() {
  pendingDeleteIds = null;
  document.getElementById("delete-modal").classList.remove("open");
}

async function confirmDelete() {
  if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
  const confirmBtn = document.getElementById("delete-confirm");
  const originalText = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = `<span class="spinner"></span> Deleting…`;

  try {
    const results = await Promise.all(pendingDeleteIds.map(id =>
      fetch(`/api/records/${id}`, { method: "DELETE" }).then(r => r.json().then(d => ({ ok: r.ok, id, d })))
    ));
    const failed = results.filter(r => !r.ok);
    const succeeded = results.filter(r => r.ok);

    succeeded.forEach(r => {
      const row = document.querySelector(`#records-table tr[data-id="${r.id}"]`);
      if (row) row.classList.add("removing");
    });

    if (failed.length > 0) {
      showToast(`Could not delete ${failed.length} record(s)`);
    } else {
      showToast(pendingDeleteIds.length > 1 ? "Records deleted" : "Record deleted");
    }
  } catch (err) {
    console.error(err);
    showToast("Delete failed — check your connection");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalText;
    closeDeleteModal();
    setTimeout(loadRecords, 260);
  }
}

document.getElementById("f-search").addEventListener("input", debounce(e => {
  state.q = e.target.value; state.page = 1; loadRecords();
}, 350));
document.getElementById("f-source").addEventListener("change", e => {
  state.source = e.target.value; state.page = 1; loadRecords();
});
document.getElementById("f-branch").addEventListener("change", e => {
  state.branch = e.target.value; state.page = 1; loadRecords();
});
document.getElementById("pg-prev").addEventListener("click", () => { state.page--; loadRecords(); });
document.getElementById("pg-next").addEventListener("click", () => { state.page++; loadRecords(); });

document.getElementById("chk-all").addEventListener("change", e => {
  document.querySelectorAll(".row-check").forEach(chk => {
    chk.checked = e.target.checked;
    const id = chk.dataset.id;
    if (e.target.checked) selected.add(id); else selected.delete(id);
  });
  updateBulkDeleteButton();
});

document.getElementById("btn-bulk-delete").addEventListener("click", () => {
  openDeleteModal([...selected], "bulk");
});

document.getElementById("delete-cancel").addEventListener("click", closeDeleteModal);
document.getElementById("delete-confirm").addEventListener("click", confirmDelete);
document.getElementById("delete-modal").addEventListener("click", e => {
  if (e.target.id === "delete-modal") closeDeleteModal();
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

loadBranches();
loadRecords();
