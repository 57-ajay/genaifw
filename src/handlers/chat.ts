import type {
    AssistantRequest,
    AssistantResponse,
    IntentType,
    UIActionType,
    Session,
} from "../types";
import { ACTION_TO_INTENT } from "../types";
import { getSession, newSession, saveSession } from "../store";
import { resolve, BASE_TOOLS } from "../agent";
import {
    searchTrips,
    searchLeads,
    validateIndianCity,
    checkDriverRating,
    logIntent,
    getAudioUrl,
    getAudioUrlDirect,
} from "../services";

function empty(v: unknown): boolean {
    return !v || (typeof v === "string" && !v.trim());
}

function makeResponse(
    sessionId: string,
    intent: IntentType,
    uiAction: UIActionType,
    opts?: Partial<AssistantResponse>,
): AssistantResponse {
    return {
        session_id: sessionId,
        success: true,
        intent,
        ui_action: uiAction,
        response_text: "",
        data: null,
        audio_cached: false,
        cache_key: "",
        audio_url: null,
        ...opts,
    };
}

export interface HandleResult {
    response: AssistantResponse;
    session: Session | null;
}

export async function handleChat(
    req: AssistantRequest,
    onTextChunk?: (chunk: string) => void,
): Promise<HandleResult> {
    const sessionId = req.sessionId;
    const text = (req.message || req.text || "").trim();
    const interactionCount = req.interactionCount;
    const isHome = req.isHome ?? true;
    const requestCount = req.requestCount;
    const audioOpts = { interactionCount, isHome, requestCount };

    // --- Chip clicks (no AI needed) ---
    if (req.chipClick === "find") {
        return {
            response: makeResponse(sessionId, "generic", "none", {
                audio_url: getAudioUrlDirect("find_chip"),
            }),
            session: null,
        };
    }

    if (req.chipClick === "tools") {
        return {
            response: makeResponse(sessionId, "generic", "none", {
                audio_url: getAudioUrlDirect("tools_chip"),
            }),
            session: null,
        };
    }

    // --- Entry state (empty text) ---
    if (!text) {
        return {
            response: makeResponse(sessionId, "entry", "entry", {
                audio_url: getAudioUrl("entry", audioOpts),
            }),
            session: null,
        };
    }

    // --- Resolve or create session ---
    let session = await getSession(sessionId);
    if (!session) {
        session = newSession(sessionId, BASE_TOOLS, req.userData);
    } else if (req.userData) {
        session.userData = { ...session.userData, ...req.userData };
    }

    if (req.driverProfile) session.driverProfile = req.driverProfile;
    if (req.currentLocation) session.currentLocation = req.currentLocation;

    session.history.push({ role: "user", parts: [{ text }] });

    // --- Run agent ---
    const agentResult = await resolve(session, onTextChunk);
    const actionType = agentResult.action.type;
    const actionData = agentResult.action.data;
    const intent: IntentType = ACTION_TO_INTENT[actionType] ?? "generic";

    // --- Post-processing based on intent ---
    let data: Record<string, unknown> | null = Object.keys(actionData).length ? actionData : null;
    let finalIntent = intent;
    let finalAction: UIActionType = actionType;
    let audioUrl: string | null = null;
    let query: Record<string, unknown> | null = null;
    let counts: Record<string, number> | null = null;
    let ratingKey: string | null = null;

    if (intent === "get_duties") {
        const result = await handleDuties(
            sessionId,
            actionData,
            audioOpts,
            req.driverProfile?.id,
        );
        if (result.earlyReturn) {
            return { response: result.earlyReturn, session };
        }
        data = result.data;
        query = result.query;
        counts = result.counts;
        audioUrl = result.audioUrl;
    } else if (intent === "fraud" && req.phoneNo) {
        const fraudResult = await checkDriverRating(req.phoneNo);
        if (fraudResult.ratingKey && fraudResult.data) {
            finalIntent = "fraud_check_found";
            finalAction = "show_fraud_result";
            data = fraudResult.data;
            ratingKey = fraudResult.ratingKey;
        }
    }

    // --- Audio URL resolution ---
    if (!audioUrl) {
        audioUrl = getAudioUrl(finalIntent, audioOpts);
    }

    if (ratingKey) {
        const custom = getAudioUrlDirect(ratingKey);
        if (custom) audioUrl = custom;
    }

    // --- Analytics (fire-and-forget) ---
    if (req.driverProfile?.id) {
        const params = (data as Record<string, unknown>) ?? {};
        logIntent({
            driverId: req.driverProfile.id,
            queryText: text,
            intent: finalIntent,
            sessionId,
            interactionCount: interactionCount ?? 0,
            pickupCity: (query?.["pickup_city"] as string) ?? undefined,
            dropCity: (query?.["drop_city"] as string) ?? undefined,
        }).catch(() => {});
    }

    return {
        response: makeResponse(sessionId, finalIntent, finalAction, {
            response_text: agentResult.response,
            data,
            query,
            counts,
            audio_url: audioUrl,
        }),
        session,
    };
}

async function handleDuties(
    sessionId: string,
    actionData: Record<string, unknown>,
    audioOpts: { interactionCount?: number; isHome?: boolean; requestCount?: number },
    driverId?: string,
): Promise<{
    earlyReturn?: AssistantResponse;
    data: Record<string, unknown> | null;
    query: Record<string, unknown> | null;
    counts: Record<string, number> | null;
    audioUrl: string | null;
}> {
    const pickupCity = (actionData["from_city"] as string) ?? "";
    const dropCity = (actionData["to_city"] as string) ?? "";
    const pickupEmpty = empty(pickupCity);
    const dropEmpty = empty(dropCity);

    // Both cities missing → entry
    if (pickupEmpty && dropEmpty) {
        return {
            earlyReturn: makeResponse(sessionId, "entry", "entry", {
                audio_url: getAudioUrl("entry", audioOpts),
            }),
            data: null,
            query: null,
            counts: null,
            audioUrl: null,
        };
    }

    // Validate India
    let pickupCoords: [number, number] | null = null;
    let usedGeo = false;

    if (!pickupEmpty) {
        const v = await validateIndianCity(pickupCity);
        if (v.country && !v.valid) {
            return {
                earlyReturn: makeResponse(sessionId, "end", "show_end", {
                    audio_url: getAudioUrlDirect("india_only"),
                }),
                data: null, query: null, counts: null, audioUrl: null,
            };
        }
        if (v.coordinates) { pickupCoords = v.coordinates; usedGeo = true; }
    }

    if (!dropEmpty) {
        const v = await validateIndianCity(dropCity);
        if (v.country && !v.valid) {
            return {
                earlyReturn: makeResponse(sessionId, "end", "show_end", {
                    audio_url: getAudioUrlDirect("india_only"),
                }),
                data: null, query: null, counts: null, audioUrl: null,
            };
        }
    }

    // Search trips + leads in parallel
    const [trips, leads] = await Promise.all([
        searchTrips({ pickupCity, dropCity, pickupCoordinates: pickupCoords }).catch(() => [] as Record<string, unknown>[]),
        searchLeads({ pickupCity, dropCity, pickupCoordinates: pickupCoords }).catch(() => [] as Record<string, unknown>[]),
    ]);

    const queryInfo = { pickup_city: pickupCity || null, drop_city: dropCity || null, used_geo: usedGeo };
    const countsInfo = { trips: trips.length, leads: leads.length };

    // No results
    if (trips.length === 0 && leads.length === 0) {
        return {
            earlyReturn: makeResponse(sessionId, "end", "show_end", {
                data: { query: { pickup_city: pickupCity, drop_city: dropCity } },
                audio_url: getAudioUrlDirect("no_duty"),
            }),
            data: null, query: null, counts: null, audioUrl: null,
        };
    }

    // Audio URL override for one city missing
    let audioUrl = getAudioUrl("get_duties", audioOpts);
    if (pickupEmpty !== dropEmpty) {
        const override = getAudioUrlDirect("duties_no_pickup_drop");
        if (override) audioUrl = override;
    }

    return {
        data: { trips, leads },
        query: queryInfo,
        counts: countsInfo,
        audioUrl,
    };
}
