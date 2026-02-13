import { connectRedis, seedDefaults } from "./store";
import { handleChat } from "./handlers/chat";
import { resolveAudio, streamAudioRaw, AUDIO_CONFIG } from "./audio";
import { loadAudioConfig } from "./services/audio-config";
import { registerBuiltins } from "./builtins";
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

async function handleQueryWithAudio(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

    let body: AssistantRequest;
    try { body = (await req.json()) as AssistantRequest; } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    if (!body.sessionId) return json({ ok: false, error: "Need 'sessionId'" }, 400);

    const { response } = await handleChat(body);
    const shouldStreamAudio = body.audio !== false
        && AUDIO_CONFIG.enabled
        && !response.audio_url
        && response.response_text;

    if (!shouldStreamAudio) {
        const jsonBytes = new TextEncoder().encode(JSON.stringify(response) + "\n");
        return new Response(jsonBytes, {
            headers: {
                "Content-Type": "application/octet-stream",
                "Transfer-Encoding": "chunked",
                "X-Content-Type": "application/json+audio/wav",
                "X-Intent": response.intent,
            },
        });
    }

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(response) + "\n"));
                const audioBuf = await resolveAudio(response.ui_action, response.response_text);
                for (const chunk of streamAudioRaw(audioBuf)) {
                    controller.enqueue(new Uint8Array(chunk));
                }
            } catch (e: unknown) {
                const errorMarker = `ERROR:${((e as Error).message ?? "unknown").slice(0, 100)}`;
                controller.enqueue(new TextEncoder().encode(errorMarker));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/octet-stream",
            "Transfer-Encoding": "chunked",
            "X-Content-Type": "application/json+audio/wav",
            "X-Intent": response.intent,
        },
    });
}

async function main() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    registerBuiltins();
    loadAudioConfig();
    await seedDefaults();

    Bun.serve({
        port: PORT,
        fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/chat") return handleChatReq(req);
            if (path === "/query-with-audio") return handleQueryWithAudio(req);
            if (path === "/health") return json({ ok: true, timestamp: Date.now() });
            return json({ ok: false, error: "Not found" }, 404);
        },
    });

    console.log(`✓ HTTP test server on http://localhost:${PORT}`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
