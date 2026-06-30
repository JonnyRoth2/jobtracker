// No server. Every application is kept in chrome.storage.local (the source of
// truth, deduped by URL). After each new one, we regenerate the FULL CSV and
// write it to Downloads/applications.csv with conflictAction "overwrite", so
// that single file always contains everything and grows over time.

const STORAGE_KEY = "applications";
const LAST_DL_KEY = "lastDownloadId";
const FILENAME = "applications.csv";
const MAX_DESCRIPTION = 8000;
const FIELDS = ["date", "company", "title", "location", "source", "url", "description"];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JOB_APPLIED") {
    handleApplied(message.data);
    return; // no response needed
  }
  if (message.type === "EXPORT_NOW") {
    writeCsv()
      .then((wrote) => sendResponse({ ok: wrote }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the message channel open for the async sendResponse
  }
});

async function handleApplied(data) {
  if (await saveApplication(data)) {
    await writeCsv();
  }
}

// Returns true if a NEW record was added (false on misfire / duplicate).
async function saveApplication(data) {
  const url = (data.url || "").trim();
  const title = (data.title || "").trim();
  const company = (data.company || "").trim();
  if (!url || !(title || company)) return false;

  const store = await chrome.storage.local.get(STORAGE_KEY);
  const apps = store[STORAGE_KEY] || [];
  if (apps.some((a) => a.url === url)) {
    console.log("Job Tracker — already tracked:", url);
    return false;
  }

  apps.push({
    date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD you applied
    company,
    title,
    location: (data.location || "").trim(),
    source: (data.source || "").trim(),
    url,
    description: (data.description || "").trim().slice(0, MAX_DESCRIPTION),
  });

  await chrome.storage.local.set({ [STORAGE_KEY]: apps });
  console.log(`Job Tracker — saved (${apps.length} total):`, title, "@", company);
  return true;
}

// RFC 4180: quote a field if it has a comma, quote, or newline; double quotes.
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(apps) {
  const lines = [FIELDS.join(",")];
  for (const app of apps) {
    lines.push(FIELDS.map((f) => csvEscape(app[f])).join(","));
  }
  return lines.join("\r\n");
}

// Rewrite Downloads/applications.csv with the full, current data set.
async function writeCsv() {
  const store = await chrome.storage.local.get([STORAGE_KEY, LAST_DL_KEY]);
  const apps = store[STORAGE_KEY] || [];
  if (!apps.length) return false;

  // Leading BOM so Excel/Sheets reads it as UTF-8. Service workers have no
  // Blob URLs, so we hand chrome.downloads a UTF-8 data: URL instead.
  const csv = "﻿" + toCsv(apps);
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);

  const id = await chrome.downloads.download({
    url,
    filename: FILENAME,
    conflictAction: "overwrite",
    saveAs: false,
  });
  await chrome.storage.local.set({ [LAST_DL_KEY]: id });

  // Drop the previous entry from the downloads history to avoid clutter
  // (this only removes the history row, not the file).
  const prevId = store[LAST_DL_KEY];
  if (prevId != null && prevId !== id) {
    chrome.downloads.erase({ id: prevId }).catch(() => {});
  }
  return true;
}
