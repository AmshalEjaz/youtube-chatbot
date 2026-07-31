from flask import Flask, request, jsonify
from flask_cors import CORS
import ollama

OLLAMA_MODEL = "qwen2.5:1.5b"

app = Flask(__name__)
CORS(app)


@app.errorhandler(Exception)
def handle_any_error(e):
    # Without this, an unexpected Python error returns an HTML error page,
    # and the extension can't parse that as JSON ("Unexpected end of JSON
    # input"). This guarantees valid JSON is always returned.
    print("Unhandled error:", repr(e))
    return jsonify({"ok": False, "error": f"Server error: {e}"}), 500


SYSTEM_PROMPT = """You are VidPilot, a friendly AI assistant chatting inside a
YouTube page. You will get the video's title, and possibly a timed
transcript (lines like "[12.3s] some text"), followed by the user's
message.

1. If a transcript is provided and the question is about the video,
   answer using that transcript. Keep it to one short paragraph
   (3-5 sentences), plain text, no lists, no markdown.

2. If NO transcript is available, say so briefly in your own words, but
   still try to be helpful using the video title if it gives any hint.
   Don't just refuse - be conversational about it.

3. If the question is unrelated to the video (small talk, a general
   question), just answer it normally and helpfully, in 1-3 short
   sentences. Don't force it back to the video.

4. Never invent specific facts that aren't in the transcript.

Always reply in plain text. No markdown, no bullet points."""


@app.route("/summarize", methods=["POST"])
def summarize():
    data = request.get_json(force=True)

    sentences = data.get("sentences", []) or []
    question = (data.get("question") or "").strip() or "Summarize this video."
    video_title = data.get("videoTitle", "") or ""
    video_id = data.get("videoId", "") or ""
    transcript_error = data.get("transcriptError", "") or ""

    transcript = ""
    if sentences:
        transcript = "\n".join(
            f"[{float(s.get('start', 0)):.1f}s] {s.get('text', '')}"
            for s in sentences
            if s.get("text")
        )

    if transcript:
        context_block = f"Transcript:\n{transcript}"
    elif transcript_error:
        context_block = f"No transcript is available. (Reason: {transcript_error})"
    else:
        context_block = "No transcript is available for this video."

    user_prompt = f"""Video title: {video_title}
Video ID: {video_id}

{context_block}

User message: {question}"""

    print("=" * 60)
    print("VIDEO:", video_title, "| ID:", video_id)
    print("HAS TRANSCRIPT:", bool(transcript), "| QUESTION:", question)
    print("=" * 60)

    response = ollama.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )

    answer = response["message"]["content"]
    if not answer or not answer.strip():
        return jsonify({"ok": False, "error": "The model returned an empty response."}), 500

    return jsonify({"ok": True, "summary": answer.strip()})


@app.route("/")
def home():
    return "VidPilot backend is running."


if __name__ == "__main__":
    print("=" * 60)
    print("VidPilot backend")
    print("Running on http://127.0.0.1:5000")
    print("Model:", OLLAMA_MODEL)
    print("=" * 60)
    app.run(host="127.0.0.1", port=5000, debug=False)