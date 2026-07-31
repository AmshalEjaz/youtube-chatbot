from flask import Flask, request, jsonify
from flask_cors import CORS
import ollama

# ---------------------------------------
# Ollama Configuration
# ---------------------------------------

OLLAMA_MODEL = "qwen2.5:1.5b"

app = Flask(__name__)
CORS(app)

# ---------------------------------------
# Error Handler
# ---------------------------------------

@app.errorhandler(Exception)
def handle_any_error(e):
    print("Unhandled Error:", e)
    return jsonify({
        "ok": False,
        "error": str(e)
    }), 500

# ---------------------------------------
# AI System Prompt
# ---------------------------------------

SYSTEM_PROMPT = """
You are VidPilot, an AI assistant running inside YouTube.

Rules:

1. If a transcript is provided, answer using that transcript.

2. If no transcript is available, respond naturally in your own words
based on what you know (video title, question asked) - don't refuse,
just be upfront that you're working with limited information.

3. Never invent specific details that aren't in the transcript.

4. If the question is NOT about the video, answer normally like ChatGPT.

Always reply in plain English. Never use markdown. Never use bullet
points unless requested.
"""
# ---------------------------------------
# API
# ---------------------------------------

@app.route("/summarize", methods=["POST"])
def summarize():

    data = request.get_json(force=True)

    sentences = data.get("sentences", [])

    question = data.get("question", "").strip()

    video_title = data.get("title", "")

    video_id = data.get("videoId", "")

    if question == "":
        question = "Summarize this video."

    transcript = ""

    if sentences:

        transcript = "\n".join(

            f"[{float(s.get('start',0)):.1f}s] {s.get('text','')}"

            for s in sentences

            if s.get("text")

        )

    if transcript:

        user_prompt = f"""

Current Video

Title:
{video_title}

Video ID:
{video_id}

Transcript:

{transcript}

User Question:

{question}

"""

    else:

        user_prompt = f"""

Current Video

Title:
{video_title}

Video ID:
{video_id}

No transcript exists.

User Question:

{question}

"""

    try:

        print("="*60)
        print("VIDEO :", video_title)
        print("ID    :", video_id)
        print("QUESTION :", question)
        print("="*60)

        response = ollama.chat(

            model=OLLAMA_MODEL,

            messages=[

                {
                    "role":"system",
                    "content":SYSTEM_PROMPT
                },

                {
                    "role":"user",
                    "content":user_prompt
                }

            ]

        )

        answer = response["message"]["content"]

        return jsonify({

            "ok":True,

            "summary":answer

        })

    except Exception as e:

        print(e)

        return jsonify({

            "ok":False,

            "error":str(e)

        }),500


# ---------------------------------------
# Home
# ---------------------------------------

@app.route("/")
def home():

    return "VidPilot Backend Running with Ollama"


# ---------------------------------------
# Run
# ---------------------------------------

if __name__ == "__main__":

    print("="*60)
    print("VidPilot Backend")
    print("Running on http://127.0.0.1:5000")
    print("Model :", OLLAMA_MODEL)
    print("="*60)

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )