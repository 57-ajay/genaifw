import {
    connectRedis, seedDefaults,
    addKBEntries, getKBEntry, updateKBEntry, deleteKBEntry, getAllKBEntries, clearKB,
    addFeature, getFeatureDetail, updateFeature, deleteFeature, getAllFeatures, clearFeatures,
    deleteSession,
} from "./store";
import { handleChat } from "./handlers/chat";
import { resolveAudio, streamAudioRaw, AUDIO_CONFIG } from "./audio";
import { loadAudioConfig } from "./services/audio-config";
import { registerBuiltins } from "./builtins";
import type { KBEntry, FeatureDetail, APIResponse, AssistantRequest, AssistantResponse, ToolConfig } from "./types";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

function json<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function ok<T>(data: T): Response { return json<APIResponse<T>>({ ok: true, data }); }
function err(error: string, status = 400): Response { return json<APIResponse>({ ok: false, error }, status); }

async function readBody<T>(req: Request): Promise<T> {
    return (await req.json()) as T;
}

function extractId(path: string, prefix: string): string { return path.slice(prefix.length); }

function normalizeRequest(raw: Record<string, unknown>): AssistantRequest {
    return {
        sessionId: raw.sessionId as string,
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

/**
 * Validate a FeatureDetail from dashboard input.
 */
function validateFeature(body: FeatureDetail): string | null {
    if (!body.featureName) return "Need 'featureName'";
    if (!body.prompt) return "Need 'prompt'";
    if (!body.actions?.length) return "Need at least one action in 'actions'";
    if (!body.defaultAction) return "Need 'defaultAction'";
    if (!body.dataSchema) return "Need 'dataSchema'";

    // Validate each action
    for (const a of body.actions) {
        if (!a.uiAction || !a.intent) return `Each action needs 'uiAction' and 'intent'`;
    }

    // Validate defaultAction is in actions
    if (!body.actions.some((a) => a.uiAction === body.defaultAction)) {
        return `'defaultAction' (${body.defaultAction}) must be in 'actions'`;
    }

    // Validate tool configs
    if (body.tools?.length) {
        for (const tc of body.tools) {
            const toolErr = validateToolConfig(tc);
            if (toolErr) return `Tool "${tc.name}": ${toolErr}`;
        }
    }

    return null;
}

function validateToolConfig(tc: ToolConfig): string | null {
    if (!tc.name) return "needs 'name'";
    if (!tc.declaration?.description) return "needs 'declaration.description'";
    if (!tc.declaration?.parameters) return "needs 'declaration.parameters'";
    if (!tc.implementation?.type) return "needs 'implementation.type'";

    const impl = tc.implementation;
    if (impl.type === "http") {
        if (!impl.url) return "HTTP impl needs 'url'";
        if (!impl.method) return "HTTP impl needs 'method'";
    } else if (impl.type === "static") {
        if (!impl.response) return "Static impl needs 'response'";
    } else if (impl.type === "builtin") {
        if (!impl.handler) return "Builtin impl needs 'handler'";
    } else {
        return `Unknown implementation type: ${(impl as Record<string, unknown>).type}`;
    }

    return null;
}

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
        // ─── Chat ───

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
            if (!body.sessionId) return err("Need 'session_id'");

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
                        console.error("TTS streaming failed:", (e as Error).message);
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

        // ─── KB Admin ───

        if (path === "/kb" && method === "GET") return ok(await getAllKBEntries());
        if (path === "/kb" && method === "POST") {
            const body = await readBody<KBEntry | KBEntry[]>(req);
            const entries = Array.isArray(body) ? body : [body];
            for (const e of entries) {
                if (!e.type || !e.desc) return err("Each entry needs 'type' and 'desc'");
                if (e.type === "feature" && !e.featureName)
                    return err("Feature entries need 'featureName'");
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

        // ─── Features Admin (new schema) ───

        if (path === "/features" && method === "GET") return ok(await getAllFeatures());

        if (path === "/features" && method === "POST") {
            const body = await readBody<FeatureDetail>(req);
            const validationErr = validateFeature(body);
            if (validationErr) return err(validationErr);

            // Ensure tools default
            body.tools = body.tools ?? [];
            body.audioMappings = body.audioMappings ?? {};
            body.desc = body.desc ?? "";

            await addFeature(body);
            return ok({ added: body.featureName });
        }

        if (path === "/features" && method === "DELETE") {
            await clearFeatures();
            return ok({ cleared: true });
        }

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
                actions: body.actions ?? existing.actions,
                defaultAction: body.defaultAction ?? existing.defaultAction,
                dataSchema: body.dataSchema ?? existing.dataSchema,
                audioMappings: body.audioMappings ?? existing.audioMappings,
                postProcessor: body.postProcessor ?? existing.postProcessor,
            };

            // Validate tools if provided
            if (body.tools?.length) {
                for (const tc of body.tools) {
                    const toolErr = validateToolConfig(tc);
                    if (toolErr) return err(`Tool "${tc.name}": ${toolErr}`);
                }
            }

            await updateFeature(merged);
            return ok({ updated: name });
        }

        if (path.startsWith("/features/") && method === "DELETE") {
            const name = extractId(path, "/features/");
            return (await deleteFeature(name)) ? ok({ deleted: name }) : err("Not found", 404);
        }

        // ─── Session ───

        if (path.startsWith("/session/") && method === "DELETE") {
            const id = extractId(path, "/session/");
            await deleteSession(id);
            return ok({ deleted: id });
        }

        // ─── Health ───

        if (path === "/health") return ok({ status: "ok", timestamp: Date.now() });

        return err("Not found", 404);
    } catch (e: unknown) {
        console.error("Request error:", e);
        return err((e as Error).message ?? "Internal error", 500);
    }
}

export async function startServer() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    registerBuiltins();
    loadAudioConfig();
    await seedDefaults();

    Bun.serve({ port: PORT, fetch: handleRequest });

    console.log(`✓ API server on http://localhost:${PORT}`);
    console.log(`
  Chat:
    POST /chat              → AssistantResponse JSON
    POST /query-with-audio  → Chunked binary (JSON\\n + WAV audio)

  KB:       GET|POST|DELETE /kb    GET|PUT|DELETE /kb/:id
  Features: GET|POST|DELETE /features  GET|PUT|DELETE /features/:name
  Session:  DELETE /session/:id
  Health:   GET /health
    `);
}
