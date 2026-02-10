import { connectRedis, seedDefaults, getSession, newSession, saveSession } from "./store";
import { resolve, BASE_TOOLS } from "./agent";
import { resolveAudio, AUDIO_CONFIG } from "./audio";
import type { UserData } from "./types";
import { toClientResponse } from "./response";

const PORT = parseInt(process.env.HTTP_TEST_PORT ?? "3001", 10);

interface IncomingBody {
    sessionId: string;
    message: string;
    userData?: UserData | null;
    audio?: boolean;
}

async function handleChat(req: Request): Promise<Response> {
    if (req.method !== "POST") {
        return json({ ok: false, error: "POST only" }, 405);
    }

    let body: IncomingBody;
    try {
        body = await req.json() as IncomingBody;
    } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
    }


    const { sessionId, message, userData, audio: wantsAudio } = body;
    if (!sessionId || !message) {
        return json({ ok: false, error: "Need 'sessionId' and 'message'" }, 400);
    }

    let session = await getSession(sessionId);
    if (!session) {
        session = newSession(sessionId, BASE_TOOLS, userData);
    } else if (userData) {
        session.userData = { ...session.userData, ...userData };
        await saveSession(session);
    }

    session.history.push({ role: "user", parts: [{ text: message }] });

    try {
        const result = await resolve(session);
        const clientResp = toClientResponse(sessionId, result);

        const response: Record<string, any> = {
            ...clientResp
        };

        if (wantsAudio && AUDIO_CONFIG.enabled) {
            try {
                const audioBuf = await resolveAudio(result.action.type, result.response);
                response.audio = audioBuf.toString("base64");
                response.audioContentType = "audio/wav";
            } catch (e: any) {
                response.audioError = e.message;
            }
        }

        return json(response);
    } catch (e: any) {
        return json({ ok: false, error: e.message ?? "Internal error" }, 500);
    }
}

function json(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

async function main() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();

    Bun.serve({
        port: PORT,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/chat") return handleChat(req);
            if (path === "/health") return json({ ok: true, timestamp: Date.now() });
            return json({ ok: false, error: "Not found" }, 404);
        },
    });

    console.log(`✓ HTTP test server on http://localhost:${PORT}`);
    console.log(`  POST /chat → { sessionId, message, userData?, audio? }`);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
