// content.js
// Runs on youtube.com/watch pages. Injects a floating VidPilot button and a
// chat panel where you can ask questions about the current video.

console.log("[VidPilot] content script loaded on", window.location.href);

// If the extension gets reloaded/updated while this tab is still open, the
// old content script instance loses its connection to chrome.* APIs and
// throws "Extension context invalidated." This checks for that case so we
// can show a friendly message instead of crashing.
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
    return ""; // extension context is gone; caller should have already checked
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

// ---- Auto-injected floating button ----

function injectFloatingButton() {
  if (document.getElementById("yts-fab")) return; // already there
  if (!isExtensionContextValid()) return; // extension was reloaded; wait for tab refresh

  const fab = document.createElement("button");
  fab.id = "yts-fab";
  fab.setAttribute("aria-label", "Open VidPilot");
  const img = document.createElement("img");
  img.src = safeIconUrl("icons/icon48.png");
  img.alt = "VidPilot";
  fab.appendChild(img);
  fab.addEventListener("click", () => {
    openPanel();
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
  if (!isExtensionContextValid()) return; // extension was reloaded; this tab needs a refresh

  if (window.location.pathname.startsWith("/watch")) {
    injectFloatingButton();
    updatePanelVideoTitle();
  } else {
    removeFloatingButtonIfNotWatchPage();
  }
}

checkPageAndToggleButton();
let lastVideo="";

setInterval(()=>{

    const id=getVideoIdFromUrl();

    if(id!==lastVideo){

        lastVideo=id;

        cachedVideoId=null;

        cachedSentences=null;

        updatePanelVideoTitle();

        console.log("Video Changed :",id);

    }

},500);
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

  panel.querySelector("#yts-close-btn").addEventListener("click", () => {
    panel.remove();
  });

  panel.querySelector("#yts-input-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = panel.querySelector("#yts-input");
    const question = input.value.trim();
    input.value = "";
    askVidPilot(question);
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
function updatePanelVideoTitle(){

    const el=document.getElementById("yts-video-title");

    if(!el) return;

    const title=getVideoTitle();

    const id=getVideoIdFromUrl();

    el.innerHTML=`
        <div>${title}</div>
        <div style="
            font-size:11px;
            color:#d9d9d9;
            margin-top:3px;
        ">
            Video ID : ${id}
        </div>
    `;
}

// Opens the panel and shows a greeting the first time it's created.
// Waits for the user to type before responding.
function openPanel() {
  const alreadyExists = !!document.getElementById("yts-bot-panel");
  const panel = getOrCreatePanel();
  if (!panel) return; // extension context invalid; alert already shown
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

// YouTube's caption endpoint sometimes returns an empty body for the
// json3 format (depending on the video/track). If that happens, fall
// back to the default XML transcript format instead of crashing.
async function fetchCaptionEvents(baseUrl) {
  // Attempt 1: json3 format (easiest to parse).
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
    // fall through to the XML attempt below
  }

  // Attempt 2: default XML transcript format.
  const res = await fetch(baseUrl, { credentials: "include" });
  const xmlText = await res.text();
  if (!xmlText.trim()) {
    throw new Error(
      "YouTube didn't return any caption data for this video. Try again in a moment."
    );
  }

  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const nodes = [...doc.getElementsByTagName("text")];
  const events = nodes
    .map((node) => ({
      text: (node.textContent || "")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim(),
      startSec: parseFloat(node.getAttribute("start") || "0"),
    }))
    .filter((e) => e.text);

  if (events.length === 0) {
    throw new Error(
      "YouTube didn't return any caption data for this video. Try again in a moment."
    );
  }
  return events;
}

function getVideoIdFromUrl() {
  return new URL(window.location.href).searchParams.get("v");
}

function getVideoTitle() {
  // The document title is "<video title> - YouTube"; strip that suffix.
  return document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
}

async function fetchTranscriptSentences() {

    let playerResponse =
        window.ytInitialPlayerResponse ||
        window.ytplayer?.config?.args?.player_response;

    if (!playerResponse) {

        const scripts = [...document.scripts];

        for (const script of scripts) {

            const txt = script.textContent;

            if (txt.includes("ytInitialPlayerResponse")) {

                const match = txt.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);

                if (match) {
                    try {
                        playerResponse = JSON.parse(match[1]);
                        break;
                    } catch(e){}
                }
            }
        }
    }

    if (!playerResponse) {
        throw new Error("Unable to load YouTube player information.");
    }

    const captionTracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captionTracks || captionTracks.length === 0) {

        throw new Error(
            "This video has no captions. I can still answer normal questions, but I can't summarize the video."
        );
    }

    const preferred =
        captionTracks.find(t => t.languageCode === "en") ||
        captionTracks.find(t => t.languageCode === "en-US") ||
        captionTracks.find(t => t.kind === "asr") ||
        captionTracks[0];

    const events = await fetchCaptionEvents(preferred.baseUrl);

    return events.map(e => ({
        text: e.text,
        start: e.startSec
    }));
}

async function getSentencesForCurrentVideo() {
  const videoId = getVideoIdFromUrl();
  if (cachedVideoId === videoId && cachedSentences) {
    return cachedSentences;
  }
  const sentences = await fetchTranscriptSentences();
  cachedVideoId = videoId;
  cachedSentences = sentences;
  return sentences;
}

// ---- Main flow: ask VidPilot something (typed by the user, or the
// automatic first summary when the panel opens) ----

async function askVidPilot(question, { showUserBubble = true } = {}) {
  if (showUserBubble) {
    addUserMessage(question || "Summarize this video");
  }
  setRecording(true);

  const statusBubble = addBotMessage("Reading the transcript&hellip;", "yts-typing");

let sentences;
try{

    sentences = await getSentencesForCurrentVideo();

}catch(e){

    console.error("[VidPilot] Transcript fetch failed:", e);
    sentences = [];
}

  statusBubble.querySelector(".yts-bubble").innerHTML = "Thinking&hellip;";

  chrome.runtime.sendMessage(
  {
      type:"ASK_ABOUT_VIDEO",
      sentences,
      question,
      videoTitle: getVideoTitle(),
      videoId: getVideoIdFromUrl()
  },
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
      addBotMessage(escapeHtml(response.summary));
    }
  );
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}