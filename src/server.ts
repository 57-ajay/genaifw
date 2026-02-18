import {
    connectRedis,
    seedDefaults,
    addKBEntries,
    getKBEntry,
    updateKBEntry,
    deleteKBEntry,
    getAllKBEntries,
    clearKB,
    addFeature,
    getFeatureDetail,
    updateFeature,
    deleteFeature,
    getAllFeatures,
    clearFeatures,
    deleteSession,
} from "./store";
import { loadAudioConfig } from "./services/audio-config";
import { registerBuiltins } from "./builtins";
import type { KBEntry, FeatureDetail, APIResponse, ToolConfig } from "./types";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

//  HTTP Helpers

function json<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function ok<T>(data: T): Response {
    return json<APIResponse<T>>({ ok: true, data });
}
function err(error: string, status = 400): Response {
    return json<APIResponse>({ ok: false, error }, status);
}

async function readBody<T>(req: Request): Promise<T> {
    return (await req.json()) as T;
}

function extractId(path: string, prefix: string): string {
    return path.slice(prefix.length);
}

//  Validation

function validateFeature(body: FeatureDetail): string | null {
    if (!body.featureName) return "Need 'featureName'";
    if (!body.prompt) return "Need 'prompt'";
    if (!body.actions?.length) return "Need at least one action in 'actions'";
    if (!body.defaultAction) return "Need 'defaultAction'";
    if (!body.dataSchema) return "Need 'dataSchema'";

    for (const a of body.actions) {
        if (!a.uiAction || !a.intent)
            return "Each action needs 'uiAction' and 'intent'";
    }

    if (!body.actions.some((a) => a.uiAction === body.defaultAction)) {
        return `'defaultAction' (${body.defaultAction}) must be in 'actions'`;
    }

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
        // KB Admin
        if (path === "/kb" && method === "GET")
            return ok(await getAllKBEntries());
        if (path === "/kb" && method === "POST") {
            const body = await readBody<KBEntry | KBEntry[]>(req);
            const entries = Array.isArray(body) ? body : [body];
            for (const e of entries) {
                if (!e.type || !e.desc)
                    return err("Each entry needs 'type' and 'desc'");
                if (e.type === "feature" && !e.featureName)
                    return err("Feature entries need 'featureName'");
            }
            const ids = await addKBEntries(entries);
            return ok({ added: ids.length, ids });
        }
        if (path === "/kb" && method === "DELETE") {
            await clearKB();
            return ok({ cleared: true });
        }

        if (path.startsWith("/kb/") && method === "GET") {
            const entry = await getKBEntry(extractId(path, "/kb/"));
            return entry ? ok(entry) : err("Not found", 404);
        }
        if (path.startsWith("/kb/") && method === "PUT") {
            const id = extractId(path, "/kb/");
            const body = await readBody<KBEntry>(req);
            if (!body.type || !body.desc) return err("Need 'type' and 'desc'");
            return (await updateKBEntry(id, body))
                ? ok({ updated: id })
                : err("Not found", 404);
        }
        if (path.startsWith("/kb/") && method === "DELETE") {
            const id = extractId(path, "/kb/");
            return (await deleteKBEntry(id))
                ? ok({ deleted: id })
                : err("Not found", 404);
        }

        // Features Admin

        if (path === "/features" && method === "GET")
            return ok(await getAllFeatures());

        if (path === "/features" && method === "POST") {
            const body = await readBody<FeatureDetail>(req);
            const validationErr = validateFeature(body);
            if (validationErr) return err(validationErr);

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
            const detail = await getFeatureDetail(
                extractId(path, "/features/"),
            );
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
            return (await deleteFeature(name))
                ? ok({ deleted: name })
                : err("Not found", 404);
        }

        // Session Admin

        if (path.startsWith("/session/") && method === "DELETE") {
            const id = extractId(path, "/session/");
            await deleteSession(id);
            return ok({ deleted: id });
        }

        //  Health

        if (path === "/health")
            return ok({ status: "ok", timestamp: Date.now() });

        return err("Not found", 404);
    } catch (e: unknown) {
        console.error("[Server] Request error:", e);
        return err((e as Error).message ?? "Internal error", 500);
    }
}

//  Startup
export async function startServer(): Promise<void> {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    registerBuiltins();
    loadAudioConfig();
    await seedDefaults();

    Bun.serve({ port: PORT, fetch: handleRequest });

    console.log(`✓ Admin API on http://localhost:${PORT}`);
    console.log(`
  KB:       GET|POST|DELETE /kb    GET|PUT|DELETE /kb/:id
  Features: GET|POST|DELETE /features  GET|PUT|DELETE /features/:name
  Session:  DELETE /session/:id
  Health:   GET /health
    `);
}
