// Client -> Server
export type ClientEventType = "message" | "screenChange" | "submit" | "init";

export interface ClientEvent {
    sessionId: string;
    type: ClientEventType;
    text?: string;
    screen?: string; // current screen (for "screenChange" / "submit")
    data?: Record<string, unknown>; // form data, screen state, init options
    context?: ClientContext; // session context (sent on init or when changed)
}

export interface ClientContext {
    driverProfile?: DriverProfile;
    location?: Location;
    userData?: UserData;
}

// Server -> Client

export type ServerAction =
    | { type: "speak"; text: string }
    | { type: "playAudio"; key: string }
    | { type: "navigate"; screen: string; data?: Record<string, unknown> }
    | { type: "uiAction"; action: string; data?: Record<string, unknown> }
    | { type: "endConversation" };

export interface ServerMessage {
    sessionId: string;
    actions: ServerAction[];
    metadata?: {
        intent?: string;
        feature?: string;
    };
}

// WebSocket Wire Messages

export type WSClientMessage = ClientEvent;

export type WSServerMessage =
    | { type: "actions"; message: ServerMessage }
    | { type: "audio_start"; contentType: string; size: number }
    | { type: "audio_end" }
    | { type: "error"; error: string };

//  Domain Types
export interface Location {
    latitude: number;
    longitude: number;
}

export interface UserData {
    name?: string;
    phoneNo?: string;
    date?: string;
    [key: string]: string | undefined;
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

//  Session
export interface Session {
    id: string;
    history: ChatMessage[];
    activeTools: string[];
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

//  Knowledge Base
export type KBEntry =
    | { type: "info"; desc: string }
    | { type: "feature"; desc: string; featureName: string; tools: string[] };

//  Tool System
export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface HttpToolImpl {
    type: "http";
    url: string;
    method: "GET" | "POST";
    headers?: Record<string, string>;
    bodyTemplate?: Record<string, unknown>;
    responseMapping?: string;
    responseTemplate?: string;
    timeout?: number;
}

export interface StaticToolImpl {
    type: "static";
    response: string;
}

export interface BuiltinToolImpl {
    type: "builtin";
    handler: string;
}

export type ToolImplementation =
    | HttpToolImpl
    | StaticToolImpl
    | BuiltinToolImpl;

export interface ToolConfig {
    name: string;
    declaration: {
        description: string;
        parameters: Record<string, unknown>;
    };
    implementation: ToolImplementation;
}

// Tool Execution

export type ToolFn = (
    args: Record<string, unknown>,
    session: Session,
) => Promise<ToolResult>;

export interface ToolResult {
    msg: string;
    addTools?: string[];
    featureName?: string;
    actions?: ServerAction[];
}

//  Feature Configuration

export interface ActionMapping {
    uiAction: string;
    intent: string;
    audioKey?: string;
}

export interface FeatureDetail {
    featureName: string;
    desc: string;
    prompt: string;
    actions: ActionMapping[];
    defaultAction: string;
    audioMappings?: Record<string, string | null>;
    tools: ToolConfig[];
    dataSchema: Record<string, unknown>;
    postProcessor?: string;
}

//  API (admin endpoints)
export interface APIResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}
