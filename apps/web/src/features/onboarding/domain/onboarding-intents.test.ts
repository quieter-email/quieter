import { describe, expect, it } from "vite-plus/test";

import {
  isOnboardingIntentId,
  loadStoredOnboardingIntents,
  ONBOARDING_INTENT_OPTIONS,
  storeOnboardingIntents,
} from "./onboarding-intents";

const createStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe(storeOnboardingIntents, () => {
  it("stores selections under the user email and reads them back", () => {
    const storage = createStorage();
    const intents = ["api", "gmail"] as const;

    storeOnboardingIntents(storage, "ada@example.com", [...intents]);

    expect(
      loadStoredOnboardingIntents(storage, "ada@example.com")
    ).toStrictEqual(["api", "gmail"]);
  });

  it("keys storage per user", () => {
    const storage = createStorage();

    storeOnboardingIntents(storage, "ada@example.com", ["gmail"]);

    expect(
      loadStoredOnboardingIntents(storage, "grace@example.com")
    ).toStrictEqual([]);
  });
});

describe(loadStoredOnboardingIntents, () => {
  it("returns no intents when nothing was stored", () => {
    expect(
      loadStoredOnboardingIntents(createStorage(), "a@b.com")
    ).toStrictEqual([]);
  });

  it("drops values that are no longer valid intents", () => {
    const storage = createStorage();
    storage.setItem(
      "quieter-onboarding-intents:a@b.com",
      JSON.stringify(["gmail", "legacy-path", 42])
    );

    expect(loadStoredOnboardingIntents(storage, "a@b.com")).toStrictEqual([
      "gmail",
    ]);
  });

  it("returns no intents for malformed payloads instead of throwing", () => {
    const storage = createStorage();
    storage.setItem("quieter-onboarding-intents:a@b.com", "{not json");

    expect(loadStoredOnboardingIntents(storage, "a@b.com")).toStrictEqual([]);
  });

  it("preserves every option order-independent", () => {
    const storage = createStorage();
    storeOnboardingIntents(
      storage,
      "a@b.com",
      ONBOARDING_INTENT_OPTIONS.map((option) => option.id).toReversed()
    );

    expect(loadStoredOnboardingIntents(storage, "a@b.com")).toStrictEqual([
      "custom",
      "api",
      "gmail",
    ]);
  });
});

describe(isOnboardingIntentId, () => {
  it("accepts exactly the defined option ids", () => {
    for (const option of ONBOARDING_INTENT_OPTIONS) {
      expect(isOnboardingIntentId(option.id)).toBeTruthy();
    }

    expect(isOnboardingIntentId("unknown")).toBeFalsy();
  });
});
