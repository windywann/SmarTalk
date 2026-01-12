import base64
import json
import os
import sys
import threading
import websocket


class BridgeCallback:
    def __init__(self, send_session_update_fn):
        self._closed = threading.Event()
        self._ready = threading.Event()  # Set when session.updated is received
        self._buf = ""
        self._send_session_update = send_session_update_fn
        self._session_configured = False

    def on_open(self, ws):
        sys.stdout.write(json.dumps({"event": "open"}) + "\n")
        sys.stdout.flush()
        sys.stderr.write("[DEBUG] WebSocket opened\n")
        sys.stderr.flush()

    def on_close(self, ws, close_status_code, close_msg):
        sys.stdout.write(json.dumps({"event": "close", "code": close_status_code, "msg": close_msg}) + "\n")
        sys.stdout.flush()
        sys.stderr.write(f"[DEBUG] WebSocket closed: {close_status_code} - {close_msg}\n")
        sys.stderr.flush()
        self._closed.set()

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            event_type = data.get("type", "unknown")
            
            # Debug log all events
            sys.stderr.write(f"[DEBUG] Received event: {event_type}, session_configured={self._session_configured}\n")
            sys.stderr.flush()
            
            # Forward all events
            sys.stdout.write(json.dumps({"event": "asr", "message": data}) + "\n")
            sys.stdout.flush()
            
            # Send session.update when we receive session.created
            if event_type == "session.created":
                if not self._session_configured:
                    sys.stderr.write("[DEBUG] First session.created received, sending session.update\n")
                    sys.stderr.flush()
                    self._session_configured = True
                    # Send session update directly (not in background thread to avoid race condition)
                    self._send_session_update()
                else:
                    sys.stderr.write("[DEBUG] Ignoring duplicate session.created event\n")
                    sys.stderr.flush()
            
            # Set ready when session.updated is received
            elif event_type == "session.updated":
                sys.stderr.write("[DEBUG] Session updated, ready to receive audio\n")
                sys.stderr.flush()
                self._ready.set()
            
            # Handle specific event types per official docs
            elif event_type == "conversation.item.input_audio_transcription.text":
                # Partial/stash text
                stash = data.get("stash", "")
                if stash:
                    self._buf = stash
                    sys.stdout.write(json.dumps({"event": "partial", "text": stash}) + "\n")
                    sys.stdout.flush()
            
            elif event_type == "conversation.item.input_audio_transcription.completed":
                # Final recognized text
                transcript = data.get("transcript", "")
                if transcript:
                    self._buf = transcript
                    sys.stdout.write(json.dumps({"event": "final", "text": transcript}) + "\n")
                    sys.stdout.write(json.dumps({"event": "turn_end", "text": transcript}) + "\n")
                    sys.stdout.flush()
                    self._buf = ""
            
            elif event_type == "input_audio_buffer.speech_started":
                sys.stdout.write(json.dumps({"event": "speech_start"}) + "\n")
                sys.stdout.flush()
            
            elif event_type == "input_audio_buffer.speech_stopped":
                sys.stdout.write(json.dumps({"event": "speech_stop"}) + "\n")
                sys.stdout.flush()
                
        except Exception as e:
            sys.stderr.write(f"[ERROR] on_message: {e}\n")
            sys.stderr.flush()

    def on_error(self, ws, error):
        sys.stderr.write(f"[ERROR] WebSocket error: {error}\n")
        sys.stderr.flush()
        sys.stdout.write(json.dumps({"event": "error", "message": str(error)}) + "\n")
        sys.stdout.flush()

    def wait_closed(self):
        self._closed.wait()


def _read_stdin_lines():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        yield line


def main() -> int:
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        sys.stderr.write("DASHSCOPE_API_KEY is not set\n")
        sys.stderr.flush()
        return 2

    # Default config
    language = "en"
    sample_rate = 16000
    corpus_text = ""
    # Disable VAD to allow manual commit (user controls when to end speaking)
    enable_vad = False
    vad_threshold = 0.0
    silence_ms = 400
    
    # WebSocket URL per official docs
    ws_url_override = os.getenv("DASHSCOPE_ASR_WS_URL", "")
    if ws_url_override:
        base_url = ws_url_override
    else:
        base_url = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
    
    model = "qwen3-asr-flash-realtime"
    url = f"{base_url}?model={model}"
    
    sys.stderr.write(f"[DEBUG] Connecting to: {url}\n")
    sys.stderr.flush()
    
    # Headers per official docs
    headers = [
        f"Authorization: Bearer {api_key}",
        "OpenAI-Beta: realtime=v1"
    ]
    
    ws = None  # Will be set after WebSocketApp is created
    
    def send_session_update():
        """Send session.update event per official docs"""
        event = {
            "type": "session.update",
            "session": {
                "modalities": ["text"],
                "input_audio_format": "pcm",
                "sample_rate": sample_rate,
                "input_audio_transcription": {
                    "language": language
                }
            }
        }
        
        # Add corpus if provided
        if corpus_text:
            event["session"]["input_audio_transcription"]["corpus"] = {
                "text": corpus_text
            }
        
        # Add turn detection if enabled
        if enable_vad:
            event["session"]["turn_detection"] = {
                "type": "server_vad",
                "threshold": vad_threshold,
                "silence_duration_ms": silence_ms
            }
        else:
            event["session"]["turn_detection"] = None
        
        sys.stderr.write(f"[DEBUG] Sending session.update: {json.dumps(event, indent=2)}\n")
        sys.stderr.flush()
        
        try:
            if ws and ws.sock and ws.sock.connected:
                ws.send(json.dumps(event))
                sys.stdout.write(json.dumps({"event": "session_updated"}) + "\n")
                sys.stdout.flush()
                sys.stderr.write("[DEBUG] session.update sent successfully\n")
                sys.stderr.flush()
            else:
                sys.stderr.write("[ERROR] WebSocket not connected, cannot send session.update\n")
                sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[ERROR] Failed to send session.update: {e}\n")
            sys.stderr.flush()
    
    cb = BridgeCallback(send_session_update_fn=send_session_update)
    
    # Create WebSocket connection per official docs
    ws = websocket.WebSocketApp(
        url,
        header=headers,
        on_open=cb.on_open,
        on_message=cb.on_message,
        on_error=cb.on_error,
        on_close=cb.on_close
    )
    
    # Start WebSocket in background thread
    ws_thread = threading.Thread(target=ws.run_forever)
    ws_thread.daemon = True
    ws_thread.start()
    
    # Output status
    sys.stdout.write(json.dumps({"event": "ws_url", "url": url}) + "\n")
    sys.stdout.flush()
    
    sys.stderr.write("[DEBUG] Entering main loop\n")
    sys.stderr.flush()
    
    # Process stdin messages
    for line in _read_stdin_lines():
        try:
            msg = json.loads(line)
        except Exception:
            continue
        
        t = msg.get("type")
        
        if t == "config":
            # Update config (for future sessions, not current one)
            # Note: session.update can only be sent once, so we just log this
            language = msg.get("language", language)
            corpus_text = msg.get("corpus_text", corpus_text) or ""
            sys.stderr.write(f"[DEBUG] Config received: language={language}, but session already configured\n")
            sys.stderr.flush()
            continue
        
        if t == "audio":
            b64 = msg.get("audio_b64", "")
            if not b64:
                continue
            
            # Wait for session to be ready before sending audio
            if not cb._ready.wait(timeout=5.0):
                sys.stderr.write("[ERROR] Session not ready, dropping audio\n")
                sys.stderr.flush()
                continue
            
            # Send audio per official docs
            event = {
                "type": "input_audio_buffer.append",
                "audio": b64
            }
            
            try:
                ws.send(json.dumps(event))
            except Exception as e:
                sys.stderr.write(f"[ERROR] Failed to send audio: {e}\n")
                sys.stderr.flush()
            continue
        
        if t == "commit":
            # Commit audio buffer (non-VAD mode)
            event = {
                "type": "input_audio_buffer.commit"
            }
            try:
                ws.send(json.dumps(event))
            except Exception:
                pass
            continue
        
        if t == "close":
            try:
                ws.close()
            except Exception:
                pass
            break
    
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
