import argparse
import json
import os
import sys
import threading

import dashscope


def _extract_text(evt: dict) -> str:
    # Try common locations for incremental transcript text
    for k in ("text", "transcript"):
        v = evt.get(k)
        if isinstance(v, str) and v.strip():
            return v
    out = evt.get("output")
    if isinstance(out, dict):
        v = out.get("text") or out.get("transcript")
        if isinstance(v, str) and v.strip():
            return v
    # Some frames may have delta-like payloads
    delta = evt.get("delta")
    if isinstance(delta, str) and delta.strip():
        return delta
    return ""


class Callback:  # OmniRealtimeCallback compatible (duck-typing)
    def __init__(self):
        self.closed = threading.Event()

    def on_open(self) -> None:
        sys.stdout.write(json.dumps({"event": "open"}) + "\n")
        sys.stdout.flush()

    def on_close(self, close_status_code, close_msg) -> None:
        sys.stdout.write(json.dumps({"event": "close", "code": close_status_code, "msg": close_msg}) + "\n")
        sys.stdout.flush()
        self.closed.set()

    def on_event(self, message: dict) -> None:
        try:
            t = message.get("type", "")
            text = _extract_text(message)

            if text:
                # Heuristic: delta => partial; done/final => final
                kind = "partial"
                lt = t.lower()
                if "done" in lt or "final" in lt:
                    kind = "final"
                if "delta" in lt:
                    kind = "partial"
                sys.stdout.write(json.dumps({"event": kind, "text": text, "type": t}) + "\n")
                sys.stdout.flush()

            # Also forward turn boundary if provided
            if t and ("turn" in t.lower() and ("end" in t.lower() or "done" in t.lower())):
                sys.stdout.write(json.dumps({"event": "turn_end", "type": t}) + "\n")
                sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"event": "error", "message": str(e)}) + "\n")
            sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="DashScope Qwen ASR Realtime bridge (stdin JSONL -> stdout JSONL)")
    parser.add_argument("--ws-url", default="")
    parser.add_argument("--language", default="en")
    parser.add_argument("--threshold", default="0.0")
    parser.add_argument("--silence-ms", default="400")
    parser.add_argument("--enable-turn-detection", default="true")
    parser.add_argument("--context", default="")
    args = parser.parse_args()

    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        sys.stderr.write("DASHSCOPE_API_KEY is not set\n")
        sys.stderr.flush()
        return 2
    dashscope.api_key = api_key

    ws_url = (
        args.ws_url
        or os.getenv("DASHSCOPE_ASR_WS_URL", "")
        or "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    )

    try:
        # Delayed import because module path may change across versions
        from dashscope.audio.qwen_omni import (  # type: ignore
            OmniRealtimeConversation,
            MultiModality,
            TranscriptionParams,
            AudioFormat,
        )
    except Exception:
        # Fallback: some SDKs expose these under dashscope.audio.qwen_omni_realtime
        from dashscope.audio.qwen_omni import (  # type: ignore
            OmniRealtimeConversation,
            MultiModality,
            TranscriptionParams,
            AudioFormat,
        )

    cb = Callback()
    conv = OmniRealtimeConversation(
        model="qwen-asr-realtime",
        callback=cb,
        url=ws_url,
    )
    conv.connect()

    enable_turn_detection = args.enable_turn_detection.lower() != "false"
    try:
        threshold = float(args.threshold)
    except Exception:
        threshold = 0.0
    try:
        silence_ms = int(args.silence_ms)
    except Exception:
        silence_ms = 400

    tp = TranscriptionParams(
        language=args.language,
        sample_rate=16000,
        input_audio_format="pcm",
        corpus_text=args.context or None,
    )

    conv.update_session(
        output_modalities=[MultiModality.TEXT],
        input_audio_format=AudioFormat.PCM_16000HZ_MONO_16BIT,
        enable_turn_detection=enable_turn_detection,
        turn_detection_type="server_vad",
        turn_detection_threshold=threshold,
        turn_detection_silence_duration_ms=silence_ms,
        transcription_params=tp,
    )

    # Read JSON lines from stdin: {"type":"audio","b64":"..."} or {"type":"stop"}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        mtype = msg.get("type")
        if mtype == "audio":
            b64 = msg.get("b64")
            if isinstance(b64, str) and b64:
                conv.append_audio(b64)
        elif mtype == "stop":
            break
        elif mtype == "commit":
            try:
                conv.commit()
            except Exception:
                pass

    try:
        conv.close()
    except Exception:
        pass

    # wait for close
    cb.closed.wait(timeout=2.0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


