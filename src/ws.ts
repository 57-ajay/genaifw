import { WebSocketServer, type WebSocket } from "ws";
import { getSession, newSession } from "./store";
import { resolve, BASE_TOOLS } from "./agent";

interface IncomingMessage {
    sessionId: string;
    message: string;
}

function send(ws: WebSocket, data: Record<string, any>): void {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let parsed: IncomingMessage;
    try {
        parsed = JSON.parse(raw);
    } catch {
        send(ws, { type: "error", error: "Invalid JSON" });
        return;
    }

    const { sessionId, message } = parsed;
    if (!sessionId || !message) {
        send(ws, { type: "error", error: "Need 'sessionId' and 'message'" });
        return;
    }

    let session = await getSession(sessionId);
    if (!session) {
        session = newSession(sessionId, BASE_TOOLS);
    }

    session.history.push({ role: "user", parts: [{ text: message }] });

    try {
        const result = await resolve(session, (chunk) => {
            send(ws, { type: "chunk", text: chunk });
        });

        send(ws, {
            type: "response",
            sessionId,
            response: result.response,
            action: result.action,
        });
    } catch (e: any) {
        send(ws, { type: "error", error: e.message ?? "Internal error" });
    }
}

export function startWS(port: number): void {
    const wss = new WebSocketServer({ host: "0.0.0.0", port });

    wss.on("connection", (ws) => {
        console.log(`WS client connected (total: ${wss.clients.size})`);

        ws.on("message", (data) => {
            handleMessage(ws, data.toString());
        });

        ws.on("close", () => {
            console.log(`WS client disconnected (total: ${wss.clients.size})`);
        });
    });

    console.log(`WebSocket server on ws://localhost:${port}`);
}
