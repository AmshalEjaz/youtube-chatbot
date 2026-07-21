// content.js
// Runs on youtube.com/watch pages. Injects a floating robot button and a
// chat-style panel that summarizes the current video.

console.log("[Youtube-Chatbot] content script loaded on", window.location.href);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SUMMARIZE") {
    runSummarizeFlow();
  }
});

// ---- Auto-injected floating robot button ----
// Appears by itself on any youtube.com/watch page. Click it to open the chat.

function injectFloatingButton() {
  if (document.getElementById("yts-fab")) return; // already there

  const fab = document.createElement("button");
  fab.id = "yts-fab";
  fab.setAttribute("aria-label", "Open Youtube-Chatbot");
  const img = document.createElement("img");
  img.src = chrome.runtime.getURL("icons/icon48.png");
  img.alt = "Youtube-Chatbot";
  fab.appendChild(img);
  fab.addEventListener("click", () => {
    runSummarizeFlow();
  });
  document.body.appendChild(fab);
}

function removeFloatingButtonIfNotWatchPage() {
  const fab = document.getElementById("yts-fab");
  if (fab && !window.location.pathname.startsWith("/watch")) {
    fab.remove();
  }
}

function checkPageAndToggleButton() {
  if (window.location.pathname.startsWith("/watch")) {
    injectFloatingButton();
  } else {
    removeFloatingButtonIfNotWatchPage();
  }
}

checkPageAndToggleButton();

// YouTube is a single-page app - it swaps the URL without a full reload
// when you open another video. This event fires when that navigation
// finishes, so we re-check whether the button should show.
document.addEventListener("yt-navigate-finish", checkPageAndToggleButton);

// ---- Chat panel UI ----

function getOrCreatePanel() {
  let panel = document.getElementById("yts-bot-panel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "yts-bot-panel";
  panel.innerHTML = `
    <div class="yts-sprockets" aria-hidden="true"></div>
    <div class="yts-main">
      <div class="yts-header">
        <img class="yts-header-logo" src="${chrome.runtime.getURL("icons/icon48.png")}" alt="">
        <span class="yts-rec" id="yts-rec"></span>
        <div class="yts-heading">
          <span class="yts-title">Youtube-Chatbot</span>
          <span class="yts-subtitle">AI video assistant</span>
        </div>
        <button class="yts-close" id="yts-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="yts-chat-log" id="yts-chat-log"></div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#yts-close-btn").addEventListener("click", () => {
    panel.remove();
  });

  // Decorative sprocket rail on the left edge.
  const rail = panel.querySelector(".yts-sprockets");
  for (let i = 0; i < 12; i++) {
    const hole = document.createElement("span");
    hole.className = "yts-hole";
    rail.appendChild(hole);
  }

  return panel;
}

function setRecording(isActive) {
  const rec = document.getElementById("yts-rec");
  if (rec) rec.classList.toggle("yts-rec-active", isActive);
}

function getChatLog() {
  return getOrCreatePanel().querySelector("#yts-chat-log");
}

function scrollChatToBottom() {
  const log = getChatLog();
  log.scrollTop = log.scrollHeight;
}

// Adds a new chat bubble from the bot and returns it, so callers can
// update or remove it later (e.g. a "thinking..." bubble).
function addBotMessage(innerHTML, extraClass = "") {
  const log = getChatLog();
  const row = document.createElement("div");
  row.className = "yts-msg-row";
  row.innerHTML = `
    <img class="yts-avatar" src="${chrome.runtime.getURL("icons/icon48.png")}" alt="">
    <div class="yts-bubble ${extraClass}">${innerHTML}</div>
  `;
  log.appendChild(row);
  scrollChatToBottom();
  return row;
}

function clearChatLog() {
  getChatLog().innerHTML = "";
}

function formatTimestamp(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function seekVideoTo(seconds) {
  const video = document.querySelector("video");
  if (video) {
    video.currentTime = seconds;
    video.play().catch(() => {});
  }
}

// ---- Transcript extraction ----
// Reads the caption track URL out of the watch page's player data, the
// same technique youtube-transcript-api uses. Returns sentences WITH
// their timestamps so the chat can offer click-to-seek on every point.

const TIME_MARKER = "\u0000"; // invisible marker, stripped before display

async function fetchTranscriptSentences() {
  const res = await fetch(window.location.href, { credentials: "include" });
  const html = await res.text();

  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
  if (!match) {
    throw new Error(
      "I couldn't read this video's data from the page. Try refreshing and asking again."
    );
  }

  let playerResponse;
  try {
    playerResponse = JSON.parse(match[1]);
  } catch (e) {
    throw new Error("I couldn't parse this video's player data.");
  }

  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    throw new Error(
      "This video doesn't have captions/transcript available, so I can't summarize it."
    );
  }

  // Prefer English, otherwise take the first available track.
  const track =
    tracks.find((t) => t.languageCode?.startsWith("en")) || tracks[0];

  const captionRes = await fetch(track.baseUrl + "&fmt=json3");
  const captionData = await captionRes.json();

  // Stitch every caption event into one string, prefixing each event with
  // an invisible \0<seconds>\0 marker so we can recover the start time of
  // whichever event a sentence began in, after splitting into sentences.
  const marked = (captionData.events || [])
    .filter((e) => e.segs && e.segs.length)
    .map((e) => {
      const text = e.segs.map((s) => s.utf8).join("");
      const startSec = (e.tStartMs ?? 0) / 1000;
      return `${TIME_MARKER}${startSec}${TIME_MARKER}${text}`;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!marked) {
    throw new Error("The transcript came back empty.");
  }

  const markerRe = new RegExp(`${TIME_MARKER}([\\d.]+)${TIME_MARKER}`, "g");
  const chunks = marked.split(/(?<=[.?!])\s+(?=[A-Z0-9])/);

  const sentences = [];
  for (const chunk of chunks) {
    const times = [...chunk.matchAll(markerRe)].map((m) => parseFloat(m[1]));
    const cleanText = chunk.replace(markerRe, "").trim();
    if (cleanText.length > 15 && times.length > 0) {
      sentences.push({ text: cleanText, start: times[0] });
    }
  }

  if (sentences.length === 0) {
    throw new Error("I couldn't find readable sentences in the transcript.");
  }
  return sentences;
}

// ---- Main flow triggered by clicking the robot button ----

async function runSummarizeFlow() {
  getOrCreatePanel();
  clearChatLog();
  setRecording(true);

  addBotMessage("Hi! Let me take a look at this video for you.");
  const statusBubble = addBotMessage("Reading the transcript&hellip;", "yts-typing");

  let sentences;
  try {
    sentences = await fetchTranscriptSentences();
  } catch (err) {
    setRecording(false);
    statusBubble.querySelector(".yts-bubble").outerHTML =
      `<div class="yts-bubble yts-error">${err.message}</div>`;
    return;
  }

  statusBubble.querySelector(".yts-bubble").innerHTML =
    "Got it. Thinking through the key moments&hellip;";

  chrome.runtime.sendMessage(
    { type: "SUMMARIZE_TRANSCRIPT", sentences },
    (response) => {
      setRecording(false);

      if (chrome.runtime.lastError) {
        statusBubble.querySelector(".yts-bubble").outerHTML =
          `<div class="yts-bubble yts-error">${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (!response || !response.ok) {
        statusBubble.querySelector(".yts-bubble").outerHTML =
          `<div class="yts-bubble yts-error">${response?.error || "Something went wrong."}</div>`;
        return;
      }

      statusBubble.remove();
      addBotMessage("Here's what happens in this video:");

      response.summary.forEach((item) => {
        const html = `
          <button class="yts-timestamp" data-seek="${item.start}">
            <span class="yts-play">&#9654;</span>${formatTimestamp(item.start)}
          </button>
          <span class="yts-frame-text">${item.text}</span>
        `;
        const row = addBotMessage(html);
        row.querySelector(".yts-timestamp").addEventListener("click", (e) => {
          seekVideoTo(parseFloat(e.currentTarget.dataset.seek));
        });
      });
    }
  );
}