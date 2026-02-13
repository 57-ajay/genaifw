# Restructured TS Agent - Architecture

## Directory Structure

```
src/
├── types.ts              # All types: Request/Response schemas, Session, UI actions, intents
├── config.ts             # Environment vars: GCP, Typesense, Maps, Analytics
├── embeddings.ts         # Vector embeddings for KB search
├── agent.ts              # AI agent loop with tool calling + driver profile context
├── tools.ts              # Tool declarations + implementations
├── store.ts              # Redis + KB + Features + Session (with Firestore fallback)
│
├── services/             # Feature services (ported from Python)
│   ├── index.ts
│   ├── geocoding.ts      # Google Maps geocoding + India validation
│   ├── typesense.ts      # Dual-stage trips + leads search (text + geo)
│   ├── fraud.ts          # Driver fraud check API
│   ├── analytics.ts      # BigQuery intent logging (fire-and-forget)
│   └── audio-config.ts   # JSON-based audio URL config with interaction logic
│
├── handlers/             # Unified request handling
│   ├── index.ts
│   └── chat.ts           # Core handler: entry, chips, agent, post-processing
│
├── audio/                # TTS + audio streaming
│   ├── index.ts
│   ├── config.ts
│   ├── cache.ts
│   ├── mapping.ts
│   ├── tts.ts
│   └── firebase.ts
│
├── firebase/             # Firestore session sync + search analytics
│   ├── index.ts
│   ├── client.ts
│   └── sessions.ts
│
├── server.ts             # HTTP API (admin + chat + chat-with-audio)
├── ws.ts                 # WebSocket server
├── http.ts               # Simple HTTP test server
├── serve.ts              # Entry point (HTTP + WS)
├── cli.ts                # CLI for testing
└── index.ts              # Barrel export

config/
└── audio_urls.json       # Audio URL mappings (hot-reloadable)
```

## Features Ported from Python

| Feature | Status | File |
|---------|--------|------|
| Chip click handling (find, tools) | ✅ | `handlers/chat.ts` |
| Entry state (empty text) | ✅ | `handlers/chat.ts` |
| Geocoding + India validation | ✅ | `services/geocoding.ts` |
| Typesense dual-stage search (text + geo) | ✅ | `services/typesense.ts` |
| Fraud check API | ✅ | `services/fraud.ts` |
| BigQuery analytics logging | ✅ | `services/analytics.ts` |
| JSON audio URL config with interaction count | ✅ | `services/audio-config.ts` |
| No-duty handling → END intent | ✅ | `handlers/chat.ts` |
| One city missing → special audio | ✅ | `handlers/chat.ts` |
| Driver profile context in system prompt | ✅ | `agent.ts` |
| New intents: border_tax, state_tax, puc, aitp | ✅ | `types.ts`, `store.ts` |
| fraud_check_found intent | ✅ | `handlers/chat.ts` |
| Firestore search analytics logging | ✅ | `firebase/sessions.ts` |
| Full request schema (driverProfile, location, etc.) | ✅ | `types.ts` |
| Full response schema (query, counts, audio_url) | ✅ | `types.ts` |

## Request Schema

```typescript
interface AssistantRequest {
  sessionId: string;
  message: string;          // Primary text input
  text?: string;            // Alias for message
  driverProfile?: DriverProfile;
  currentLocation?: Location;
  userData?: UserData;
  audio?: boolean;
  interactionCount?: number;
  isHome?: boolean;
  requestCount?: number;
  chipClick?: string;       // "find" | "tools"
  phoneNo?: string;         // For fraud check
}
```

## Response Schema

```typescript
interface AssistantResponse {
  session_id: string;
  success: boolean;
  intent: IntentType;
  ui_action: UIActionType;
  response_text: string;
  query?: { pickup_city, drop_city, used_geo };   // GET_DUTIES only
  counts?: { trips, leads };                       // GET_DUTIES only
  data: Record<string, unknown> | null;
  audio_url?: string | null;  // Pre-recorded audio URL
  audio_cached?: boolean;
  cache_key?: string;
}
```

## Flow

```
Request → handleChat()
  ├─ chipClick? → return audio URL directly
  ├─ empty text? → return ENTRY with greeting audio
  └─ has text? → resolve/create session
       → agent.resolve() (KB search → feature prompt → tool calls → respondToUser)
       → post-processing:
            ├─ GET_DUTIES → validate India → searchTrips+Leads → no results? END
            ├─ FRAUD + phoneNo → checkDriverRating → fraud_check_found
            └─ all intents → resolve audio URL, log analytics
       → return AssistantResponse
```

## Endpoints

### HTTP (port 3000)
- `POST /chat` → JSON response
- `POST /chat-with-audio` → JSON + base64 audio
- `GET|POST|DELETE /kb` → Knowledge base CRUD
- `GET|POST|DELETE /features` → Feature CRUD
- `DELETE /session/:id`
- `GET /health`

### WebSocket (port 3001)
Send JSON: `{ sessionId, message, driverProfile?, audio?, chipClick?, phoneNo? }`
Receive: `{ type: "chunk"|"response"|"audio_start"|"audio_end"|"error", ... }`
