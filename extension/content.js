console.log("Job Tracker loaded");

// Returns the trimmed innerText of the first selector that matches & has text.
function firstText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim()) {
      return el.innerText.trim();
    }
  }
  return "";
}

function getJobData() {
  const hostname = location.hostname;
  let source = "";
  let title = "";
  let company = "";
  let locationText = "";
  let description = "";

  if (hostname.includes("linkedin")) {
    source = "LinkedIn";
    title = firstText([
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      "h1",
    ]);
    company = firstText([
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
    ]);
    locationText = firstText([
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__bullet",
    ]);
    description = firstText([
      "#job-details",
      ".jobs-description__content",
      ".jobs-box__html-content",
    ]);
  } else if (hostname.includes("indeed")) {
    source = "Indeed";
    title = firstText([
      '[data-testid="jobsearch-JobInfoHeader-title"]',
      "h1.jobsearch-JobInfoHeader-title",
      "h1",
    ]);
    company = firstText([
      '[data-testid="inlineHeader-companyName"]',
      '[data-testid="company-name"]',
    ]);
    locationText = firstText([
      '[data-testid="job-location"]',
      '[data-testid="inlineHeader-companyLocation"]',
    ]);
    description = firstText([
      "#jobDescriptionText",
      ".jobsearch-JobComponent-description",
    ]);
  } else if (hostname.includes("joinhandshake")) {
    source = "Handshake";
    // Handshake's class names are dynamic/hashed, so these are best-effort with
    // generic fallbacks. Inspect a real job page and tweak if a field is blank.
    title = firstText(['[data-hook="job-title"]', "h1"]);
    company = firstText([
      '[data-hook="employer-name"]',
      '[data-hook="details-employer-name"]',
      'a[href*="/employers/"]',
    ]);
    locationText = firstText([
      '[data-hook="job-location"]',
      '[data-hook="employer-location"]',
    ]);
    description = firstText([
      '[data-hook="details-body"]',
      '[data-hook="job-description"]',
      ".job-details",
    ]);
  }

  return {
    title,
    company,
    location: locationText,
    description: description.slice(0, 8000),
    source,
    url: window.location.href,
  };
}

// Heuristic: is this clicked element an "apply for this job" button?
function looksLikeApplyButton(el) {
  const text = (el.innerText || el.value || "").trim().toLowerCase();
  if (!text || text.length > 40) return false;
  if (text.includes("filter")) return false; // e.g. search "Apply filters"
  if (text.startsWith("applied")) return false; // already-applied state
  return (
    text === "apply" ||
    text === "apply now" ||
    text === "easy apply" ||
    text === "quick apply" ||
    text === "submit application" ||
    text.startsWith("apply") ||
    text.includes("easy apply")
  );
}

function showToast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
    "background:#1a7f37;color:#fff;padding:10px 14px;border-radius:6px;" +
    "font:13px sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Capture phase (true) so we still see the click even if the site calls
// stopPropagation() on its own apply button.
document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest(
      "button, a, [role='button'], input[type='submit']"
    );
    if (!button || !looksLikeApplyButton(button)) return;

    // Scrape NOW, before the click navigates away or opens a modal.
    const data = getJobData();
    if (!data.url) return;

    console.log("Job Tracker — tracked application:", data);
    chrome.runtime.sendMessage({ type: "JOB_APPLIED", data });
    showToast(`Tracked: ${data.title || "job"} @ ${data.company || data.source}`);
  },
  true
);
