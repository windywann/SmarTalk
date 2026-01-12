#!/usr/bin/env python3
"""
Simple face detection test using base64 encoding
"""
import os
import sys
import json
import base64
import requests

def detect_face(image_path):
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("Error: DASHSCOPE_API_KEY not set")
        return False
    
    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return False
    
    print(f"📁 Checking file: {image_path}")
    print(f"📏 File size: {os.path.getsize(image_path) / 1024 / 1024:.2f}MB")
    print()
    
    # Read and encode image
    with open(image_path, 'rb') as f:
        image_data = base64.b64encode(f.read()).decode('utf-8')
    
    # Try detection with data URI
    print("🔍 Attempting detection with data URI...")
    
    url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # Construct data URI
    data_uri = f"data:image/jpeg;base64,{image_data}"
    
    payload = {
        "model": "wan2.2-s2v-detect",
        "input": {
            "image_url": data_uri
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        
        print(f"Response status: {response.status_code}")
        print()
        
        if response.status_code == 200:
            result = response.json()
            print("Detection result:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            print()
            
            if result.get('output', {}).get('check_pass'):
                print("✅ Image PASSED detection! Suitable for digital human generation.")
                return True
            else:
                print("❌ Image FAILED detection.")
                msg = result.get('output', {}).get('message', 'Unknown reason')
                print(f"Reason: {msg}")
                return False
        else:
            print(f"❌ API Error: {response.status_code}")
            print(response.text)
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    image_path = "/Users/wann/Desktop/SmarTalk/Sarah.jpg"
    success = detect_face(image_path)
    sys.exit(0 if success else 1)
