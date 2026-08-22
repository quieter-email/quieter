export const ONBOARDING_INTENT_OPTIONS = [
  {
    description: "Connect Gmail accounts to read, search, and send from them.",
    id: "gmail",
    title: "Bring my Gmail inboxes into Quieter",
  },
  {
    description: "Send transactional mail from a verified domain.",
    id: "api",
    title: "Send mail through the API or MCP",
  },
  {
    description: "Shared addresses like support@yourdomain.com.",
    id: "custom",
    title: "Create custom inboxes on my domain",
  },
] as const;

export type OnboardingIntentId =
  (typeof ONBOARDING_INTENT_OPTIONS)[number]["id"];

export const isOnboardingIntentId = (
  value: string
): value is OnboardingIntentId =>
  ONBOARDING_INTENT_OPTIONS.some((option) => option.id === value);

const storageKeyFor = (email: string) => `quieter-onboarding-intents:${email}`;

export const loadStoredOnboardingIntents = (
  storage: Pick<Storage, "getItem">,
  email: string
): OnboardingIntentId[] => {
  const raw = storage.getItem(storageKeyFor(email));
  if (raw === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is OnboardingIntentId =>
            typeof value === "string" && isOnboardingIntentId(value)
        )
      : [];
  } catch {
    return [];
  }
};

export const storeOnboardingIntents = (
  storage: Pick<Storage, "setItem">,
  email: string,
  intents: OnboardingIntentId[]
) => {
  storage.setItem(storageKeyFor(email), JSON.stringify(intents));
};
