import { connectRedis, seedDefaults } from "./store";
import { handleChat } from "./handlers/chat";
import { resolveAudio, AUDIO_CONFIG } from "./audio";
import { loadAudioConfig } from "./services/audio-config";
import type { AssistantRequest } from "./types";

const PORT = parseInt(process.env.HTTP_TEST_PORT ?? "3001", 10);

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function handleChatReq(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

    let body: AssistantRequest;
    try { body = (await req.json()) as AssistantRequest; } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    if (!body.sessionId) return json({ ok: false, error: "Need 'sessionId'" }, 400);

    try {
        const { response } = await handleChat(body);
        const result: Record<string, unknown> = { ...response };

        if (body.audio && AUDIO_CONFIG.enabled && !response.audio_url) {
            try {
                const buf = await resolveAudio(response.ui_action, response.response_text);
                result["audio"] = buf.toString("base64");
                result["audioContentType"] = "audio/wav";
            } catch (e: unknown) {
                result["audioError"] = (e as Error).message;
            }
        }
        return json(result);
    } catch (e: unknown) {
        return json({ ok: false, error: (e as Error).message ?? "Internal error" }, 500);
    }
}

async function main() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();
    loadAudioConfig();

    Bun.serve({
        port: PORT,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/chat") return handleChatReq(req);
            if (path === "/health") return json({ ok: true, timestamp: Date.now() });
            return json({ ok: false, error: "Not found" }, 404);
        },
    });

    console.log(`✓ HTTP test server on http://localhost:${PORT}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
