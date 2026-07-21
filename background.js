// background.js
// Receives the toolbar icon click, tells content.js to start, and forwards
// the transcript to the Hugging Face router API for summarization.

const HF_TOKEN = "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";
const HF_MODEL = "Qwen/Qwen2.5-7B-Instruct:together";

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url || !tab.url.includes("youtube.com/watch")) return;

  // If content.js has not been injected into this tab yet (e.g. the tab
  // was already open before the extension was loaded/reloaded), sending a
  // message throws "Could not establish connection". Catch it so it does
  // not show up as an uncaught error, and log a clear hint instead.
  chrome.tabs.sendMessage(tab.id, { type: "START_SUMMARIZE" }, () => {
    if (chrome.runtime.lastError) {
      console.warn(
        "[Youtube-Chatbot] Could not reach the content script. " +
        "Refresh the YouTube tab and try again.",
        chrome.runtime.lastError.message
      );
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SUMMARIZE_TRANSCRIPT") {
    handleSummarize(message.sentences)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // keep the message channel open for the async response
  }
});

async function handleSummarize(sentences) {
  // Build a compact, timestamped transcript block for the model.
  const transcriptBlock = sentences
    .map((s) => `[${s.start.toFixed(1)}s] ${s.text}`)
    .join("\n")
    .slice(0, 12000); // keep well inside the model's context window

  const systemPrompt = `You summarize YouTube video transcripts. You will receive
timed transcript lines like "[12.3s] some text". Produce 5 to 8 key points
covering what happens in the video, in order. For each point, pick the
timestamp of the transcript line it is based on.

Reply with ONLY valid JSON, no markdown, no extra text, in this exact shape:
[{"start": 12.3, "text": "short summary point"}, ...]`;

  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HF_TOKEN}`,
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcriptBlock },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`);
  }

  const data = await response.json();
  let text = data.choices[0].message.content.trim();

  // The model occasionally wraps its answer in ```json ... ``` fences —
  // strip those before parsing.
  text = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();

  let summary;
  try {
    summary = JSON.parse(text);
  } catch (e) {
    throw new Error("The model did not return valid JSON. Please try again.");
  }
  return summary;
}