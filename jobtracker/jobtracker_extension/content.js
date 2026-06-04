console.log("Job Tracker loaded");
function getJobData() {

  const hostname = location.hostname;

  let company = "";
  let title = "";
  let locationText = "";
  let source = "";

  if (hostname.includes("linkedin")) {

    source = "LinkedIn";

    title =
      document.querySelector(
        ".job-details-jobs-unified-top-card__job-title"
      )?.innerText || "";

    company =
      document.querySelector(
        ".job-details-jobs-unified-top-card__company-name"
      )?.innerText || "";

    locationText =
      document.querySelector(
        ".job-details-jobs-unified-top-card__primary-description-container"
      )?.innerText || "";

  } else if (hostname.includes("indeed")) {

    source = "Indeed";

    title =
      document.querySelector(
        '[data-testid="jobsearch-JobInfoHeader-title"]'
      )?.innerText || "";

    company =
      document.querySelector(
        '[data-testid="inlineHeader-companyName"]'
      )?.innerText || "";

    locationText =
      document.querySelector(
        '[data-testid="job-location"]'
      )?.innerText || "";
  }

  return {
    title,
    company,
    location: locationText,
    source,
    url: window.location.href
  };
}
document.addEventListener("click", event => {

  const button =
    event.target.closest("button");

  if (!button) return;

  const text =
    button.innerText.toLowerCase();

  const looksLikeApply =
    text.includes("apply") ||
    text.includes("easy apply");

  if (!looksLikeApply) return;

  const data = getJobData();
  console.log("Sending:", data);
  chrome.runtime.sendMessage({
    type: "JOB_APPLIED",
    data
  });

  console.log(
    "Tracked application:",
    data
  );
});