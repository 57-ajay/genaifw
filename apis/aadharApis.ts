export interface AadharApiResponse {
    success: boolean;
    data: any;
}

export const getAadharOtpApi = async (aadharNumber: string): Promise<AadharApiResponse> => {
    if (!aadharNumber || aadharNumber.length !== 12) {
        return { success: false, data: "Invalid Aadhaar number. Must be 12 digits." };
    }
    await new Promise(r => setTimeout(r, 300));
    return { success: true, data: "OTP sent successfully to registered mobile number." };
};

export const verifyAadharOtpApi = async (otp: string): Promise<AadharApiResponse> => {
    if (!otp || otp.length !== 6) {
        return { success: false, data: "Invalid OTP. Must be 6 digits." };
    }
    await new Promise(r => setTimeout(r, 300));
    return { success: true, data: "Aadhaar verified successfully." };
};
