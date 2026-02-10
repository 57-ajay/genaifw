import {
    TYPESENSE_HOST,
    /*TYPESENSE_PORT,*/
    TYPESENSE_PROTOCOL,
    TYPESENSE_API_KEY,
    TRIPS_COLLECTION,
    LEADS_COLLECTION,
} from "../config";
import { geocodeCity } from "./geocoding";

const BASE_URL = `${TYPESENSE_PROTOCOL}://${TYPESENSE_HOST}`;
const HEADERS = {
    "Content-Type": "application/json",
    "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY,
};

async function tsSearch(collection: string, params: Record<string, string | number>): Promise<Record<string, unknown>[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));

    const res = await fetch(`${BASE_URL}/collections/${collection}/documents/search?${qs}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Typesense ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as { hits?: Array<{ document: Record<string, unknown> }> };
    return (data.hits ?? []).map((h) => h.document);
}

export async function searchTrips(opts: {
    pickupCity?: string;
    dropCity?: string;
    pickupCoordinates?: [number, number] | null;
    radiusKm?: number;
    limit?: number;
}): Promise<Record<string, unknown>[]> {
    const { pickupCity, dropCity, radiusKm = 50, limit = 50 } = opts;
    let { pickupCoordinates } = opts;
    const seen = new Set<string>();
    const all: Record<string, unknown>[] = [];

    const hasPickup = !!pickupCity?.trim();
    const hasDrop = !!dropCity?.trim() && dropCity.toLowerCase() !== "any";

    const add = (docs: Record<string, unknown>[]) => {
        for (const d of docs) {
            const id = d["id"] as string | undefined;
            if (id && !seen.has(id)) { seen.add(id); all.push(d); }
        }
    };

    if (hasPickup || hasDrop) {
        try {
            const q = [pickupCity, hasDrop ? dropCity : ""].filter(Boolean).join(" ");
            const docs = await tsSearch(TRIPS_COLLECTION, {
                q,
                query_by: "customerPickupLocationCity,customerDropLocationCity",
                filter_by: "customerIsOnboardedAsPartner:=false",
                sort_by: "createdAt:desc",
                per_page: limit,
            });
            add(docs);
        } catch (e: unknown) { console.error("[TRIPS] text search failed:", (e as Error).message); }
    }

    if (!pickupCoordinates && hasPickup) {
        const geo = await geocodeCity(pickupCity!);
        if (geo.coordinates && geo.country === "IN") pickupCoordinates = geo.coordinates;
    }

    if (pickupCoordinates) {
        try {
            const [lat, lng] = pickupCoordinates;
            const filters = ["customerIsOnboardedAsPartner:=false"];
            if (hasPickup) filters.push(`customerPickupLocationCity:${pickupCity}`);
            if (hasDrop) filters.push(`customerDropLocationCity:${dropCity}`);

            const docs = await tsSearch(TRIPS_COLLECTION, {
                q: "*",
                query_by: "",
                filter_by: `customerPickupLocationCoordinates:(${lat}, ${lng}, ${radiusKm} km) && ${filters.join(" && ")}`,
                sort_by: `customerPickupLocationCoordinates(${lat}, ${lng}):asc, createdAt:desc`,
                per_page: limit,
            });
            add(docs);
        } catch (e: unknown) { console.error("[TRIPS] geo search failed:", (e as Error).message); }
    }

    all.sort((a, b) => ((b["createdAt"] as number) ?? 0) - ((a["createdAt"] as number) ?? 0));
    return all;
}

export async function searchLeads(opts: {
    pickupCity?: string;
    dropCity?: string;
    pickupCoordinates?: [number, number] | null;
    radiusKm?: number;
    limit?: number;
}): Promise<Record<string, unknown>[]> {
    const { pickupCity, dropCity, radiusKm = 50, limit = 50 } = opts;
    let { pickupCoordinates } = opts;
    const seen = new Set<string>();
    const all: Record<string, unknown>[] = [];

    const hasPickup = !!pickupCity?.trim();
    const hasDrop = !!dropCity?.trim() && dropCity.toLowerCase() !== "any";

    const add = (docs: Record<string, unknown>[]) => {
        for (const d of docs) {
            const id = d["id"] as string | undefined;
            if (id && !seen.has(id)) { seen.add(id); all.push(d); }
        }
    };

    if (hasPickup || hasDrop) {
        try {
            const q = [pickupCity, hasDrop ? dropCity : ""].filter(Boolean).join(" ");
            const docs = await tsSearch(LEADS_COLLECTION, {
                q,
                query_by: "fromTxt,toTxt",
                filter_by: "status:!=pending",
                sort_by: "createdAt:desc",
                per_page: limit,
            });
            add(docs);
        } catch (e: unknown) { console.error("[LEADS] text search failed:", (e as Error).message); }
    }

    if (!pickupCoordinates && hasPickup) {
        const geo = await geocodeCity(pickupCity!);
        if (geo.coordinates && geo.country === "IN") pickupCoordinates = geo.coordinates;
    }

    if (pickupCoordinates) {
        try {
            const [lat, lng] = pickupCoordinates;
            const filters = ["status:!=pending"];
            if (hasPickup) filters.push(`fromTxt:${pickupCity}`);
            if (hasDrop) filters.push(`toTxt:${dropCity}`);

            const docs = await tsSearch(LEADS_COLLECTION, {
                q: "*",
                query_by: "",
                filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && ${filters.join(" && ")}`,
                sort_by: `location(${lat}, ${lng}):asc, createdAt:desc`,
                per_page: limit,
            });
            add(docs);
        } catch (e: unknown) { console.error("[LEADS] geo search failed:", (e as Error).message); }
    }

    all.sort((a, b) => ((b["createdAt"] as number) ?? 0) - ((a["createdAt"] as number) ?? 0));
    return all;
}
