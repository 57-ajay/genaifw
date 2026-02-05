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

/** Extract ID from path like /kb/some-id-here */
function extractId(path: string, prefix: string): string {
    return path.slice(prefix.length);
}

//  Routes

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {

        // GET /kb — list all
        if (path === "/kb" && method === "GET") {
            const entries = await getAllKBEntries();
            return ok(entries);
        }

        // POST /kb — add entry/entries
        if (path === "/kb" && method === "POST") {
            const body = await readBody<KBEntry | KBEntry[]>(req);
            const entries = Array.isArray(body) ? body : [body];

            for (const e of entries) {
                if (!e.type || !e.desc)
                    return err("Each entry needs 'type' and 'desc'");
                if (e.type === "feature" && (!e.featureName || !e.tools?.length)) {
                    return err("Feature entries need 'featureName' and 'tools' array");
                }
            }

            const ids = await addKBEntries(entries);
            return ok({ added: ids.length, ids });
        }

        // DELETE /kb — clear all
        if (path === "/kb" && method === "DELETE") {
            await clearKB();
            return ok({ cleared: true });
        }

        // GET /kb/:id — get one entry
        if (path.startsWith("/kb/") && method === "GET") {
            const id = extractId(path, "/kb/");
            const entry = await getKBEntry(id);
            if (!entry) return err("KB entry not found", 404);
            return ok({ id, ...entry });
        }

        // PUT /kb/:id — update entry (replaces it, re-generates embedding)
        if (path.startsWith("/kb/") && method === "PUT") {
            const id = extractId(path, "/kb/");
            const body = await readBody<KBEntry>(req);
            if (!body.type || !body.desc) return err("Need 'type' and 'desc'");
            if (body.type === "feature" && (!body.featureName || !body.tools?.length)) {
                return err("Feature entries need 'featureName' and 'tools'");
            }
            const updated = await updateKBEntry(id, body);
            if (!updated) return err("KB entry not found", 404);
            return ok({ updated: id });
        }

        // DELETE /kb/:id — delete one entry
        if (path.startsWith("/kb/") && method === "DELETE") {
            const id = extractId(path, "/kb/");
            const deleted = await deleteKBEntry(id);
            if (!deleted) return err("KB entry not found", 404);
            return ok({ deleted: id });
        }


        // GET /features — list all
        if (path === "/features" && method === "GET") {
            const features = await getAllFeatures();
            return ok(features);
        }

        // POST /features — add new (or use PUT to upsert)
        if (path === "/features" && method === "POST") {
            const body = await readBody<FeatureDetail>(req);
            if (!body.featureName || !body.prompt || !body.tools?.length) {
                return err("Need 'featureName', 'prompt', and 'tools' array");
            }
            const missing = body.tools.filter((t) => !hasDeclaration(t));
            if (missing.length) {
                return err(
                    `Tool declarations missing: ${missing.join(", ")}. Add them in tools.ts first.`
                );
            }
            await addFeature(body);
            return ok({ added: body.featureName });
        }

        // DELETE /features — clear all
        if (path === "/features" && method === "DELETE") {
            await clearFeatures();
            return ok({ cleared: true });
        }

        // GET /features/:name — get one
        if (path.startsWith("/features/") && method === "GET") {
            const name = extractId(path, "/features/");
            const detail = await getFeatureDetail(name);
            if (!detail) return err("Feature not found", 404);
            return ok(detail);
        }

        // PUT /features/:name — update (replace prompt, tools, desc)
        if (path.startsWith("/features/") && method === "PUT") {
            const name = extractId(path, "/features/");
            const body = await readBody<Partial<FeatureDetail>>(req);

            const existing = await getFeatureDetail(name);
            if (!existing) return err("Feature not found", 404);

            // Merge: overwrite only provided fields
            const merged: FeatureDetail = {
                featureName: name,
                desc: body.desc ?? existing.desc,
                prompt: body.prompt ?? existing.prompt,
                tools: body.tools ?? existing.tools,
            };

            if (body.tools?.length) {
                const missing = body.tools.filter((t) => !hasDeclaration(t));
                if (missing.length) {
                    return err(
                        `Tool declarations missing: ${missing.join(", ")}. Add them in tools.ts first.`
                    );
                }
            }

            await updateFeature(merged);
            return ok({ updated: name });
        }

        // DELETE /features/:name — delete one
        if (path.startsWith("/features/") && method === "DELETE") {
            const name = extractId(path, "/features/");
            const deleted = await deleteFeature(name);
            if (!deleted) return err("Feature not found", 404);
            return ok({ deleted: name });
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

            session.history.push({
                role: "user",
                parts: [{ text: body.message }],
            });

            const reply = await resolve(session);
            return ok({ reply, sessionId: body.sessionId });
        }


        if (path.startsWith("/session/") && method === "DELETE") {
            const id = extractId(path, "/session/");
            await deleteSession(id);
            return ok({ deleted: id });
        }


        if (path === "/health") {
            return ok({ status: "ok", timestamp: Date.now() });
        }

        return err("Not found", 404);
    } catch (e: any) {
        console.error("Request error:", e);
        return err(e.message ?? "Internal error", 500);
    }
}


export async function startServer() {
    await connectRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
    await seedDefaults();

    Bun.serve({
        port: PORT,
        fetch: handleRequest,
    });

    console.log(`✓ API server on http://localhost:${PORT}`);
    console.log(`
  KB Endpoints:
    GET    /kb               — list all entries (with IDs)
    POST   /kb               — add entry/entries
    GET    /kb/:id           — get one entry
    PUT    /kb/:id           — update entry (re-generates embedding)
    DELETE /kb/:id           — delete one entry
    DELETE /kb               — clear all entries

  Feature Endpoints:
    GET    /features              — list all
    POST   /features              — add new feature
    GET    /features/:name        — get one
    PUT    /features/:name        — update (partial merge)
    DELETE /features/:name        — delete one
    DELETE /features              — clear all

  Chat:
    POST   /chat             — { sessionId, message }
    DELETE /session/:id      — delete session

  Health:
    GET    /health
  `);
}
