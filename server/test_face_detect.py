#!/usr/bin/env python3
"""
Test script to detect if Sarah.jpg is suitable for digital human generation
"""
import os
import sys
import json
import dashscope
from http import HTTPStatus

def detect_face(image_path):
    """Detect if image is suitable for wan2.2-s2v model"""
    
    # Get API key
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    if not api_key:
        print("Error: DASHSCOPE_API_KEY not set")
        return False
    
    dashscope.api_key = api_key
    
    # Check if file exists
    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return False
    
    print(f"Detecting face in: {image_path}")
    print(f"File size: {os.path.getsize(image_path)} bytes")
    
    # Upload file and get temporary URL
    # DashScope SDK supports direct file upload
    from dashscope import ImageSynthesis
    
    try:
        # Use the face detection API
        url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect"
        
        # Read image as base64
        import base64
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')
        
        # Try using local file path - some APIs support it
        import requests
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # First, try to upload the file to get a temporary URL
        print("Uploading image to get temporary URL...")
        
        # Use DashScope's file upload API
        files = {'file': open(image_path, 'rb')}
        upload_url = "https://dashscope.aliyuncs.com/api/v1/uploads"
        
        upload_headers = {
            "Authorization": f"Bearer {api_key}"
        }
        
        upload_resp = requests.post(upload_url, headers=upload_headers, files=files)
        
        if upload_resp.status_code == 200:
            upload_data = upload_resp.json()
            print(f"Upload response: {json.dumps(upload_data, indent=2)}")
            
            # Extract URL from response
            if 'output' in upload_data and 'url' in upload_data['output']:
                image_url = upload_data['output']['url']
                print(f"Temporary URL: {image_url}")
                
                # Now call detection API
                detect_data = {
                    "model": "wan2.2-s2v-detect",
                    "input": {
                        "image_url": image_url
                    }
                }
                
                detect_resp = requests.post(url, headers=headers, json=detect_data)
                
                if detect_resp.status_code == 200:
                    result = detect_resp.json()
                    print("\n" + "="*50)
                    print("Detection Result:")
                    print("="*50)
                    print(json.dumps(result, indent=2, ensure_ascii=False))
                    
                    if result.get('output', {}).get('check_pass'):
                        print("\n✅ Image PASSED detection! Suitable for digital human generation.")
                        return True
                    else:
                        print("\n❌ Image FAILED detection.")
                        print(f"Reason: {result.get('output', {}).get('message', 'Unknown')}")
                        return False
                else:
                    print(f"Detection API error: {detect_resp.status_code}")
                    print(detect_resp.text)
                    return False
            else:
                print(f"Failed to get URL from upload response")
                return False
        else:
            print(f"Upload failed: {upload_resp.status_code}")
            print(upload_resp.text)
            return False
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    image_path = "/Users/wann/Desktop/SmarTalk/Sarah.jpg"
    success = detect_face(image_path)
    sys.exit(0 if success else 1)
