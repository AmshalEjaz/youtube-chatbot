
// If the extension gets reloaded/updated while this 
function isExtensionContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeIconUrl(path) {
  try {
    return chrome.runtime.getURL(path);
  } catch (e) {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SUMMARIZE") {
    openPanel();
  }
});

// Cache the transcript per video so we don't re-fetch it on every question.
let cachedVideoId = null;
let cachedSentences = null;
let cachedTranscriptError = null;

// ---- Auto-injected floating button ----

function injectFloatingButton() {
  if (document.getElementById("yts-fab")) return;
  if (!isExtensionContextValid()) return;

  const fab = document.createElement("button");
  fab.id = "yts-fab";
  fab.setAttribute("aria-label", "Open VidPilot");
  const img = document.createElement("img");
  img.src = safeIconUrl("icons/icon48.png");
  img.alt = "VidPilot";
  fab.appendChild(img);
  fab.addEventListener("click", () => openPanel());
  document.body.appendChild(fab);
}

function removeFloatingButtonIfNotWatchPage() {
  const fab = document.getElementById("yts-fab");
  if (fab && !window.location.pathname.startsWith("/watch")) {
    fab.remove();
  }
}

function checkPageAndToggleButton() {
  if (!isExtensionContextValid()) return;

  if (window.location.pathname.startsWith("/watch")) {
    injectFloatingButton();
    updatePanelVideoTitle();
  } else {
    removeFloatingButtonIfNotWatchPage();
  }
}

checkPageAndToggleButton();

// YouTube is a single-page app - it swaps the URL without a full reload
// when you open another video. Poll for the video ID changing so the
// cached transcript and header title stay in sync.
let lastVideoId = getVideoIdFromUrlSafe();
setInterval(() => {
  const id = getVideoIdFromUrlSafe();
  if (id !== lastVideoId) {
    lastVideoId = id;
    cachedVideoId = null;
    cachedSentences = null;
    cachedTranscriptError = null;
    updatePanelVideoTitle();
    checkPageAndToggleButton();
  }
}, 500);

function getVideoIdFromUrlSafe() {
  try {
    return new URL(window.location.href).searchParams.get("v");
  } catch (e) {
    return null;
  }
}

// ---- Chat panel UI ----

function getOrCreatePanel() {
  let panel = document.getElementById("yts-bot-panel");
  if (panel) return panel;

  if (!isExtensionContextValid()) {
    alert(
      "VidPilot was just updated. Please refresh this YouTube page (Ctrl+Shift+R) and try again."
    );
    return null;
  }

  panel = document.createElement("div");
  panel.id = "yts-bot-panel";
  panel.innerHTML = `
    <div class="yts-sprockets" aria-hidden="true"></div>
    <div class="yts-main">
      <div class="yts-header">
        <img class="yts-header-logo" src="${safeIconUrl("icons/icon48.png")}" alt="">
        <span class="yts-rec" id="yts-rec"></span>
        <div class="yts-heading">
          <span class="yts-title">VidPilot</span>
          <span class="yts-subtitle" id="yts-video-title">AI video assistant</span>
        </div>
        <button class="yts-close" id="yts-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="yts-chat-log" id="yts-chat-log"></div>
      <form class="yts-input-row" id="yts-input-form">
        <input
          type="text"
          id="yts-input"
          class="yts-input"
          placeholder="Ask about this video, or say 'summarize'..."
          autocomplete="off"
        />
        <button type="submit" class="yts-send" aria-label="Send">&#10148;</button>
      </form>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector("#yts-close-btn").addEventListener("click", () => panel.remove());

  panel.querySelector("#yts-input-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = panel.querySelector("#yts-input");
    const question = input.value.trim();
    input.value = "";
    askVidPilot(question);
  });

  const rail = panel.querySelector(".yts-sprockets");
  for (let i = 0; i < 12; i++) {
    const hole = document.createElement("span");
    hole.className = "yts-hole";
    rail.appendChild(hole);
  }

  return panel;
}

function updatePanelVideoTitle() {
  const el = document.getElementById("yts-video-title");
  if (!el) return;
  const title = getVideoTitle();
  const id = getVideoIdFromUrlSafe();
  el.innerHTML = `
    <div>${escapeHtml(title || "AI video assistant")}</div>
    <div style="font-size:11px; color:rgba(255,255,255,0.7); margin-top:2px;">
      Video ID: ${escapeHtml(id || "-")}
    </div>
  `;
}

function openPanel() {
  const alreadyExists = !!document.getElementById("yts-bot-panel");
  const panel = getOrCreatePanel();
  if (!panel) return;
  updatePanelVideoTitle();
  if (!alreadyExists) {
    addBotMessage(
      "Hi, I'm VidPilot 🤖 Ask me anything about this video, or just type " +
      "<em>\"summarize\"</em> and I'll tell you what's going on."
    );
  }
  panelInputFocus();
}

function panelInputFocus() {
  const input = document.getElementById("yts-input");
  if (input) input.focus();
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

function addUserMessage(text) {
  const log = getChatLog();
  const row = document.createElement("div");
  row.className = "yts-msg-row yts-msg-row-user";
  row.innerHTML = `<div class="yts-bubble yts-bubble-user"></div>`;
  row.querySelector(".yts-bubble-user").textContent = text;
  log.appendChild(row);
  scrollChatToBottom();
  return row;
}

function addBotMessage(innerHTML, extraClass = "") {
  const log = getChatLog();
  const row = document.createElement("div");
  row.className = "yts-msg-row";
  row.innerHTML = `
    <img class="yts-avatar" src="${safeIconUrl("icons/icon48.png")}" alt="">
    <div class="yts-bubble ${extraClass}">${innerHTML}</div>
  `;
  log.appendChild(row);
  scrollChatToBottom();
  return row;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function seekVideoTo(seconds) {
  const video = document.querySelector("video");
  if (video) {
    video.currentTime = seconds;
    video.play().catch(() => {});
  }
}

function getVideoTitle() {
  return document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
}

// ============================================================
// Transcript extraction - THE PART THAT MOST OFTEN BREAKS
// ============================================================

function getPlayerResponseFromCurrentPage() {
  for (const script of document.scripts) {
    const txt = script.textContent;
    if (txt && txt.includes("ytInitialPlayerResponse")) {
      const match = txt.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          // keep looking in other script tags
        }
      }
    }
  }
  return null;
}

// Method B: re-fetch the watch page's HTML fresh over the network and
// extract the player data from that instead. Sometimes the currently
// rendered page's scripts don't have it (e.g. right after a client-side
// navigation) but a fresh fetch does.
async function getPlayerResponseFromFreshFetch() {
  const res = await fetch(window.location.href, { credentials: "include" });
  const html = await res.text();
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

function extractCaptionTracks(playerResponse) {
  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function pickBestTrack(tracks) {
  return (
    tracks.find((t) => t.languageCode === "en") ||
    tracks.find((t) => t.languageCode?.startsWith("en")) ||
    tracks.find((t) => t.kind === "asr") ||
    tracks[0]
  );
}

// Fetch the actual caption text for a track. Tries the json3 format
// first (easy to parse), falls back to the default XML format if that
// comes back empty (this happens for some tracks/videos).
async function fetchCaptionEvents(baseUrl) {
  try {
    const res = await fetch(baseUrl + "&fmt=json3", { credentials: "include" });
    const raw = await res.text();
    if (raw.trim()) {
      const data = JSON.parse(raw);
      const events = (data.events || [])
        .filter((e) => e.segs && e.segs.length)
        .map((e) => ({
          text: e.segs.map((s) => s.utf8).join(""),
          startSec: (e.tStartMs ?? 0) / 1000,
        }))
        .filter((e) => e.text.trim());
      if (events.length > 0) return events;
    }
  } catch (e) {
    // fall through to XML attempt
  }

  const res = await fetch(baseUrl, { credentials: "include" });
  const xmlText = await res.text();
  if (!xmlText.trim()) return [];

  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const nodes = [...doc.getElementsByTagName("text")];
  return nodes
    .map((node) => ({
      text: (node.textContent || "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim(),
      startSec: parseFloat(node.getAttribute("start") || "0"),
    }))
    .filter((e) => e.text);
}

// Top-level function: tries both methods to get the player data, then
// pulls the transcript out of whichever one worked.
async function fetchTranscriptSentences() {
  let playerResponse = getPlayerResponseFromCurrentPage();

  if (!playerResponse || extractCaptionTracks(playerResponse).length === 0) {
    try {
      const fresh = await getPlayerResponseFromFreshFetch();
      if (fresh) playerResponse = fresh;
    } catch (e) {
      console.warn("[VidPilot] Fresh-fetch player data attempt failed:", e);
    }
  }

  if (!playerResponse) {
    throw new Error("Could not read this video's player data from the page.");
  }

  const tracks = extractCaptionTracks(playerResponse);
  if (tracks.length === 0) {
    throw new Error("This video has no captions available.");
  }

  const track = pickBestTrack(tracks);
  const events = await fetchCaptionEvents(track.baseUrl);

  if (events.length === 0) {
    throw new Error(
      "YouTube returned an empty response for this video's captions."
    );
  }

  return events.map((e) => ({ text: e.text, start: e.startSec }));
}

async function getSentencesForCurrentVideo() {
  const videoId = getVideoIdFromUrlSafe();
  if (cachedVideoId === videoId && cachedSentences) {
    return { sentences: cachedSentences, error: null };
  }
  try {
    const sentences = await fetchTranscriptSentences();
    cachedVideoId = videoId;
    cachedSentences = sentences;
    cachedTranscriptError = null;
    return { sentences, error: null };
  } catch (e) {
    console.error("[VidPilot] Transcript fetch failed:", e);
    cachedVideoId = videoId;
    cachedSentences = null;
    cachedTranscriptError = e.message;
    return { sentences: [], error: e.message };
  }
}

// ---- Main flow: ask VidPilot something ----

async function askVidPilot(question) {
  addUserMessage(question || "Summarize this video");
  setRecording(true);

  const statusBubble = addBotMessage("Reading the transcript&hellip;", "yts-typing");

  const { sentences, error: transcriptError } = await getSentencesForCurrentVideo();

  statusBubble.querySelector(".yts-bubble").innerHTML = "Thinking&hellip;";

  chrome.runtime.sendMessage(
    {
      type: "ASK_ABOUT_VIDEO",
      sentences,
      question,
      videoTitle: getVideoTitle(),
      videoId: getVideoIdFromUrlSafe(),
      transcriptError,
    },
    (response) => {
      setRecording(false);

      if (chrome.runtime.lastError) {
        statusBubble.querySelector(".yts-bubble").outerHTML =
          `<div class="yts-bubble yts-error">${escapeHtml(chrome.runtime.lastError.message)}</div>`;
        return;
      }
      if (!response || !response.ok) {
        statusBubble.querySelector(".yts-bubble").outerHTML =
          `<div class="yts-bubble yts-error">${escapeHtml(response?.error || "Something went wrong.")}</div>`;
        return;
      }

      statusBubble.remove();
      addBotMessage(escapeHtml(response.summary));
    }
  );
}