// No server. Every application is kept in chrome.storage.local (the source of
// truth, deduped by URL). After each new one, we regenerate a formatted
// applications.xlsx and write it to Downloads with conflictAction "overwrite",
// so that single file always contains everything and grows over time.

const STORAGE_KEY = "applications";
const LAST_DL_KEY = "lastDownloadId";
const FILENAME = "applications.xlsx";
const MAX_DESCRIPTION = 8000;

const FIELDS = ["date", "company", "title", "location", "source", "status", "url", "description"];
const HEADERS = ["Date", "Company", "Title", "Location", "Source", "Status", "URL", "Description"];
const COL_WIDTHS = [12, 22, 32, 20, 12, 14, 42, 70];

// Application progress, set from the popup dropdown. First entry is the default.
const STATUS_OPTIONS = ["No response", "Interview", "Offer", "Accepted"];
const DEFAULT_STATUS = STATUS_OPTIONS[0];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JOB_APPLIED") {
    console.log("Job Tracker BG — received apply:", message.data);
    handleApplied(message.data);
    return; // no response needed
  }
  if (message.type === "EXPORT_NOW") {
    writeXlsx()
      .then((wrote) => sendResponse({ ok: wrote }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the message channel open for the async sendResponse
  }
  if (message.type === "SET_STATUS") {
    setStatus(message.url, message.status)
      .then((ok) => sendResponse({ ok }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async sendResponse
  }
});

// Update one application's status (matched by URL) and rewrite the xlsx so the
// Status column stays in sync with what the popup shows.
async function setStatus(url, status) {
  if (!STATUS_OPTIONS.includes(status)) return false;
  const store = await chrome.storage.local.get(STORAGE_KEY);
  const apps = store[STORAGE_KEY] || [];
  const app = apps.find((a) => a.url === url);
  if (!app) return false;
  app.status = status;
  await chrome.storage.local.set({ [STORAGE_KEY]: apps });
  await writeXlsx();
  return true;
}

// Today's date as YYYY-MM-DD in the LOCAL timezone. (new Date().toISOString()
// is UTC, which rolls to "tomorrow" in the evening for anyone behind UTC.)
function localDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function handleApplied(data) {
  if (await saveApplication(data)) {
    await writeXlsx();
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
    date: localDate(), // YYYY-MM-DD you applied, in your local timezone
    company,
    title,
    location: (data.location || "").trim(),
    source: (data.source || "").trim(),
    status: DEFAULT_STATUS, // updated later from the popup dropdown
    url,
    description: (data.description || "").trim().slice(0, MAX_DESCRIPTION),
  });

  await chrome.storage.local.set({ [STORAGE_KEY]: apps });
  console.log(`Job Tracker — saved (${apps.length} total):`, title, "@", company);
  return true;
}

// Rewrite Downloads/applications.xlsx with the full, current data set.
async function writeXlsx() {
  const store = await chrome.storage.local.get([STORAGE_KEY, LAST_DL_KEY]);
  const apps = store[STORAGE_KEY] || [];
  if (!apps.length) return false;

  const bytes = await buildXlsx(apps);
  const url =
    "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
    bytesToBase64(bytes);

  const id = await chrome.downloads.download({
    url,
    filename: FILENAME,
    conflictAction: "overwrite",
    saveAs: false,
  });
  await chrome.storage.local.set({ [LAST_DL_KEY]: id });

  // Drop the previous downloads-history row to avoid clutter (file stays).
  const prevId = store[LAST_DL_KEY];
  if (prevId != null && prevId !== id) {
    chrome.downloads.erase({ id: prevId }).catch(() => {});
  }
  return true;
}

// ============================================================================
// xlsx generator — builds a real .xlsx (a zip of XML parts) with a bold frozen
// header, column widths, auto-filter, wrapped descriptions, and clickable URLs.
// No libraries: deflate via the built-in CompressionStream.
// ============================================================================

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Strip characters illegal in XML 1.0 so the file never corrupts.
function stripInvalidXml(s) {
  return String(s ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function inlineCell(ref, style, text) {
  const t = xmlEscape(stripInvalidXml(text));
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${t}</t></is></c>`;
}

function hyperlinkCell(ref, style, url) {
  const clean = stripInvalidXml(url).trim();
  if (!clean) return `<c r="${ref}" s="${style}"/>`;
  const arg = clean.replace(/"/g, '""'); // escape quotes for the formula string
  const formula = xmlEscape(`HYPERLINK("${arg}","${arg}")`);
  return `<c r="${ref}" s="${style}"><f>${formula}</f><v>${xmlEscape(clean)}</v></c>`;
}

function sheetXml(apps) {
  const lastRow = apps.length + 1;
  const lastCol = colLetter(FIELDS.length);

  let rows = `<row r="1">`;
  HEADERS.forEach((h, i) => {
    rows += inlineCell(colLetter(i + 1) + "1", 1, h);
  });
  rows += `</row>`;

  apps.forEach((app, idx) => {
    const r = idx + 2;
    rows += `<row r="${r}">`;
    FIELDS.forEach((field, i) => {
      const ref = colLetter(i + 1) + r;
      let val = (app[field] ?? "").toString().replace(/\r\n/g, "\n");
      if (field === "status" && !val) val = DEFAULT_STATUS; // older records
      if (field === "url") {
        rows += hyperlinkCell(ref, 3, val);
      } else if (field === "description") {
        rows += inlineCell(ref, 2, val); // wrap-text style
      } else {
        rows += inlineCell(ref, 3, val); // top-aligned body style
      }
    });
    rows += `</row>`;
  });

  const cols = COL_WIDTHS.map(
    (w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
  ).join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="3">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1A7F37"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`;

const WORKBOOK_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

// ---- ZIP assembly ----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function zip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const comp = await deflateRaw(f.data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    locals.push(lh, comp);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);

    offset += lh.length + comp.length;
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const cdOffset = offset;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

async function buildXlsx(apps) {
  const enc = new TextEncoder();
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES_XML) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS_XML) },
    { name: "xl/workbook.xml", data: enc.encode(WORKBOOK_XML) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WORKBOOK_RELS_XML) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(apps)) },
  ];
  return zip(files);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000; // avoid arg-count limits on fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
