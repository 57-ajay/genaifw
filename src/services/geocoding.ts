import { GOOGLE_MAPS_API_KEY } from "../config";

export interface GeoResult {
    coordinates: [number, number] | null;
    country: string | null;
}

export async function geocodeCity(city: string): Promise<GeoResult> {
    if (!city?.trim()) return { coordinates: null, country: null };

    const params = new URLSearchParams({
        address: city,
        key: GOOGLE_MAPS_API_KEY,
        region: "in",
    });

    try {
        const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
        if (!res.ok) return { coordinates: null, country: null };

        const data = (await res.json()) as {
            status: string;
            results: Array<{
                geometry: { location: { lat: number; lng: number } };
                address_components: Array<{ types: string[]; short_name: string }>;
            }>;
        };

        if (data.status !== "OK" || !data.results?.length) {
            return { coordinates: null, country: null };
        }

        const result = data.results[0]!;
        const loc = result.geometry.location;
        const countryComp = result.address_components.find((c) => c.types.includes("country"));

        return {
            coordinates: [loc.lat, loc.lng],
            country: countryComp?.short_name ?? null,
        };
    } catch (e: unknown) {
        console.error(`Geocoding failed for '${city}':`, (e as Error).message);
        return { coordinates: null, country: null };
    }
}

export async function validateIndianCity(city: string): Promise<{
    valid: boolean;
    coordinates: [number, number] | null;
    country: string | null;
}> {
    const { coordinates, country } = await geocodeCity(city);
    if (country === null) return { valid: true, coordinates: null, country: null };
    return { valid: country === "IN", coordinates, country };
}
