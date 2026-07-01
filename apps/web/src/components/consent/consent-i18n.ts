import { defaultTranslationConfig } from "@c15t/react";

export const consentEnglishI18n = {
  detectBrowserLanguage: false,
  locale: "en",
  messages: {
    en: {
      ...defaultTranslationConfig.translations.en,
      cookieBanner: {
        title: "We value your privacy",
        description:
          "Quieter uses essential cookies to run the app. With your permission, we also use measurement tools to understand usage and performance.",
      },
      consentManagerDialog: {
        title: "Privacy Settings",
        description: "Choose which optional cookies and measurement tools Quieter may use.",
      },
      consentTypes: {
        ...defaultTranslationConfig.translations.en.consentTypes,
        measurement: {
          title: "Measurement",
          description:
            "Allow product analytics and performance measurement so we can understand usage and reliability.",
        },
      },
    },
  },
} as const;

export const consentLegalLinks = {
  cookiePolicy: { href: "/cookies", target: "_self" as const },
  privacyPolicy: { href: "/privacy", target: "_self" as const },
  termsOfService: { href: "/terms", target: "_self" as const },
};
