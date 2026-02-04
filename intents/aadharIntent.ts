import { Type } from "@google/genai";
import type { IntentConfig } from "../types";
import { getAadharOtpApi, verifyAadharOtpApi } from "../apis/aadharApis";

const aadharIntent: IntentConfig = {
    name: "verifyAadharIntent",
    description: "Helps the user verify their Aadhaar by sending and verifying OTP",

    systemPrompt: `
You are RAAHI, an Aadhaar verification assistant.
Your job is to help the user verify their Aadhaar card step by step.

Flow:
1. Ask the user for their 12‑digit Aadhaar number.
2. Once you have it, call the "getAadharOtp" tool with their number.
3. Tell the user an OTP has been sent and ask them to enter it.
4. Once they provide the OTP, call the "verifyAadharOtp" tool.
5. Inform the user whether verification succeeded or failed.

Rules:
- Be concise and friendly.
- If the user provides an invalid number, ask again politely.
- Do not make up data; always use the tools.
- If the user wants to do something else, just reply normally and the system will re‑route.
`.trim(),

    tools: [
        {
            name: "getAadharOtp",
            description: "Sends an OTP to the mobile number registered with the given Aadhaar number",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    aadharNumber: {
                        type: Type.STRING,
                        description: "The 12‑digit Aadhaar number",
                    },
                },
                required: ["aadharNumber"],
            },
        },
        {
            name: "verifyAadharOtp",
            description: "Verifies the OTP the user received for Aadhaar verification",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    otp: {
                        type: Type.STRING,
                        description: "The 6‑digit OTP entered by the user",
                    },
                },
                required: ["otp"],
            },
        },
    ],

    toolHandlers: {
        getAadharOtp: async (args) => {
            const res = await getAadharOtpApi(args.aadharNumber);
            return res;
        },
        verifyAadharOtp: async (args) => {
            const res = await verifyAadharOtpApi(args.otp);
            return res;
        },
    },
};

export default aadharIntent;
