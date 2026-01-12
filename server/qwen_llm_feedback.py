import json
import os
import sys

import dashscope


SYSTEM = """You are an IELTS Speaking Rater (not the examiner).
Evaluate the candidate according to official IELTS Speaking criteria:
Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation.

Return ONLY a valid JSON object and nothing else.
IMPORTANT: Provide strengths/improvements/comment in Simplified Chinese (zh-CN).
Be conservative if the transcript is short or unclear; mention limitations in the comment when evidence is insufficient.

Output JSON structure:
{
  "reportVersion": "v1",
  "score": number,
  "fluency": number,
  "vocabulary": number,
  "grammar": number,
  "pronunciation": number,
  "strengths": string[],
  "improvements": string[],
  "comment": string
}
"""


def main() -> int:
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        sys.stderr.write("DASHSCOPE_API_KEY is not set\n")
        sys.stderr.flush()
        return 2

    dashscope.api_key = api_key

    raw = sys.stdin.read()
    if not raw.strip():
        sys.stderr.write("Missing JSON stdin payload\n")
        sys.stderr.flush()
        return 3

    try:
        payload = json.loads(raw)
    except Exception as e:
        sys.stderr.write(f"Invalid JSON: {e}\n")
        sys.stderr.flush()
        return 4

    model = payload.get("model") or "qwen-plus"
    transcript = payload.get("transcript") or []

    user_text = json.dumps({"transcript": transcript}, ensure_ascii=False)

    resp = dashscope.Generation.call(
        api_key=api_key,
        model=model,
        messages=[
            {"role": "system", "content": [{"text": SYSTEM}]},
            {"role": "user", "content": [{"text": user_text}]},
        ],
        result_format="message",
        temperature=0.2,
        stream=False,
    )

    try:
        # Try dictionary-style access first
        content = resp["output"]["choices"][0]["message"]["content"]
    except Exception:
        # Fallback: try object-style access
        content = resp.output.choices[0].message.content
    
    # Handle both string and list formats
    if isinstance(content, str):
        # qwen-plus returns string directly
        out = content
    elif isinstance(content, list) and content:
        # Older format: list with dict
        out = content[0].get("text", "") if isinstance(content[0], dict) else str(content[0])
    else:
        out = str(content)

    sys.stdout.write(str(out))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


