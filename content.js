// content.js
// Runs directly on youtube.com/watch pages (this is your "view layer" —
// like a Blade template + a bit of Alpine/vanilla JS on top).

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_SUMMARIZE") {
    runSummarizeFlow();
  }
});

function getVideoIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("v");
}



function getOrCreatePanel() {
  let panel = document.getElementById("yts-bot-panel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "yts-bot-panel";
  panel.innerHTML = `
    <div class="yts-sprockets" aria-hidden="true"></div>
    <div class="yts-main">
      <div class="yts-header">
        <span class="yts-rec" id="yts-rec"></span>
        <div class="yts-heading">
          <span class="yts-title">YT Summarizer</span>
          <span class="yts-subtitle">local &middot; on-device</span>
        </div>
        <button class="yts-close" id="yts-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="yts-body" id="yts-body">
        <p class="yts-status">Ready.</p>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  panel.querySelector("#yts-close-btn").addEventListener("click", () => {
    panel.remove();
  });

  // 12 sprocket holes down the left rail, purely decorative (the film-strip
  // signature element).
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

function setBody(html) {
  const panel = getOrCreatePanel();
  panel.querySelector("#yts-body").innerHTML = html;
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

// ---- Transcript extraction (same technique youtube-transcript-api uses:
// read the caption track URL out of the watch page's player data) ----
// Returns sentences WITH their timestamps, so the panel can offer
// click-to-seek on every summary point.

const TIME_MARKER = "\u0000"; // invisible marker, stripped before display

async function fetchTranscriptSentences() {
  const res = await fetch(window.location.href, { credentials: "include" });
  const html = await res.text();

  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|<\/script>)/s);
  if (!match) {
    throw new Error(
      "Video ka data page se nahi mil saka. Page ko refresh karke dubara try karein."
    );
  }

  let playerResponse;
  try {
    playerResponse = JSON.parse(match[1]);
  } catch (e) {
    throw new Error("Player data parse nahi ho saka.");
  }

  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    throw new Error(
      "Is video mein captions/transcript available nahi hain, isliye summarize nahi ho sakta."
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
    throw new Error("Transcript khaali mila.");
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
    throw new Error("Transcript se readable sentences nahi mil sake.");
  }
  return sentences;
}

// ---- Main flow triggered by clicking the toolbar robot icon ----

async function runSummarizeFlow() {
  getOrCreatePanel();
  setRecording(true);
  setBody(`<p class="yts-status">Transcript nikal raha hoon&hellip;</p>`);

  let sentences;
  try {
    sentences = await fetchTranscriptSentences();
  } catch (err) {
    setRecording(false);
    setBody(`<p class="yts-error">${err.message}</p>`);
    return;
  }

  setBody(
    `<p class="yts-status">Local AI model (Hugging Face) se key frames chun raha hoon&hellip;<br><span class="yts-status-sub">Pehli baar model download hota hai (~30MB) — uske baad turant chalega.</span></p>`
  );

  chrome.runtime.sendMessage(
    { type: "SUMMARIZE_TRANSCRIPT", sentences },
    (response) => {
      setRecording(false);
      if (chrome.runtime.lastError) {
        setBody(`<p class="yts-error">${chrome.runtime.lastError.message}</p>`);
        return;
      }
      if (!response || !response.ok) {
        setBody(
          `<p class="yts-error">${response?.error || "Kuch ghalat ho gaya."}</p>`
        );
        return;
      }

      const frames = response.summary
        .map(
          (item, i) => `
          <li class="yts-frame">
            <button class="yts-timestamp" data-seek="${item.start}">
              <span class="yts-play">&#9654;</span>${formatTimestamp(item.start)}
            </button>
            <span class="yts-frame-text">${item.text}</span>
          </li>`
        )
        .join("");

      setBody(`
        <p class="yts-label">Is video mein ye ho raha hai</p>
        <ul class="yts-list">${frames}</ul>
      `);

      document.querySelectorAll(".yts-timestamp").forEach((btn) => {
        btn.addEventListener("click", () => {
          seekVideoTo(parseFloat(btn.dataset.seek));
        });
      });
    }
  );
}
