import type { ToolImplementation, HttpToolImpl, Session, ToolResult } from "./types";
import { getToolConfig } from "./registry";

// ─── Builtin Handlers (for complex logic that can't be config-driven) ───

type BuiltinHandler = (args: Record<string, string>, session: Session) => Promise<ToolResult>;

const builtinHandlers = new Map<string, BuiltinHandler>();

export function registerBuiltin(name: string, handler: BuiltinHandler): void {
    builtinHandlers.set(name, handler);
}

export function hasBuiltin(name: string): boolean {
    return builtinHandlers.has(name);
}

// ─── Template Interpolation ───

/**
 * Replace {{param}} with args values and {{ENV.VAR}} with env vars.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(ENV\.)?([^}]+)\}\}/g, (_, isEnv: string | undefined, key: string) => {
        if (isEnv) return process.env[key] ?? "";
        return vars[key] ?? "";
    });
}

/**
 * Deep-interpolate an object/array/string.
 */
function interpolateObj(obj: unknown, vars: Record<string, string>): unknown {
    if (typeof obj === "string") return interpolate(obj, vars);
    if (Array.isArray(obj)) return obj.map((item) => interpolateObj(item, vars));
    if (obj && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = interpolateObj(v, vars);
        }
        return result;
    }
    return obj;
}

/**
 * Extract a nested value by dot-path (e.g. "data.results.0.name").
 */
function getNestedValue(obj: unknown, path: string): unknown {
    return path.split(".").reduce((curr, key) => {
        if (curr && typeof curr === "object") return (curr as Record<string, unknown>)[key];
        return undefined;
    }, obj);
}

// ─── HTTP Tool Executor ───

async function executeHttp(impl: HttpToolImpl, args: Record<string, string>): Promise<string> {
    const url = interpolate(impl.url, args);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(impl.headers ?? {})) {
        headers[k] = interpolate(v, args);
    }

    let body: string | undefined;
    if (impl.bodyTemplate && impl.method !== "GET") {
        body = JSON.stringify(interpolateObj(impl.bodyTemplate, args));
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
        method: impl.method,
        headers,
        body,
        signal: AbortSignal.timeout(impl.timeout ?? 10_000),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        return `API call failed (${res.status}): ${errText}`;
    }

    const contentType = res.headers.get("content-type") ?? "";
    let data: unknown;

    if (contentType.includes("application/json")) {
        data = await res.json();
    } else {
        data = await res.text();
    }

    // Extract specific path from response
    if (impl.responseMapping) {
        const extracted = getNestedValue(data, impl.responseMapping);
        if (extracted === undefined) return JSON.stringify(data);
        return typeof extracted === "string" ? extracted : JSON.stringify(extracted);
    }

    // Template-based response
    if (impl.responseTemplate) {
        const responseStr = typeof data === "string" ? data : JSON.stringify(data);
        return interpolate(impl.responseTemplate, { ...args, __response__: responseStr });
    }

    return typeof data === "string" ? data : JSON.stringify(data);
}

// ─── Generic Tool Executor ───

export async function executeDynamicTool(
    name: string,
    args: Record<string, string>,
    session: Session,
): Promise<ToolResult> {
    const config = getToolConfig(name);
    if (!config) {
        return { msg: `Tool "${name}" not found in registry.` };
    }

    return executeImpl(config.implementation, args, session);
}

export async function executeImpl(
    impl: ToolImplementation,
    args: Record<string, string>,
    session: Session,
): Promise<ToolResult> {
    try {
        switch (impl.type) {
            case "http": {
                const msg = await executeHttp(impl, args);
                return { msg };
            }
            case "static": {
                return { msg: impl.response };
            }
            case "builtin": {
                const handler = builtinHandlers.get(impl.handler);
                if (!handler) {
                    return { msg: `Builtin handler "${impl.handler}" not registered.` };
                }
                return handler(args, session);
            }
            default:
                return { msg: `Unknown tool implementation type.` };
        }
    } catch (e: unknown) {
        const msg = `Tool execution error: ${(e as Error).message}`;
        console.error(msg);
        return { msg };
    }
}
