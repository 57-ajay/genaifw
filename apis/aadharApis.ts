export interface GetAadharOtpApiResponse {
    success: boolean,
    data: any
}

export const getAadharOtpApi = async (aadharNumber: string): Promise<GetAadharOtpApiResponse> => {
    if (!aadharNumber) {
        return {
            success: false,
            data: null
        };
    }

    return {
        success: true,
        data: "Otp sent successfully",
    }
}

export const verifyAadharOtpApi = async (otp: string): Promise<GetAadharOtpApiResponse> => {
    if (!otp) {
        return {
            success: false,
            data: null
        };
    }

    return {
        success: true,
        data: "Otp verified successfully",
    }
}
