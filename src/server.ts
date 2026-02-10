import {
    connectRedis, seedDefaults,
    addKBEntries, getKBEntry, updateKBEntry, deleteKBEntry, getAllKBEntries, clearKB,
    addFeature, getFeatureDetail, updateFeature, deleteFeature, getAllFeatures, clearFeatures,
    getSession, deleteSession,
} from "./store";
import { hasDeclaration } from "./tools";
import { handleChat } from "./handlers/chat";
import { resolveAudio, streamAudioSSE, AUDIO_CONFIG } from "./audio";
import { loadAudioConfig } from "./services/audio-config";
import type { KBEntry, FeatureDetail, APIResponse, AssistantRequest, AssistantResponse } from "./types";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

function json<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function ok<T>(data: T): Response { return json<APIResponse<T>>({ ok: true, data }); }
function err(error: string, status = 400): Response { return json<APIResponse>({ ok: false, error }, status); }

async function readBody<T>(req: Request): Promise<T> { return (await req.json()) as T; }
function extractId(path: string, prefix: string): string { return path.slice(prefix.length); }

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
        // --- Chat endpoints ---
        if (path === "/chat" && method === "POST") {
            const body = await readBody<AssistantRequest>(req);
            if (!body.sessionId) return err("Need 'sessionId'");
            if (!body.message && !body.text && !body.chipClick) return err("Need 'message', 'text', or 'chipClick'");

            const { response } = await handleChat(body);
            return json<AssistantResponse>(response);
        }

        if (path === "/query-with-audio" && method === "POST") {
            const body = await readBody<AssistantRequest>(req);
            if (!body.sessionId) return err("Need 'sessionId'");

            const { response } = await handleChat(body);
            const shouldStream = body.audio !== false && AUDIO_CONFIG.enabled && !response.audio_url;

            if (!shouldStream) {
                return json(response);
            }

            // SSE: stream JSON response first, then audio chunks
            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    const encoder = new TextEncoder();
                    try {
                        controller.enqueue(encoder.encode(`event: response\ndata: ${JSON.stringify(response)}\n\n`));

                        const audioBuf = await resolveAudio(response.ui_action, response.response_text);
                        streamAudioSSE(controller, audioBuf);
                    } catch (e: unknown) {
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`));
                    }
                    controller.close();
                },
            });

            return new Response(stream, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            });
        }

        // --- KB admin ---
        if (path === "/kb" && method === "GET") return ok(await getAllKBEntries());
        if (path === "/kb" && method === "POST") {
            const body = await readBody<KBEntry | KBEntry[]>(req);
            const entries = Array.isArray(body) ? body : [body];
            for (const e of entries) {
                if (!e.type || !e.desc) return err("Each entry needs 'type' and 'desc'");
                if (e.type === "feature" && (!e.featureName || !e.tools?.length))
                    return err("Feature entries need 'featureName' and 'tools'");
            }
            const ids = await addKBEntries(entries);
            return ok({ added: ids.length, ids });
        }
        if (path === "/kb" && method === "DELETE") { await clearKB(); return ok({ cleared: true }); }

        if (path.startsWith("/kb/") && method === "GET") {
            const entry = await getKBEntry(extractId(path, "/kb/"));
            return entry ? ok(entry) : err("Not found", 404);
        }
        if (path.startsWith("/kb/") && method === "PUT") {
            const id = extractId(path, "/kb/");
            const body = await readBody<KBEntry>(req);
            if (!body.type || !body.desc) return err("Need 'type' and 'desc'");
            return (await updateKBEntry(id, body)) ? ok({ updated: id }) : err("Not found", 404);
        }
        if (path.startsWith("/kb/") && method === "DELETE") {
            const id = extractId(path, "/kb/");
            return (await deleteKBEntry(id)) ? ok({ deleted: id }) : err("Not found", 404);
        }

        // --- Features admin ---
        if (path === "/features" && method === "GET") return ok(await getAllFeatures());
        if (path === "/features" && method === "POST") {
            const body = await readBody<FeatureDetail>(req);
            if (!body.featureName || !body.prompt || !body.actionType || !body.dataSchema)
                return err("Need 'featureName', 'prompt', 'actionType', 'dataSchema'");
            if (body.tools?.length) {
                const missing = body.tools.filter((t) => !hasDeclaration(t));
                if (missing.length) return err(`Missing tool declarations: ${missing.join(", ")}`);
            }
            await addFeature(body);
            return ok({ added: body.featureName });
        }
        if (path === "/features" && method === "DELETE") { await clearFeatures(); return ok({ cleared: true }); }

        if (path.startsWith("/features/") && method === "GET") {
            const detail = await getFeatureDetail(extractId(path, "/features/"));
            return detail ? ok(detail) : err("Not found", 404);
        }
        if (path.startsWith("/features/") && method === "PUT") {
            const name = extractId(path, "/features/");
            const body = await readBody<Partial<FeatureDetail>>(req);
            const existing = await getFeatureDetail(name);
            if (!existing) return err("Not found", 404);
            const merged: FeatureDetail = {
                featureName: name,
                desc: body.desc ?? existing.desc,
                prompt: body.prompt ?? existing.prompt,
                tools: body.tools ?? existing.tools,
                actionType: body.actionType ?? existing.actionType,
                dataSchema: body.dataSchema ?? existing.dataSchema,
            };
            if (body.tools?.length) {
                const missing = body.tools.filter((t) => !hasDeclaration(t));
                if (missing.length) return err(`Missing tool declarations: ${missing.join(", ")}`);
            }
            await updateFeature(merged);
            return ok({ updated: name });
        }
        if (path.startsWith("/features/") && method === "DELETE") {
            const name = extractId(path, "/features/");
            return (await deleteFeature(name)) ? ok({ deleted: name }) : err("Not found", 404);
        }

        // --- Session ---
        if (path.startsWith("/session/") && method === "DELETE") {
            const id = extractId(path, "/session/");
            await deleteSession(id);
            return ok({ deleted: id });
        }

        // --- Health ---
        if (path === "/health") return ok({ status: "ok", timestamp: Date.now() });

        return err("Not found", 404);
    } catch (e: unknown) {
        console.error("Request error:", e);
        return err((e as Error).message ?? "Internal error", 500);
    }
}

export async function startServer() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();
    loadAudioConfig();

    Bun.serve({ port: PORT, fetch: handleRequest });

    console.log(`✓ API server on http://localhost:${PORT}`);
    console.log(`
  Chat:
    POST /chat             → AssistantResponse JSON
    POST /query-with-audio  → SSE stream (response + audio chunks)

  KB:       GET|POST|DELETE /kb    GET|PUT|DELETE /kb/:id
  Features: GET|POST|DELETE /features  GET|PUT|DELETE /features/:name
  Session:  DELETE /session/:id
  Health:   GET /health
    `);
}
