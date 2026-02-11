import {
    connectRedis, seedDefaults,
    addKBEntries, getKBEntry, updateKBEntry, deleteKBEntry, getAllKBEntries, clearKB,
    addFeature, getFeatureDetail, updateFeature, deleteFeature, getAllFeatures, clearFeatures,
    deleteSession,
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

async function readBody<T>(req: Request): Promise<T> {
    const req_d = await req.json() as T;
    // console.dir(req_d, { depth: null });
    return req_d;
}
function extractId(path: string, prefix: string): string { return path.slice(prefix.length); }

/** Maps incoming snake_case HTTP fields to internal camelCase. Accepts both formats for compat. */
function normalizeRequest(raw: Record<string, unknown>): AssistantRequest {
    // console.log("normalizing");
    return {
        sessionId: "69ajay69"/*(raw.session_id ?? raw.sessionId ?? "") as string*/,
        message: (raw.message ?? "") as string,
        text: (raw.text) as string | undefined,
        driverProfile: (raw.driver_profile ?? raw.driverProfile) as AssistantRequest["driverProfile"],
        currentLocation: (raw.current_location ?? raw.currentLocation) as AssistantRequest["currentLocation"],
        userData: (raw.user_data ?? raw.userData) as AssistantRequest["userData"],
        audio: (raw.audio) as boolean | undefined,
        interactionCount: (raw.interaction_count ?? raw.interactionCount) as number | undefined,
        isHome: (raw.is_home ?? raw.isHome) as boolean | undefined,
        requestCount: (raw.request_count ?? raw.requestCount) as number | undefined,
        chipClick: (raw.chip_click ?? raw.chipClick) as string | undefined,
        phoneNo: (raw.phone_no ?? raw.phoneNo) as string | undefined,
    };
}

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
        // --- Chat endpoints ---
        if (path === "/chat" && method === "POST") {
            const raw = await readBody<Record<string, unknown>>(req);
            const body = normalizeRequest(raw);
            if (!body.sessionId) return err("Need 'session_id'");
            if (!body.message && !body.text && !body.chipClick) return err("Need 'message', 'text', or 'chip_click'");

            const { response } = await handleChat(body);
            return json<AssistantResponse>(response);
        }

        if (path === "/query-with-audio" && method === "POST") {
            const raw = await readBody<Record<string, unknown>>(req);



            const body = normalizeRequest(raw);
            console.dir(body, { depth: null });
            if (!body.sessionId) return err("Need 'session_id'");


            const { response } = await handleChat(body);
            console.dir(response, { depth: null });
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
