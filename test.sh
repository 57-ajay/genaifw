#!/usr/bin/env bash
# Test: Add a new feature with an HTTP tool via dashboard, then test chat

BASE="http://localhost:3000"

echo "=== 1. Add KB entry for the new feature ==="
curl -s -X POST "$BASE/kb" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "feature",
    "desc": "Weather forecast mausam jaankari temperature barish dhoop",
    "featureName": "check_weather",
    "tools": ["getWeatherTool"]
  }' | jq .

echo ""
echo "=== 2. Add feature config with HTTP tool ==="
curl -s -X POST "$BASE/features" \
  -H "Content-Type: application/json" \
  -d '{
    "featureName": "check_weather",
    "desc": "Check weather for a city",
    "prompt": "User wants weather info. Extract the city name. Call getWeatherTool with the city. Report the result in Hinglish.",
    "actions": [
      { "uiAction": "show_weather", "intent": "weather" }
    ],
    "defaultAction": "show_weather",
    "tools": [
      {
        "name": "getWeatherTool",
        "declaration": {
          "description": "Get current weather for a city",
          "parameters": {
            "type": "OBJECT",
            "properties": {
              "city": { "type": "STRING", "description": "City name" }
            },
            "required": ["city"]
          }
        },
        "implementation": {
          "type": "http",
          "url": "https://asia-south1-bwi-cabswalle.cloudfunctions.net/reports-weather?city={{city}}",
          "method": "GET",
          "headers": {},
          "responseMapping": "current_condition.0",
          "timeout": 5000
        }
      }
    ],
    "audioMappings": {
      "weather": null
    },
    "dataSchema": {
      "type": "OBJECT",
      "properties": {
        "city": { "type": "STRING", "description": "City name" },
        "temperature": { "type": "STRING", "description": "Temperature", "nullable": true }
      }
    }
  }' | jq .

echo ""
echo "=== 3. Verify feature was saved ==="
curl -s "$BASE/features/check_weather" | jq .

echo ""
echo "=== 4. Check registry (via health or features list) ==="
curl -s "$BASE/features" | jq '[ .data[] | .featureName ]'

echo ""
echo "=== 5. Test chat with the new feature ==="
curl -s -X POST "$BASE/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test-weather-001",
    "message": "Delhi ka mausam kaisa hai?"
  }' | jq .

echo ""
echo "=== Done ==="
