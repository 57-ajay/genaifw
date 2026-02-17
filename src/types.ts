export type UIActionType = string;
export type IntentType = string;

// Action <-> Intent Mapping

export interface ActionMapping {
    uiAction: string;
    intent: string;
    audioKey?: string; // optional override key for audio URL lookup
}

//  Tool Configuration

export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface HttpToolImpl {
    type: "http";
    url: string;                              // supports {{param}} and {{ENV.VAR}}
    method: "GET" | "POST";
    headers?: Record<string, string>;         // supports {{ENV.VAR}}
    bodyTemplate?: Record<string, unknown>;   // supports {{param}} placeholders
    responseMapping?: string;                 // dot-path to extract (e.g. "data.results")
    responseTemplate?: string;                // template for message back to AI
    timeout?: number;                         // ms, default 10000
}

export interface StaticToolImpl {
    type: "static";
    response: string;
}

export interface BuiltinToolImpl {
    type: "builtin";
    handler: string; // name of registered handler function
}

export type ToolImplementation = HttpToolImpl | StaticToolImpl | BuiltinToolImpl;

export interface ToolConfig {
    name: string;
    declaration: {
        description: string;
        parameters: Record<string, unknown>;
    };
    implementation: ToolImplementation;
}

// Feature Detail

export interface FeatureDetail {
    featureName: string;
    desc: string;
    prompt: string;

    actions: ActionMapping[];
    defaultAction: string;

    audioMappings?: Record<string, string | null>;

    tools: ToolConfig[];

    dataSchema: Record<string, unknown>;

    // Optional post-processor hook name (e.g. "duties", "fraud")
    postProcessor?: string;
}

// Knowledge Base

export type KBEntry =
    | { type: "info"; desc: string }
    | { type: "feature"; desc: string; featureName: string; tools: string[] };

// Matched Action (for respondToUser constraint)

export interface MatchedAction {
    actions: string[];                   // all possible UI actions for matched feature
    dataSchema: Record<string, unknown>;
}

//Request types
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

export interface UserData {
    name?: string;
    phoneNo?: string;
    date?: string;
    [key: string]: string | undefined;
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

// Response types

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

//  Agent types

export interface AgentResponse {
    audioText: string;
    audioName: string;
    screenName: string;
    uiAction: string;
    predefindData: Record<string, unknown> | null;
}

export type ToolFn = (
    args: Record<string, string>,
    session: Session,
) => Promise<ToolResult>;

export interface ToolResult {
    msg: string;
    addTools?: string[];
    featureName?: string;
    screenName?: string;
    audioName?: string;
    uiAction?: string;
    predefindData?: Record<string, unknown> | null;
}

//  Session

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

//  API

export interface APIResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}
