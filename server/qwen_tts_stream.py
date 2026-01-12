import argparse
import base64
import json
import os
import sys
import threading

import dashscope
from dashscope.audio.qwen_tts_realtime import (
    QwenTtsRealtime,
    QwenTtsRealtimeCallback,
    AudioFormat,
)


class _Callback(QwenTtsRealtimeCallback):
    def __init__(self):
        super().__init__()
        self.done = threading.Event()

    def on_open(self) -> None:
        # Inform node the websocket is ready
        sys.stdout.write(json.dumps({"event": "open"}) + "\n")
        sys.stdout.flush()

    def on_close(self, close_status_code, close_msg) -> None:
        sys.stdout.write(json.dumps({"event": "close", "code": close_status_code, "msg": close_msg}) + "\n")
        sys.stdout.flush()

    def on_event(self, response) -> None:
        try:
            t = response.get("type")
            if t == "session.created":
                sys.stdout.write(json.dumps({"event": "session", "id": response["session"]["id"]}) + "\n")
                sys.stdout.flush()
                return

            if t == "response.audio.delta":
                # delta is already base64 from server
                b64 = response.get("delta", "")
                if b64:
                    # Validate base64 quickly (optional) and forward
                    try:
                        base64.b64decode(b64, validate=False)
                    except Exception:
                        pass
                    sys.stdout.write(json.dumps({"event": "audio", "b64": b64}) + "\n")
                    sys.stdout.flush()
                return

            if t == "response.done":
                sys.stdout.write(json.dumps({"event": "response_done"}) + "\n")
                sys.stdout.flush()
                return

            if t == "session.finished":
                sys.stdout.write(json.dumps({"event": "end"}) + "\n")
                sys.stdout.flush()
                self.done.set()
                return
        except Exception as e:
            sys.stdout.write(json.dumps({"event": "error", "message": str(e)}) + "\n")
            sys.stdout.flush()

    def wait(self, timeout=None) -> bool:
        return self.done.wait(timeout=timeout)


def _audio_format(name: str) -> AudioFormat:
    # V1 只暴露常用 PCM 24k，后续需要再扩展
    if name.lower() in ("pcm_24000", "pcm_24000hz_mono_16bit", "pcm"):
        return AudioFormat.PCM_24000HZ_MONO_16BIT
    return AudioFormat.PCM_24000HZ_MONO_16BIT


def main() -> int:
    parser = argparse.ArgumentParser(description="DashScope Qwen TTS realtime -> JSONL audio deltas")
    parser.add_argument("--text", required=True, help="Text to synthesize (can be long)")
    parser.add_argument("--voice", default="Cherry")
    parser.add_argument("--language-type", default="English")
    parser.add_argument("--mode", default="server_commit", choices=["server_commit", "commit"])
    parser.add_argument("--format", default="pcm_24000")
    parser.add_argument("--ws-url", default="")
    parser.add_argument("--speech-rate", default="")
    parser.add_argument("--pitch-rate", default="")
    parser.add_argument("--volume", default="")
    args = parser.parse_args()

    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        sys.stderr.write("DASHSCOPE_API_KEY is not set\n")
        sys.stderr.flush()
        return 2

    dashscope.api_key = api_key

    # Default WS by region; allow override via env or arg.
    # 为了减少“地域/网络导致连不上”的手动排查：若用户未指定 ws_url，则自动按顺序尝试 CN -> INTL。
    ws_url_override = args.ws_url or os.getenv("DASHSCOPE_TTS_WS_URL", "")
    ws_candidates = (
        [ws_url_override]
        if ws_url_override
        else [
            "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
            "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime",
        ]
    )

    cb = _Callback()
    tts = None
    last_err = None
    
    # Happy Eyeballs-ish strategy: try to connect to best candidate
    # But Python's `threading` is simple here.
    # To keep it simple and robust without complex async/await refactor:
    # 1. Try CN (default) once.
    # 2. If fail, try INTL once.
    # 3. If fail, fail.
    # Reducing retries from 3 to 1 per endpoint to speed up fallback.
    
    for ws_url in ws_candidates:
        try:
            # Shorten SDK connect timeout if possible? SDK doesn't expose it easily.
            # But we can assume if it fails quickly, we move to next.
            tts = QwenTtsRealtime(
                model="qwen3-tts-flash-realtime",
                callback=cb,
                url=ws_url,
            )
            tts.connect()
            last_err = None
            break
        except Exception as e:
            last_err = e
            tts = None
            sys.stderr.write(f"Connect failed to {ws_url}: {e}\n")
            continue

    if tts is None or last_err is not None:
        sys.stderr.write(f"TTS websocket connect failed after trying candidates. last_error={last_err}\n")
        sys.stderr.flush()
        return 5

    # Prepare additional parameters
    kwargs = {}
    if args.speech_rate:
        try:
            kwargs["speech_rate"] = float(args.speech_rate)
        except Exception:
            pass
    if args.pitch_rate:
        try:
            kwargs["pitch_rate"] = float(args.pitch_rate)
        except Exception:
            pass
    if args.volume:
        try:
            kwargs["volume"] = int(args.volume)
        except Exception:
            pass

    # CRITICAL: Per official docs, update_session must be called immediately after connect()
    # to configure the session before any other operations
    import time
    start_time = time.time()
    sys.stderr.write(f"[DEBUG-TTS] Starting session update with voice={args.voice}\n")
    sys.stderr.flush()
    
    tts.update_session(
        voice=args.voice,
        response_format=_audio_format(args.format),
        mode=args.mode,
        language_type=args.language_type,
        **kwargs,
    )
    
    elapsed = time.time() - start_time
    sys.stderr.write(f"[DEBUG-TTS] Session updated in {elapsed:.2f}s\n")
    sys.stderr.flush()
    
    # Now safe to output status after session is properly configured
    sys.stdout.write(json.dumps({"event": "ws_url", "url": ws_url}) + "\n")
    sys.stdout.flush()

    # Server-commit: we can just append full text; server decides chunking
    sys.stderr.write(f"[DEBUG-TTS] Appending text (len={len(args.text)})\n")
    sys.stderr.flush()
    start_append = time.time()
    
    tts.append_text(args.text)
    tts.finish()
    
    elapsed_append = time.time() - start_append
    sys.stderr.write(f"[DEBUG-TTS] Text appended and finished in {elapsed_append:.2f}s\n")
    sys.stderr.flush()

    # Add timeout to prevent hanging forever (e.g. if network drops FIN packet)
    # 15s should be enough for most examiner sentences.
    if not cb.wait(timeout=15):
        sys.stderr.write("TTS session timed out waiting for finish signal.\n")
        sys.stderr.flush()

    try:
        tts.close()
    except Exception:
        pass
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


