// background.js
// Receives the toolbar icon click and forwards questions to the local
// Python server (app.py), which then talks to Hugging Face.
//
// IMPORTANT: app.py must be running on your computer (python3 app.py)
// for this to work. If it's not running, requests here will fail with
// a "Failed to fetch" style error.

const BACKEND_URL = "http://127.0.0.1:5000/summarize";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url || !tab.url.includes("youtube.com/watch")) return;

  chrome.tabs.sendMessage(tab.id, { type: "START_SUMMARIZE" }, () => {
    if (chrome.runtime.lastError) {
      console.warn(
        "[VidPilot] Could not reach the content script. " +
        "Refresh the YouTube tab and try again.",
        chrome.runtime.lastError.message
      );
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ASK_ABOUT_VIDEO") {
    handleAsk(message.sentences, message.question)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // keep the message channel open for the async response
  }
});

async function handleAsk(sentences, question) {
  let response;
  try {
    response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentences, question }),
    });
  } catch (e) {
    throw new Error(
      "Could not reach the local Python server. Make sure app.py is " +
      "running (python3 app.py) in a terminal on your computer."
    );
  }

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Backend error: ${response.status}`);
  }
  return data.summary;
}