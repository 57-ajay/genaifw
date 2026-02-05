import {
    connectRedis,
    seedDefaults,
    addKBEntries,
    getAllKBEntries,
    clearKB,
    addFeature,
    getAllFeatures,
    clearFeatures,
    getSession,
    deleteSession,
    newSession,
} from "./store";
import { hasDeclaration } from "./tools";
import { resolve, BASE_TOOLS } from "./agent";
import type { KBEntry, FeatureDetail, APIResponse } from "./types";

const PORT = parseInt(process.env.PORT ?? "3000", 10);


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


async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;


    if (path === "/kb" && method === "GET") {
        const entries = await getAllKBEntries();
        return ok(entries);
    }

    if (path === "/kb" && method === "POST") {
        const body = await readBody<KBEntry | KBEntry[]>(req);
        const entries = Array.isArray(body) ? body : [body];

        for (const e of entries) {
            if (!e.type || !e.desc) return err("Each entry needs 'type' and 'desc'");
            if (e.type === "feature" && (!e.featureName || !e.tools?.length)) {
                return err("Feature entries need 'featureName' and 'tools' array");
            }
        }

        const ids = await addKBEntries(entries);
        return ok({ added: ids.length, ids });
    }

    if (path === "/kb" && method === "DELETE") {
        await clearKB();
        return ok({ cleared: true });
    }


    if (path === "/features" && method === "GET") {
        const features = await getAllFeatures();
        return ok(features);
    }

    if (path === "/features" && method === "POST") {
        const body = await readBody<FeatureDetail>(req);
        if (!body.featureName || !body.prompt || !body.tools?.length) {
            return err("Need 'featureName', 'prompt', and 'tools' array");
        }
        const missing = body.tools.filter((t) => !hasDeclaration(t));
        if (missing.length) {
            return err(
                `Tool declarations missing for: ${missing.join(", ")}. Add them in tools.ts first.`
            );
        }
        await addFeature(body);
        return ok({ added: body.featureName });
    }

    if (path === "/features" && method === "DELETE") {
        await clearFeatures();
        return ok({ cleared: true });
    }


    if (path === "/chat" && method === "POST") {
        const body = await readBody<{ sessionId: string; message: string }>(req);
        if (!body.sessionId || !body.message) {
            return err("Need 'sessionId' and 'message'");
        }

        let session = await getSession(body.sessionId);
        if (!session) {
            session = newSession(body.sessionId, BASE_TOOLS);
        }

        session.history.push({ role: "user", parts: [{ text: body.message }] });

        try {
            const reply = await resolve(session);
            return ok({ reply, sessionId: body.sessionId });
        } catch (e: any) {
            return err(`Agent error: ${e.message}`, 500);
        }
    }


    if (path.startsWith("/session/") && method === "DELETE") {
        const id = path.replace("/session/", "");
        await deleteSession(id);
        return ok({ deleted: id });
    }


    if (path === "/health") {
        return ok({ status: "ok", timestamp: Date.now() });
    }

    return err("Not found", 404);
}


export async function startServer() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();

    Bun.serve({
        port: PORT,
        fetch: handleRequest,
    });

    console.log(`API server on http://localhost:${PORT}`);
    console.log(`
  Endpoints:
    GET    /health           — health check
    GET    /kb               — list all KB entries
    POST   /kb               — add KB entry/entries
    DELETE /kb               — clear all KB entries
    GET    /features         — list all features
    POST   /features         — add a feature
    DELETE /features         — clear all features
    POST   /chat             — send message { sessionId, message }
    DELETE /session/:id      — delete a session
  `);
}
