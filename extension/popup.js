const STORAGE_KEY = "applications";

// Keep these in sync with background.js. First entry is the default.
const STATUS_OPTIONS = ["No response", "Interview", "Offer", "Accepted"];
const DEFAULT_STATUS = STATUS_OPTIONS[0];

async function load() {
  const store = await chrome.storage.local.get(STORAGE_KEY);
  return store[STORAGE_KEY] || [];
}

// One row: title, company · date, and a status dropdown that persists on change.
function jobRow(app) {
  const wrap = document.createElement("div");
  wrap.className = "job";

  const title = document.createElement("div");
  title.className = "job-title";
  title.textContent = app.title || "(untitled)";
  wrap.appendChild(title);

  const sub = document.createElement("div");
  sub.className = "job-sub";
  sub.textContent = [app.company, app.date].filter(Boolean).join(" · ");
  wrap.appendChild(sub);

  const select = document.createElement("select");
  const current = app.status || DEFAULT_STATUS;
  for (const opt of STATUS_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    chrome.runtime.sendMessage(
      { type: "SET_STATUS", url: app.url, status: select.value },
      () => void chrome.runtime.lastError // swallow "port closed" noise
    );
  });
  wrap.appendChild(select);

  return wrap;
}

async function refresh() {
  const apps = await load();
  document.getElementById("count").textContent = apps.length;

  const list = document.getElementById("list");
  list.textContent = "";
  if (!apps.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No applications tracked yet.";
    list.appendChild(empty);
    return;
  }
  // Newest first.
  for (const app of apps.slice().reverse()) list.appendChild(jobRow(app));
}

// Manual re-sync. Normally the .xlsx is rewritten automatically on each apply
// and on each status change; this is a fallback that re-saves the full file.
document.getElementById("export").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "EXPORT_NOW" }, (resp) => {
    const status = document.getElementById("status");
    if (resp && resp.ok) {
      status.textContent = "Saved to Downloads/applications.xlsx";
    } else {
      status.textContent = "Nothing to save yet.";
    }
  });
});

document.getElementById("clear").addEventListener("click", async () => {
  if (!confirm("Delete all tracked applications?")) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  document.getElementById("status").textContent = "Cleared.";
  refresh();
});

// Live-update if storage changes while the popup is open (new apply, or a status
// write from another popup instance).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) refresh();
});

refresh();
