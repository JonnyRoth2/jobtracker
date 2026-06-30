console.log("Job Tracker loaded");

// Returns the trimmed text of the first selector that matches & has text.
// `root` lets us scope the search to a container (e.g. the job detail pane).
// Falls back to textContent because innerText is "" for collapsed/offscreen
// nodes that LinkedIn sometimes uses.
function firstText(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) {
      const t = (el.innerText || el.textContent || "").trim();
      if (t) return t;
    }
  }
  return "";
}

// LinkedIn/Indeed URLs on search pages carry the job id plus a pile of tracking
// params, and that whole string is what we'd store + dedup on (so the same job
// re-logs whenever a tracking param changes). Rebuild the canonical job URL.
function canonicalUrl(hostname) {
  const href = window.location.href;
  if (hostname.includes("linkedin")) {
    const m =
      href.match(/currentJobId=(\d+)/) ||
      location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`;
  } else if (hostname.includes("indeed")) {
    const el = document.querySelector("[data-jk]");
    const jk =
      new URLSearchParams(location.search).get("jk") ||
      (el && el.getAttribute("data-jk"));
    if (jk) return `https://www.indeed.com/viewjob?jk=${jk}`;
  }
  return href;
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
    // On the /jobs/search-results/ layout the selected job renders in a
    // right-hand detail pane. Scope to it so we read the open job, not a
    // list item, and so a bare "h1" fallback can't grab the page chrome.
    const pane =
      document.querySelector(
        ".jobs-search__job-details, .jobs-details, .scaffold-layout__detail, .job-view-layout"
      ) || document;

    title = firstText(
      [
        ".job-details-jobs-unified-top-card__job-title h1",
        ".job-details-jobs-unified-top-card__job-title a",
        ".job-details-jobs-unified-top-card__job-title",
        ".jobs-unified-top-card__job-title",
        'a[href*="/jobs/view/"]',
        "h1",
      ],
      pane
    );
    company = firstText(
      [
        ".job-details-jobs-unified-top-card__company-name a",
        ".job-details-jobs-unified-top-card__company-name",
        ".jobs-unified-top-card__company-name a",
        ".jobs-unified-top-card__company-name",
        'a[href*="/company/"]',
      ],
      pane
    );
    locationText = firstText(
      [
        ".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
        ".job-details-jobs-unified-top-card__bullet",
        ".jobs-unified-top-card__bullet",
        ".job-details-jobs-unified-top-card__primary-description-container",
      ],
      pane
    );
    description = firstText(
      [
        ".jobs-description-content__text",
        ".jobs-box__html-content",
        ".jobs-description__content",
        "#job-details",
      ],
      pane
    );

    // The top card lumps "Location · Reposted 2 weeks ago · 100 applicants"
    // into one string — keep only the first segment (the location).
    if (locationText) locationText = locationText.split(/[·•|\n]/)[0].trim();
    // Drop LinkedIn's leading "About the job" heading from the description.
    description = description.replace(/^About the job\s*/i, "");
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

  // Last-resort fallbacks from page metadata so a missed DOM selector doesn't
  // produce a wholly blank record. (og:title on a /jobs/view/ page is the exact
  // job title; on a search page it may be approximate, but only used if the
  // scoped DOM scrape above found nothing.)
  if (!title) {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) title = og.content.trim();
  }
  if (!description) {
    const ogd = document.querySelector('meta[property="og:description"]');
    if (ogd && ogd.content) description = ogd.content.trim();
  }

  return {
    title,
    company,
    location: locationText,
    description: description.slice(0, 8000),
    source,
    url: canonicalUrl(hostname),
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

    // If the structured scrape still misses, dump candidate nodes so the exact
    // current class names can be pinned (LinkedIn renames these periodically).
    if (!data.title && !data.company) {
      console.warn(
        "Job Tracker — scrape came back empty; nothing saved. Candidates on page:",
        {
          headings: [...document.querySelectorAll("h1, h2")]
            .map((e) => (e.innerText || e.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 8),
          companyLinks: [...document.querySelectorAll('a[href*="/company/"]')]
            .map((e) => (e.innerText || e.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 5),
        }
      );
    }

    console.log("Job Tracker — tracked application:", data);
    chrome.runtime.sendMessage({ type: "JOB_APPLIED", data });
    showToast(`Tracked: ${data.title || "job"} @ ${data.company || data.source}`);
  },
  true
);
