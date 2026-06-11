import { termsAcceptanceCookieName } from "@quieter/auth/terms-acceptance";

const termsAcceptanceMaxAgeSeconds = 10 * 60;

export const setTermsAcceptanceCookie = () => {
  const value = encodeURIComponent(new Date().toISOString());
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie = `${termsAcceptanceCookieName}=${value}; Path=/; Max-Age=${termsAcceptanceMaxAgeSeconds}; SameSite=Lax${secure}`;
};
