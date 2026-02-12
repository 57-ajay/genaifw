export type UIActionType =
    | "entry"
    | "show_duties_list"
    | "show_cng_stations"
    | "show_petrol_stations"
    | "show_parking"
    | "show_nearby_drivers"
    | "show_towing"
    | "show_toilets"
    | "show_taxi_stands"
    | "show_auto_parts"
    | "show_car_repair"
    | "show_hospital"
    | "show_police_station"
    | "show_fraud"
    | "show_info"
    | "show_fraud_result"
    | "show_advance"
    | "show_border_tax"
    | "show_state_tax"
    | "show_puc"
    | "show_aitp"
    | "show_map"
    | "show_end"
    | "show_otp_input"
    | "show_verification_result"
    | "show_ev_charging"
    | "none";

export const ALL_UI_ACTIONS: UIActionType[] = [
    "entry", "show_duties_list", "show_cng_stations", "show_petrol_stations",
    "show_parking", "show_nearby_drivers", "show_towing", "show_toilets",
    "show_taxi_stands", "show_auto_parts", "show_car_repair", "show_hospital",
    "show_police_station", "show_fraud", "show_info", "show_fraud_result",
    "show_advance", "show_border_tax", "show_state_tax", "show_puc",
    "show_aitp", "show_map", "show_end", "show_otp_input",
    "show_verification_result", "show_ev_charging", "none",
];

export type IntentType =
    | "entry"
    | "get_duties"
    | "cng_pumps"
    | "parking"
    | "petrol_pumps"
    | "nearby_drivers"
    | "towing"
    | "toilets"
    | "taxi_stands"
    | "auto_parts"
    | "car_repair"
    | "hospital"
    | "police_station"
    | "fraud"
    | "information"
    | "fraud_check_found"
    | "advance"
    | "border_tax"
    | "state_tax"
    | "puc"
    | "aitp"
    | "end"
    | "ev_charging"
    | "generic";

// --- Request types ---

export interface Location {
    latitude: number;
    longitude: number;
}

export interface DriverProfile {
    id: string;
    name: string;
    phone: string;
    vehicle_type?: string;
    vehicle_number?: string;
    is_verified?: boolean;
    gender?: string;
    city?: string;
    age?: number;
    married?: boolean;
    children?: number;
    identity?: string;
    bio?: string;
    userName?: string;
    verified?: boolean;
    profileVerified?: boolean;
    isAadhaarVerified?: boolean;
    isDLVerified?: boolean;
    fraud?: boolean;
    fraudReports?: number;
    profileUrl?: string;
    isPremium?: boolean;
    premiumDriverStatus?: {
        completedCriteria?: number | string[];
        completionPercentage?: number;
        premiumDriver?: boolean;
        updatedAt?: string;
    };
    totalEarnings?: number;
    confirmedTrips?: number;
    customerCalls?: number;
    connectionCount?: number;
    profileVisits?: number;
    languages?: string[];
    tripTypes?: string[];
    isAvailableForCustomerDuty?: boolean;
    customerDutyCity?: string;
    leads?: { available?: number; exchange?: number; duties?: number };
    routes?: string[];
    verifiedVehicles?: unknown[];
    createdAt?: string;
    [key: string]: unknown;
}

export interface AssistantRequest {
    sessionId: string;
    message: string;
    text?: string;
    driverProfile?: DriverProfile;
    currentLocation?: Location;
    userData?: UserData | null;
    audio?: boolean;
    interactionCount?: number;
    isHome?: boolean;
    requestCount?: number;
    chipClick?: string;
    phoneNo?: string;
}

// --- Response types ---

export interface AssistantResponse {
    session_id: string;
    success: boolean;
    intent: IntentType;
    ui_action: UIActionType;
    response_text: string;
    query?: Record<string, unknown> | null;
    counts?: Record<string, number> | null;
    data: Record<string, unknown> | null;
    audio_cached?: boolean;
    cache_key?: string;
    audio_url?: string | null;
}

// --- Agent types ---

export interface AgentResponse {
    response: string;
    action: {
        type: UIActionType;
        data: Record<string, unknown>;
    };
}

export interface MatchedAction {
    actionType: UIActionType;
    dataSchema: Record<string, unknown>;
}

export type KBEntry =
    | { type: "info"; desc: string }
    | { type: "feature"; desc: string; featureName: string; tools: string[] };

export interface FeatureDetail {
    featureName: string;
    desc: string;
    prompt: string;
    tools: string[];
    actionType: UIActionType;
    dataSchema: Record<string, unknown>;
}

export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export type ToolFn = (
    args: Record<string, string>,
    session: Session,
) => Promise<ToolResult>;

export interface ToolResult {
    msg: string;
    addTools?: string[];
    featureName?: string;
}

export interface UserData {
    name?: string;
    phoneNo?: string;
    date?: string;
    [key: string]: string | undefined;
}

export interface Session {
    id: string;
    history: ChatMessage[];
    activeTools: string[];
    matchedAction: MatchedAction | null;
    activeFeature: string | null;
    userData: UserData | null;
    driverProfile: DriverProfile | null;
    currentLocation: Location | null;
    createdAt: number;
    updatedAt: number;
}

export interface ChatMessage {
    role: "user" | "model" | "function";
    parts: Part[];
}

export type Part =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, string> } }
    | { functionResponse: { name: string; response: { content: string } } };

export interface APIResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}

// --- Intent mapping ---

export const ACTION_TO_INTENT: Record<UIActionType, IntentType> = {
    entry: "entry",
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
    show_fraud_result: "fraud_check_found",
    show_advance: "advance",
    show_border_tax: "border_tax",
    show_state_tax: "state_tax",
    show_puc: "puc",
    show_aitp: "aitp",
    show_end: "end",
    show_map: "generic",
    show_otp_input: "generic",
    show_verification_result: "generic",
    show_ev_charging: "ev_charging",
    none: "generic",
};
