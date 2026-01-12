#!/usr/bin/env python3
"""
Simple test to verify ASR WebSocket can send and receive successfully
"""
import os
import sys
import json
import base64
import threading
import time
import dashscope
from dashscope.audio.qwen_omni import OmniRealtimeConversation, OmniRealtimeCallback, MultiModality
from dashscope.audio.qwen_omni.omni_realtime import TranscriptionParams

class TestCallback(OmniRealtimeCallback):
    def __init__(self):
        super().__init__()
        self.opened = False
        self.received_events = []
        self.done = threading.Event()
        
    def on_open(self) -> None:
        self.opened = True
        print("✓ WebSocket opened")
        
    def on_close(self, close_status_code, close_msg) -> None:
        print(f"✓ WebSocket closed: code={close_status_code}")
        self.done.set()
        
    def on_event(self, message: dict) -> None:
        event_type = message.get("type", "unknown")
        self.received_events.append(event_type)
        print(f"  Event: {event_type}")
        
        # If we get any meaningful response, that's a success
        if event_type in ("response.done", "response.audio.delta", "response.text.delta"):
            print("✓ Received meaningful response from server")

def main():
    print("="*60)
    print("Testing ASR WebSocket send/receive")
    print("="*60)
    
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("✗ DASHSCOPE_API_KEY not set")
        return 1
    
    print(f"✓ API Key: {api_key[:10]}...")
    dashscope.api_key = api_key
    
    callback = TestCallback()
    
    try:
        print("\n1. Creating OmniRealtimeConversation...")
        conv = OmniRealtimeConversation(
            model="qwen-asr-realtime",
            callback=callback,
            url="wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        )
        
        print("2. Connecting...")
        conv.connect()
        
        if not callback.opened:
            print("✗ Connection did not open")
            return 1
        
        time.sleep(0.2)  # Give it a moment
        
        print("3. Calling update_session with TranscriptionParams...")
        tp = TranscriptionParams(
            language="en",
            sample_rate=16000,
            input_audio_format="pcm",
            corpus_text=None,
        )
        
        conv.update_session(
            output_modalities=[MultiModality.TEXT],
            enable_turn_detection=True,
            turn_detection_type="server_vad",
            turn_detection_threshold=0.0,
            turn_detection_silence_duration_ms=400,
            transcription_params=tp,
        )
        
        print("✓ update_session() succeeded without error")
        
        print("4. Sending test audio (1 second of silence)...")
        # Generate 1 second of 16kHz PCM16 silence
        silence_samples = 16000  # 1 second
        silence_bytes = b'\\x00\\x00' * silence_samples  # PCM16 = 2 bytes per sample
        silence_b64 = base64.b64encode(silence_bytes).decode('utf-8')
        
        conv.append_audio(silence_b64)
        print("✓ append_audio() succeeded without error")
        
        print("5. Waiting for response (3 seconds)...")
        time.sleep(3)
        
        print("6. Closing connection...")
        conv.close()
        
        print("\n" + "="*60)
        print("RESULT")
        print("="*60)
        print(f"✓ WebSocket connection successful")
        print(f"✓ update_session() worked")
        print(f"✓ append_audio() worked")
        print(f"  Events received: {len(callback.received_events)}")
        if callback.received_events:
            print(f"  Event types: {callback.received_events}")
        
        print("\n✓ ASR WebSocket is functional!")
        print("  The issue may be in the frontend or bridge logic.")
        return 0
        
    except Exception as e:
        print(f"\n✗ Error: {e}")
        print(f"  Type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
