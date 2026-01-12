#!/bin/bash
# Test if Sarah.jpg passes face detection for digital human generation

set -e

IMAGE_PATH="/Users/wann/Desktop/SmarTalk/Sarah.jpg"

if [ ! -f "$IMAGE_PATH" ]; then
    echo "Error: File not found: $IMAGE_PATH"
    exit 1
fi

echo "📁 Checking file: $IMAGE_PATH"
echo "📏 File size: $(du -h "$IMAGE_PATH" | cut -f1)"
echo ""

# Step 1: Upload file to get temporary URL
echo "⬆️  Uploading image to DashScope..."
UPLOAD_RESPONSE=$(curl -s -X POST 'https://dashscope.aliyuncs.com/api/v1/uploads' \
  --header "Authorization: Bearer ${DASHSCOPE_API_KEY}" \
  -F "file=@${IMAGE_PATH}")

echo "Upload response:"
echo "$UPLOAD_RESPONSE" | python3 -m json.tool

# Extract URL from response
IMAGE_URL=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('output', {}).get('url', ''))" 2>/dev/null || echo "")

if [ -z "$IMAGE_URL" ]; then
    echo "❌ Failed to get temporary URL"
    echo "Response: $UPLOAD_RESPONSE"
    exit 1
fi

echo ""
echo "✅ Temporary URL: $IMAGE_URL"
echo ""

# Step 2: Detect face
echo "🔍 Detecting face..."
DETECT_RESPONSE=$(curl -s 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/face-detect' \
  --header "Authorization: Bearer ${DASHSCOPE_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data-raw "{
    \"model\": \"wan2.2-s2v-detect\",
    \"input\": {
        \"image_url\": \"${IMAGE_URL}\"
    }
}")

echo "Detection result:"
echo "$DETECT_RESPONSE" | python3 -m json.tool

# Check if passed
CHECK_PASS=$(echo "$DETECT_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('output', {}).get('check_pass', False))" 2>/dev/null || echo "False")

echo ""
if [ "$CHECK_PASS" = "True" ]; then
    echo "✅ Image PASSED detection! Suitable for digital human generation."
    exit 0
else
    echo "❌ Image FAILED detection."
    exit 1
fi
