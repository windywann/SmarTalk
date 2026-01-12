#!/usr/bin/env python3
"""
WebSocket connectivity diagnostic script for DashScope TTS
"""
import os
import sys
import time
import dashscope
from dashscope.audio.qwen_tts_realtime import QwenTtsRealtime, QwenTtsRealtimeCallback, AudioFormat

class DiagnosticCallback(QwenTtsRealtimeCallback):
    def __init__(self):
        self.connected = False
        self.session_created = False
        
    def on_open(self) -> None:
        self.connected = True
        print("✓ WebSocket connection opened successfully")
        
    def on_close(self, close_status_code, close_msg) -> None:
        print(f"✗ Connection closed: code={close_status_code}, msg={close_msg}")
        
    def on_event(self, response) -> None:
        event_type = response.get('type', 'unknown')
        if event_type == 'session.created':
            self.session_created = True
            print(f"✓ Session created: {response.get('session', {}).get('id', 'N/A')}")

def test_websocket_url(url: str, api_key: str) -> bool:
    """Test a specific WebSocket URL"""
    print(f"\nTesting: {url}")
    print("-" * 60)
    
    dashscope.api_key = api_key
    callback = DiagnosticCallback()
    
    try:
        print("Creating TTS client...")
        tts = QwenTtsRealtime(
            model="qwen3-tts-flash-realtime",
            callback=callback,
            url=url,
        )
        
        print("Attempting to connect (timeout: 10s)...")
        start_time = time.time()
        tts.connect()
        connect_time = time.time() - start_time
        print(f"✓ Connected in {connect_time:.2f} seconds")
        
        # Give it a moment to establish session
        time.sleep(0.5)
        
        if callback.session_created:
            print("✓ Session established successfully")
            tts.close()
            print("✓ This WebSocket URL works!")
            return True
        else:
            print("⚠ Connected but no session created")
            tts.close()
            return False
            
    except Exception as e:
        error_msg = str(e)
        print(f"✗ Connection failed: {error_msg}")
        
        # Provide specific diagnostics
        if "timeout" in error_msg.lower() or "5s" in error_msg:
            print("  Diagnosis: Connection timeout - network may be slow or blocked")
        elif "refused" in error_msg.lower():
            print("  Diagnosis: Connection refused - server may be down or firewall blocking")
        elif "name resolution" in error_msg.lower() or "dns" in error_msg.lower():
            print("  Diagnosis: DNS resolution failed - check network connectivity")
        else:
            print(f"  Diagnosis: Unknown error - {type(e).__name__}")
            
        return False

def main():
    print("=" * 60)
    print("DashScope TTS WebSocket Connectivity Diagnostic")
    print("=" * 60)
    
    # Check API key
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("✗ DASHSCOPE_API_KEY not set in environment")
        return 1
        
    print(f"✓ API Key found: {api_key[:10]}... (length: {len(api_key)})")
    
    # Test endpoints
    endpoints = [
        ("China (Beijing)", "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"),
        ("International (Singapore)", "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime"),
    ]
    
    results = {}
    for name, url in endpoints:
        print(f"\n{'='*60}")
        print(f"Testing {name}")
        print(f"{'='*60}")
        results[name] = test_websocket_url(url, api_key)
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    for name, success in results.items():
        status = "✓ WORKS" if success else "✗ FAILED"
        print(f"{name:40} {status}")
    
    if any(results.values()):
        print("\n✓ At least one endpoint is working!")
        working_endpoints = [name for name, success in results.items() if success]
        print(f"  Working: {', '.join(working_endpoints)}")
        return 0
    else:
        print("\n✗ All endpoints failed!")
        print("\nPossible causes:")
        print("1. Network firewall is blocking WebSocket connections")
        print("2. Corporate/school network restrictions")
        print("3. VPN or proxy configuration needed")
        print("4. Server is temporarily down (unlikely for both regions)")
        print("\nSuggestions:")
        print("- Try from a different network (e.g., mobile hotspot)")
        print("- Check if you need to configure a proxy")
        print("- Contact your network administrator")
        return 1

if __name__ == "__main__":
    sys.exit(main())
