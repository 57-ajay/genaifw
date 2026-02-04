import { Type } from "@google/genai";

export const getAadharOtpTool = {
    name: "getAadharOtpTool",
    description: "This tool sends otp to user's registered Mobile number with Aadhar",
    parameters: {
        type: Type.STRING,
        properties: {
            aadharNumber: {
                type: Type.STRING, description: "User's aadhar number for verification",
            },
        },
        required: ["aadharNumber"],
    },
};


export const verifyAadharOtpTool = {
    name: "verifyAadharOtp",
    description: "This tool verifies otp sent to user's Mobile number for aadhar verification",
    parameters: {
        type: Type.STRING,
        properties: {
            otp: {
                type: Type.STRING, description: "User's aadhar number for verification",
            },
        },
        required: ["otp"],
    },
};
