import { WebSocketServer, type WebSocket } from "ws";
import { handleChat } from "./handlers/chat";
import { resolveAudio, streamAudio, AUDIO_CONFIG } from "./audio";
import { flushSession } from "./firebase";
import type { AssistantRequest } from "./types";

const clientSessions = new WeakMap<WebSocket, string>();

function send(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let parsed: AssistantRequest;
    try { parsed = JSON.parse(raw); } catch {
        send(ws, { type: "error", error: "Invalid JSON" });
        return;
    }

    if (!parsed.sessionId) {
        send(ws, { type: "error", error: "Need 'sessionId'" });
        return;
    }

    if (!parsed.message && !parsed.text && !parsed.chipClick) {
        send(ws, { type: "error", error: "Need 'message', 'text', or 'chipClick'" });
        return;
    }

    clientSessions.set(ws, parsed.sessionId);

    try {
        const { response } = await handleChat(parsed, (chunk) => {
            send(ws, { type: "chunk", text: chunk });
        });

        send(ws, { type: "response", ...response });

        const shouldSendAudio = parsed.audio !== false && AUDIO_CONFIG.enabled;
        if (shouldSendAudio && !response.audio_url) {
            try {
                const audioBuf = await resolveAudio(response.ui_action, response.response_text);
                streamAudio(ws, audioBuf);
            } catch (e: unknown) {
                send(ws, { type: "audio_error", error: (e as Error).message });
            }
        }
    } catch (e: unknown) {
        send(ws, { type: "error", error: (e as Error).message ?? "Internal error" });
    }
}

export function startWS(port: number): void {
    const wss = new WebSocketServer({ host: "0.0.0.0", port });

    wss.on("connection", (ws) => {
        console.log(`WS client connected (total: ${wss.clients.size})`);

        ws.on("message", (data) => handleMessage(ws, data.toString()));

        ws.on("close", () => {
            console.log(`WS client disconnected (total: ${wss.clients.size})`);
            const sessionId = clientSessions.get(ws);
            if (sessionId) flushSession(sessionId).catch((e) => console.error("[Firestore] flush failed:", (e as Error).message));
        });
    });

    console.log(`✓ WebSocket server on ws://localhost:${port}`);
}
