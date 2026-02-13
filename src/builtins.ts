import { registerBuiltin } from "./executor";

/**
 * Register all builtin tool handlers.
 * Call this once on startup, before any tool execution.
 *
 * Add new builtin handlers here when a tool needs complex logic
 * that can't be expressed as HTTP config or static response.
 */
export function registerBuiltins(): void {
    registerBuiltin("verifyAadharOtp", async (args) => {
        const otp = args["otp"] ?? "";
        const ok = otp === "6969";
        console.log(`  → OTP verify: ${otp} → ${ok ? "✓" : "✗"}`);
        return {
            msg: ok
                ? "Aadhaar verified successfully. User identity confirmed."
                : "Incorrect OTP. Verification failed.",
        };
    });

    registerBuiltin("searchCabs", async (args) => {
        console.log(`  → Searching cabs: ${args["pickup"]} → ${args["destination"]}`);
        return {
            msg: JSON.stringify({
                results: [
                    { driver: "Raju", car: "Swift Dzire", price: 2500, rating: 4.5 },
                    { driver: "Amit", car: "Innova", price: 4200, rating: 4.8 },
                ],
            }),
        };
    });

    console.log("✓ Builtin handlers registered");
}
