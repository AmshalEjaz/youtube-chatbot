// background.js
// Think of this like a Laravel "Controller" — it doesn't do the heavy work
// itself, it just receives the request (icon click) and routes it to the
// right place (content.js on the page, and offscreen.js for AI work).

const OFFSCREEN_URL = "offscreen.html";

// 1) Robot icon clicked in the toolbar -> tell the content script (running
//    on the YouTube page) to start summarizing.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.includes("youtube.com/watch")) {
    return; // not a YouTube video page, do nothing
  }
  chrome.tabs.sendMessage(tab.id, { type: "START_SUMMARIZE" });
});

// 2) content.js sends the transcript text here once it has scraped it.
//    We forward it to the offscreen document, which runs the Hugging Face
//    embedding model (transformers.js) fully inside the browser.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUMMARIZE_TRANSCRIPT") {
    handleSummarize(message.sentences)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }
});

let creatingOffscreen; // avoids creating the offscreen doc twice at once

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS"],
    justification:
      "Run a Hugging Face sentence-embedding model (transformers.js) fully " +
      "in-browser to produce a free, local summary of the video transcript.",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function handleSummarize(sentences) {
  await ensureOffscreenDocument();

  // Ask the offscreen document to do the embedding + ranking work.
  const response = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_SUMMARIZE",
    sentences,
  });

  if (!response || !response.ok) {
    throw new Error(response?.error || "Offscreen summarization failed.");
  }
  return response.summary;
}
