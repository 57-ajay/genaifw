import type { AgentResponse, UIActionType } from "./types";


type IntentType =
    | "entry" | "get_duties" | "cng_pumps" | "parking" | "petrol_pumps"
    | "nearby_drivers" | "towing" | "toilets" | "taxi_stands"
    | "auto_parts" | "car_repair" | "hospital" | "police_station"
    | "fraud" | "information" | "fraud_check_found" | "advance"
    | "border_tax" | "state_tax" | "puc" | "aitp" | "end" | "generic";

type UIAction =
    | "entry" | "show_duties_list" | "show_cng_stations" | "show_petrol_stations"
    | "show_parking" | "show_nearby_drivers" | "show_towing" | "show_toilets"
    | "show_taxi_stands" | "show_auto_parts" | "show_car_repair"
    | "show_hospital" | "show_police_station" | "show_fraud" | "show_info"
    | "show_fraud_result" | "show_advance" | "show_border_tax" | "show_state_tax"
    | "show_puc" | "show_aitp" | "show_map" | "show_end" | "none";

export interface ClientResponse {
    session_id: string;
    success: boolean;
    intent: IntentType;
    ui_action: UIAction;
    response_text: string;
    data: Record<string, any> | null;
}

const ACTION_TO_INTENT: Record<UIActionType, IntentType> = {
    show_duties_list: "get_duties",
    show_cng_stations: "cng_pumps",
    show_petrol_stations: "petrol_pumps",
    show_parking: "parking",
    show_nearby_drivers: "nearby_drivers",
    show_towing: "towing",
    show_toilets: "toilets",
    show_taxi_stands: "taxi_stands",
    show_auto_parts: "auto_parts",
    show_car_repair: "car_repair",
    show_hospital: "hospital",
    show_police_station: "police_station",
    show_fraud: "fraud",
    show_info: "information",
    show_advance: "advance",
    show_end: "end",
    show_map: "generic",
    show_otp_input: "generic",
    show_verification_result: "generic",
    none: "generic",
};

const ACTION_TO_UI: Record<UIActionType, UIAction> = {
    show_duties_list: "show_duties_list",
    show_cng_stations: "show_cng_stations",
    show_petrol_stations: "show_petrol_stations",
    show_parking: "show_parking",
    show_nearby_drivers: "show_nearby_drivers",
    show_towing: "show_towing",
    show_toilets: "show_toilets",
    show_taxi_stands: "show_taxi_stands",
    show_auto_parts: "show_auto_parts",
    show_car_repair: "show_car_repair",
    show_hospital: "show_hospital",
    show_police_station: "show_police_station",
    show_fraud: "show_fraud",
    show_info: "show_info",
    show_advance: "show_advance",
    show_end: "show_end",
    show_map: "show_map",
    show_otp_input: "none",
    show_verification_result: "none",
    none: "none",
};

export function toClientResponse(
    sessionId: string,
    agent: AgentResponse,
): ClientResponse {
    const actionType = agent.action.type;

    return {
        session_id: sessionId,
        success: true,
        intent: ACTION_TO_INTENT[actionType] ?? "generic",
        ui_action: ACTION_TO_UI[actionType] ?? "none",
        response_text: agent.response,
        data: Object.keys(agent.action.data).length ? agent.action.data : null,
    };
}
