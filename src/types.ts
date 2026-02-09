export type UIActionType =
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
    | "show_advance"
    | "show_end"
    | "show_map"
    | "show_otp_input"
    | "show_verification_result"
    | "none";

export const ALL_UI_ACTIONS: UIActionType[] = [
    "show_duties_list", "show_cng_stations", "show_petrol_stations",
    "show_parking", "show_nearby_drivers", "show_towing",
    "show_toilets", "show_taxi_stands", "show_auto_parts",
    "show_car_repair", "show_hospital", "show_police_station",
    "show_fraud", "show_info", "show_advance", "show_end",
    "show_map", "show_otp_input", "show_verification_result", "none",
];


export interface AgentResponse {
    response: string;
    action: {
        type: UIActionType;
        data: Record<string, any>;
    };
}


export interface MatchedAction {
    actionType: UIActionType;
    dataSchema: Record<string, any>;
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
    dataSchema: Record<string, any>;
}


export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export type ToolFn = (
    args: Record<string, string>,
    session: Session,
) => Promise<ToolResult>;

export interface ToolResult {
    msg: string;
    addTools?: string[];
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
    userData: UserData | null;
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
