// offscreen.js
// This is where the actual "AI" happens — fully local, in your browser,
// using a free Hugging Face sentence-embedding model via transformers.js.
// No Claude/OpenAI API, no API key, no server.
//
// Technique: EXTRACTIVE summarization.
//   1. Split the transcript into sentences.
//   2. Turn every sentence into a vector (embedding) with the HF model.
//   3. Find the "average" vector (the centroid) — this represents the
//      overall topic of the whole video.
//   4. Score each sentence by how close it is to that centroid.
//   5. Return the top-scoring sentences, back in their original order.
// This is the same idea as the classic "TextRank / LexRank" summarizers,
// just using modern embeddings instead of word overlap.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4";

// Keep the model fully in the browser cache (IndexedDB) so it only
// downloads once, ever.
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX"; // ~30MB, fast, good quality
const NUM_SUMMARY_SENTENCES = 6;

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID);
  }
  return extractorPromise;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized, so dot product == cosine similarity
}

// `sentences` is an array of { text, start } — start is the timestamp
// (in seconds) where that sentence begins in the video. content.js already
// did the sentence-splitting, since it needs the timing info from the
// caption track anyway. We just pick the best ones here.
async function summarize(sentences) {
  if (!sentences || sentences.length === 0) {
    throw new Error("Transcript mein readable sentences nahi mile.");
  }
  if (sentences.length <= NUM_SUMMARY_SENTENCES) {
    return sentences;
  }

  const extractor = await getExtractor();

  // Embed every sentence (normalized so we can use plain dot product).
  const embeddings = [];
  for (const { text } of sentences) {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    embeddings.push(Array.from(output.data));
  }

  // Compute centroid vector (average of all sentence embeddings).
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const vec of embeddings) {
    for (let i = 0; i < dim; i++) centroid[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= embeddings.length;

  // Score each sentence by similarity to the centroid (= "how central /
  // representative is this sentence to the whole video's topic").
  const scored = sentences.map((item, idx) => ({
    item,
    idx,
    score: cosineSimilarity(embeddings[idx], centroid),
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, NUM_SUMMARY_SENTENCES);

  // Put the chosen sentences back in the order they appeared in the video.
  top.sort((a, b) => a.idx - b.idx);
  return top.map((s) => s.item); // { text, start }[]
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_SUMMARIZE") {
    summarize(message.sentences)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  }
});
