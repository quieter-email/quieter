import { mobileEnv } from "@quieter/env/mobile";

const stripTrailingSlash = (value: string) => value.replace(/\/+$/u, "");

export const apiUrl = stripTrailingSlash(mobileEnv.EXPO_PUBLIC_QUIETER_API_URL);
export const webUrl = stripTrailingSlash(mobileEnv.EXPO_PUBLIC_QUIETER_WEB_URL);
