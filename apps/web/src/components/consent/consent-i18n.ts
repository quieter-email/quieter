import { defaultTranslationConfig } from "@c15t/react";

export const consentEnglishI18n = {
  detectBrowserLanguage: false,
  locale: "en",
  messages: {
    en: {
      ...defaultTranslationConfig.translations.en,
      consentManagerDialog: {
        description:
          "Choose which optional cookies and measurement tools Quieter may use.",
        title: "Privacy Settings",
      },
      consentTypes: {
        ...defaultTranslationConfig.translations.en.consentTypes,
        measurement: {
          description:
            "Allow product analytics and performance measurement so we can understand usage and reliability.",
          title: "Measurement",
        },
      },
      cookieBanner: {
        description:
          "Quieter uses essential cookies to run the app. With your permission, we also use measurement tools to understand usage and performance.",
        title: "We value your privacy",
      },
    },
  },
} as const;

export const consentLegalLinks = {
  cookiePolicy: { href: "/cookies", target: "_self" as const },
  privacyPolicy: { href: "/privacy", target: "_self" as const },
  termsOfService: { href: "/terms", target: "_self" as const },
};
