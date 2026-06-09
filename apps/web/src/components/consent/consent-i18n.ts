import { defaultTranslationConfig } from "@c15t/react";

export const consentEnglishI18n = {
  detectBrowserLanguage: false,
  locale: "en",
  messages: defaultTranslationConfig.translations,
} as const;

export const consentLegalLinks = {
  cookiePolicy: { href: "/cookies", target: "_self" as const },
  privacyPolicy: { href: "/privacy", target: "_self" as const },
  termsOfService: { href: "/terms", target: "_self" as const },
};
