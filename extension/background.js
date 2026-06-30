// Local job-tracker server (see ../server.py). The content script can't POST to
// localhost directly (page CSP / cross-origin), so it messages this service
// worker and we do the fetch here.
const WEBHOOK_URL = "http://localhost:5000/track";

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "JOB_APPLIED") return;

  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.data),
  })
    .then(async (r) => {
      console.log("Job Tracker server:", r.status, await r.text());
    })
    .catch((err) => {
      console.error(
        "Job Tracker — could not reach server. Is server.py running?",
        err
      );
    });
});
