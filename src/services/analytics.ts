import { ANALYTICS_URL } from "../config";

export async function logIntent(opts: {
    driverId: string;
    queryText: string;
    intent: string;
    sessionId: string;
    interactionCount: number;
    pickupCity?: string;
    dropCity?: string;
}): Promise<boolean> {
    const payload: Record<string, unknown> = {
        driverId: opts.driverId,
        intent: opts.intent,
        interactionCount: opts.interactionCount,
        createdAt: new Date().toISOString(),
        sessionId: opts.sessionId,
        queryText: opts.queryText,
    };

    if (opts.pickupCity) payload["pickupCity"] = opts.pickupCity;
    if (opts.dropCity) payload["dropCity"] = opts.dropCity;

    try {
        const res = await fetch(ANALYTICS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
    } catch (e: unknown) {
        console.error("Analytics log failed:", (e as Error).message);
        return false;
    }
}
