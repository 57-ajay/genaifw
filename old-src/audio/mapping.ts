import type { UIActionType } from "../types";

const ACTION_AUDIO_MAP: Record<string, string | null> = {
    show_duties_list: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fduties_found.wav?alt=media&token=932582fa-e17a-47a5-95e1-498dea48613c",
    show_cng_stations: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fcng.wav?alt=media&token=7b213349-af22-4d3b-84ba-26cd814926ef",
    show_petrol_stations: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fpetrol.wav?alt=media&token=1fb702e7-7bba-4296-86f1-40893d51a9f2",
    show_parking: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fparking_space__found.wav?alt=media&token=67c4d17e-357c-4c20-8b9e-7c1eca1e7443",
    show_nearby_drivers: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fdrivers.wav?alt=media&token=50809b33-6daa-4fb2-bbd5-08c6258f0e5a",
    show_towing: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Ftowing_services.wav?alt=media&token=477ed6cf-afdc-42cf-aa97-1059c79aaffe",
    show_toilets: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Ftoilets.wav?alt=media&token=8b21990b-8150-494a-aec5-42266abb62b6",
    show_taxi_stands: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Ftaxi_stands.wav?alt=media&token=0640aa54-67e4-458d-8d36-c39b4a2d7637",
    show_auto_parts: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fauto_parts.wav?alt=media&token=1379ed03-5f3b-40e1-b6a8-4cdb5b4cc4bf",
    show_car_repair: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fcar_repair_services.wav?alt=media&token=b7dd0b51-0bc3-4f05-aa6b-3f7eb57d0cf4",
    show_hospital: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fhospital.wav?alt=media&token=7cfaccfb-012e-4e5c-8243-8a7c38165db5",
    show_police_station: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fpolice.wav?alt=media&token=f8eca615-5db3-4ec2-8054-fbc625c082fa",
    show_fraud: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Ffraud_initial.wav?alt=media&token=e8459dc7-4220-4331-a741-bb4f0f193b48",
    show_advance: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fadvance_lock.wav?alt=media&token=337b98c1-61d8-4658-a095-0598b418f6d8",
    show_end: "https://firebasestorage.googleapis.com/v0/b/bwi-cabswalle.appspot.com/o/Raahi%2Fthank_you.wav?alt=media&token=705ff101-966a-4dbc-8f4f-1ee559d83931",
    show_info: null,
    show_otp_input: null,
    show_verification_result: null,
    show_map: null,
    none: null,
};

export function getAudioUrl(actionType: UIActionType): string | null {
    return ACTION_AUDIO_MAP[actionType] ?? null;
}

export function setAudioUrl(actionType: string, url: string): void {
    ACTION_AUDIO_MAP[actionType] = url;
}

export function getAllMappedUrls(): Map<string, string> {
    const mapped = new Map<string, string>();
    for (const [key, url] of Object.entries(ACTION_AUDIO_MAP)) {
        if (url) mapped.set(key, url);
    }
    return mapped;
}
