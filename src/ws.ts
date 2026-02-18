import { WebSocketServer, type WebSocket } from "ws";
import { handleEvent } from "./handler";
import { resolveAudio, streamAudio, AUDIO_CONFIG } from "./audio";
import { flushSession } from "./firebase";
import { getAudioUrlDirect } from "./services";
import type { ClientEvent, ServerMessage, WSServerMessage } from "./types";

const clientSessions = new WeakMap<WebSocket, string>();

function send(ws: WebSocket, msg: WSServerMessage): void {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function sendError(ws: WebSocket, error: string): void {
    send(ws, { type: "error", error });
}

/**
 * After sending the actions message, resolve and stream any audio.
 * Audio is derived from the actions:
 *   - "speak" actions -> TTS synthesis
 *   - "playAudio" actions -> resolve by key (URL or cached buffer)
 *
 * The client receives the actions first (for immediate UI updates),
 * then audio streams in separately.
 */
async function streamActionsAudio(
    ws: WebSocket,
    message: ServerMessage,
): Promise<void> {
    if (!AUDIO_CONFIG.enabled) return;

    for (const action of message.actions) {
        if (ws.readyState !== ws.OPEN) return;

        if (action.type === "speak" && action.text) {
            try {
                const audioBuf = await resolveAudio("none", action.text);
                streamAudio(ws, audioBuf);
                return;
            } catch (e: unknown) {
                sendError(ws, `TTS failed: ${(e as Error).message}`);
            }
        }

        if (action.type === "playAudio" && action.key) {
            // Check if audio URL exists — if so, client handles playback via URL
            const url = getAudioUrlDirect(action.key);
            if (url) {
                // Client can play from URL, no need to stream
                // Attach URL to the action for client convenience
                // (Already sent in actions message, client resolves by key)
                return;
            }

            // No URL — try to resolve and stream the buffer
            try {
                const audioBuf = await resolveAudio(action.key, action.key);
                streamAudio(ws, audioBuf);
                return;
            } catch (e: unknown) {
                console.error(
                    `[WS] Audio resolve failed for key "${action.key}":`,
                    (e as Error).message,
                );
            }
        }
    }
}

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let event: ClientEvent;
    try {
        event = JSON.parse(raw);
    } catch {
        sendError(ws, "Invalid JSON");
        return;
    }

    if (!event.sessionId) {
        sendError(ws, "Missing 'sessionId'");
        return;
    }

    if (!event.type) {
        sendError(
            ws,
            "Missing 'type' (message | screenChange | submit | init)",
        );
        return;
    }

    if (event.type === "message" && !event.text?.trim()) {
        sendError(ws, "Message event requires 'text'");
        return;
    }

    clientSessions.set(ws, event.sessionId);

    try {
        const message = await handleEvent(event);

        send(ws, { type: "actions", message });

        await streamActionsAudio(ws, message);
    } catch (e: unknown) {
        console.error("[WS] handleMessage error:", e);
        sendError(ws, (e as Error).message ?? "Internal error");
    }
}

export function startWS(port: number): void {
    const wss = new WebSocketServer({ host: "0.0.0.0", port });

    wss.on("connection", (ws) => {
        console.log(`[WS] Client connected (total: ${wss.clients.size})`);

        ws.on("message", (data) => handleMessage(ws, data.toString()));

        ws.on("close", () => {
            console.log(
                `[WS] Client disconnected (total: ${wss.clients.size})`,
            );
            const sessionId = clientSessions.get(ws);
            if (sessionId) {
                flushSession(sessionId).catch((e) =>
                    console.error(
                        "[Firestore] flush failed:",
                        (e as Error).message,
                    ),
                );
            }
        });

        ws.on("error", (e) => {
            console.error("[WS] Socket error:", e.message);
        });
    });

    console.log(`WebSocket server on ws://0.0.0.0:${port}`);
}
