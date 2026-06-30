const STORAGE_KEY = "applications";

async function load() {
  const store = await chrome.storage.local.get(STORAGE_KEY);
  return store[STORAGE_KEY] || [];
}

async function refresh() {
  const apps = await load();
  document.getElementById("count").textContent = apps.length;
}

// Manual re-sync. Normally the CSV is rewritten automatically on each apply;
// this is a fallback (e.g. if a write got skipped) and re-saves the full file.
document.getElementById("export").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "EXPORT_NOW" }, (resp) => {
    const status = document.getElementById("status");
    if (resp && resp.ok) {
      status.textContent = "Saved to Downloads/applications.csv";
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

refresh();
