import { registerIntent } from "./registry";
import aadharIntent from "./aadharIntent";
import generalIntent from "./generalIntent";

export const bootstrapIntents = () => {
    registerIntent(generalIntent);
    registerIntent(aadharIntent);
};
