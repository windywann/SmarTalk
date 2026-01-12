#!/usr/bin/env python3
"""
WebSocket connectivity diagnostic script for DashScope ASR (Speech Recognition)
"""
import os
import sys
import time
import json
import threading
import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback

class DiagnosticCallback(RecognitionCallback):
    def __init__(self):
        self.connected = False
        self.session_created = False
        self.received_partial = False
        self.received_final = False
        self.done_event = threading.Event()
        
    def on_open(self) -> None:
        self.connected = True
        print("✓ WebSocket connection opened successfully")
        
    def on_close(self) -> None:
        print("✓ Connection closed normally")
        self.done_event.set()
        
    def on_event(self, result) -> None:
        event_type = result.get('event', 'unknown')
        
        if event_type == 'start':
            self.session_created = True
            print(f"✓ Session started: task_id={result.get('task_id', 'N/A')}")
            
        elif event_type == 'result_changed':
            self.received_partial = True
            text = result.get('result', '')
            print(f"  Partial: {text[:50]}...")
            
        elif event_type == 'sentence_end':
            self.received_final = True
            text = result.get('result', '')
            print(f"✓ Final: {text}")
            
        elif event_type == 'completed':
            print("✓ Recognition completed")
            self.done_event.set()
            
    def on_error(self, result) -> None:
        error_msg = result.get('message', str(result))
        print(f"✗ Error: {error_msg}")
        self.done_event.set()

def test_asr_websocket(url: str, api_key: str) -> bool:
    """Test ASR WebSocket connectivity"""
    print(f"\nTesting: {url}")
    print("-" * 60)
    
    dashscope.api_key = api_key
    callback = DiagnosticCallback()
    
    try:
        print("Creating ASR recognition client...")
        recognition = Recognition(
            model='paraformer-realtime-v2',
            format='pcm',
            sample_rate=16000,
            callback=callback,
        )
        
        # Set custom WebSocket URL if provided
        if url:
            # Note: The SDK may not directly support custom URLs for ASR
            # This is just for testing purposes
            print(f"  Custom URL: {url}")
        
        print("Attempting to connect...")
        start_time = time.time()
        recognition.start()
        connect_time = time.time() - start_time
        print(f"✓ Connected in {connect_time:.2f} seconds")
        
        # Send some dummy audio data to test
        print("Sending test audio data...")
        # Generate 0.5 seconds of silence (16000 Hz * 0.5s * 2 bytes)
        silence = b'\x00' * (16000 * 1)
        recognition.send_audio_frame(silence)
        
        # Wait for response or timeout
        print("Waiting for response (timeout: 5s)...")
        if callback.done_event.wait(timeout=5):
            if callback.session_created:
                print("✓ ASR WebSocket works!")
                recognition.stop()
                return True
            else:
                print("⚠ Connected but no session created")
                recognition.stop()
                return False
        else:
            print("⚠ Timeout waiting for response")
            recognition.stop()
            return False
            
    except Exception as e:
        error_msg = str(e)
        print(f"✗ Connection failed: {error_msg}")
        
        # Provide specific diagnostics
        if "SSL" in error_msg or "certificate" in error_msg.lower():
            print("  Diagnosis: SSL certificate error - same as TTS issue")
        elif "timeout" in error_msg.lower():
            print("  Diagnosis: Connection timeout - network may be slow or blocked")
        elif "refused" in error_msg.lower():
            print("  Diagnosis: Connection refused - server may be down or firewall blocking")
        elif "401" in error_msg or "unauthorized" in error_msg.lower():
            print("  Diagnosis: API key invalid or expired")
        else:
            print(f"  Diagnosis: Unknown error - {type(e).__name__}")
            
        return False

def main():
    print("=" * 60)
    print("DashScope ASR WebSocket Connectivity Diagnostic")
    print("=" * 60)
    
    # Check API key
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("✗ DASHSCOPE_API_KEY not set in environment")
        return 1
        
    print(f"✓ API Key found: {api_key[:10]}... (length: {len(api_key)})")
    
    # Test ASR endpoints
    # Note: ASR typically uses the same base endpoints as TTS
    endpoints = [
        ("China (Beijing)", "wss://dashscope.aliyuncs.com/api-ws/v1/inference"),
        ("International (Singapore)", "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference"),
    ]
    
    print("\nNote: ASR WebSocket endpoints may differ from TTS.")
    print("Testing with default SDK configuration...\n")
    
    # For now, just test with default configuration
    success = test_asr_websocket("", api_key)
    
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    if success:
        print("✓ ASR WebSocket is working!")
        return 0
    else:
        print("✗ ASR WebSocket test failed!")
        print("\nPossible causes:")
        print("1. Same SSL certificate issue as TTS (should be fixed)")
        print("2. Different WebSocket endpoint or protocol")
        print("3. Model or parameter configuration issue")
        print("4. Network firewall blocking ASR endpoint")
        print("\nNext steps:")
        print("- Check browser console for detailed error messages")
        print("- Try testing from frontend to see WebSocket handshake")
        print("- Review server logs for ASR WebSocket connection attempts")
        return 1

if __name__ == "__main__":
    sys.exit(main())
