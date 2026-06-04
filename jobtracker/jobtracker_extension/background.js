
//REPLACE BELOW WITH COPIED WEBHOOK or make your own .env file or similar
const WEBHOOK_URL = process.env.WEBHOOK_URL;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received:", message);

  if (message.type !== "JOB_APPLIED") return;

  fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message.data)
  })
    .then(async (r) => {
      const text = await r.text();
      console.log("Status:", r.status);
      console.log("Response:", text);
    })
    .catch((err) => {
      console.error("FETCH ERROR:", err);
    });
});