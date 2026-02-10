import { GoogleGenAI } from "@google/genai";

export const PROJECT_ID = process.env.GCP_PROJECT ?? "cabswale-ai";
export const LOCATION = process.env.GCP_LOCATION ?? "us-central1";
export const MODEL = process.env.MODEL ?? "gemini-2.5-flash";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-multilingual-embedding-002";

export const TYPESENSE_HOST = process.env.TYPESENSE_HOST ?? "localhost";
export const TYPESENSE_PORT = parseInt(process.env.TYPESENSE_PORT ?? "8108", 10);
export const TYPESENSE_PROTOCOL = process.env.TYPESENSE_PROTOCOL ?? "http";
export const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY ?? "";
export const TRIPS_COLLECTION = process.env.TRIPS_COLLECTION ?? "trips";
export const LEADS_COLLECTION = process.env.LEADS_COLLECTION ?? "bwi-cabswalle-leads";

export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
export const ANALYTICS_URL = process.env.ANALYTICS_URL ?? "https://bigquerysync-event-t5xpmeezuq-uc.a.run.app/partnerRaahi";

export const ai = new GoogleGenAI({
    project: PROJECT_ID,
    location: LOCATION,
    vertexai: true,
});
