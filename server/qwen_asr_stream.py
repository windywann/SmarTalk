import argparse
import os
import sys

import dashscope


def main():
    parser = argparse.ArgumentParser(description="DashScope Qwen3 ASR stream helper")
    parser.add_argument("--audio-url", required=True, help="Publicly accessible audio URL")
    parser.add_argument("--language", default="", help="Optional language hint, e.g. en, zh")
    parser.add_argument("--enable-itn", default="", help="true/false to enable inverse text normalization")
    parser.add_argument("--context", default="", help="Optional context prompt for customization")
    args = parser.parse_args()

    base_url = os.getenv("DASHSCOPE_BASE_HTTP_API_URL", "https://dashscope.aliyuncs.com/api/v1")
    dashscope.base_http_api_url = base_url

    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("DASHSCOPE_API_KEY is not set", flush=True)
        return 2

    system_text = args.context or ""

    messages = [
        {"role": "system", "content": [{"text": system_text}]},
        {"role": "user", "content": [{"audio": args.audio_url}]},
    ]

    asr_options = {}
    if args.language:
        asr_options["language"] = args.language
    if args.enable_itn.lower() in ("true", "false"):
        asr_options["enable_itn"] = args.enable_itn.lower() == "true"

    # Stream ASR deltas
    responses = dashscope.MultiModalConversation.call(
        api_key=api_key,
        model="qwen3-asr-flash",
        messages=messages,
        result_format="message",
        asr_options=asr_options if asr_options else {"enable_itn": False},
        stream=True,
    )

    for r in responses:
        try:
            text = r["output"]["choices"][0]["message"].content[0]["text"]
            if text:
                # One delta per line for Node SSE bridge
                sys.stdout.write(text.strip() + "\n")
                sys.stdout.flush()
        except Exception:
            # ignore partial frames without text
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


