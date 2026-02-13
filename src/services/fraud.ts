const FRAUD_API = "https://us-central1-bwi-cabswalle.cloudfunctions.net/raahi-data/getDriverRaing";

export interface FraudResult {
    ratingKey: string | null;
    data: Record<string, unknown> | null;
}

export async function checkDriverRating(phoneNo: string): Promise<FraudResult> {
    try {
        const res = await fetch(FRAUD_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phoneNo }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) return { ratingKey: null, data: null };

        const data = (await res.json()) as Record<string, unknown>;

        if (data["found"]) {
            const detail = (data["driverDetail"] ?? {}) as Record<string, unknown>;
            const fraud = !!detail["fraud"];
            const verified = !!detail["profileVerified"];

            if (fraud) return { ratingKey: "fraud_low", data };
            if (verified) return { ratingKey: "found_verified", data };
            return { ratingKey: "found_unverified", data };
        }

        return { ratingKey: "not_found", data };
    } catch (e: unknown) {
        console.error("Fraud check failed:", (e as Error).message);
        return { ratingKey: null, data: null };
    }
}
