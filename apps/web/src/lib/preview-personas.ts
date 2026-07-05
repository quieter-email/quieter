"use client";

import { useSyncExternalStore } from "react";
import { clientEnv } from "~/env";
import {
  isPreviewPersona,
  previewPersonaCookieMaxAgeMs,
  previewPersonaCookieName,
  previewPersonas,
  type PreviewPersona,
} from "./preview-personas.shared";

export { isPreviewPersona, previewPersonaCookieName, previewPersonas, type PreviewPersona };

const PREVIEW_PERSONA_STORAGE_KEY = "quieter:preview-persona";
const PREVIEW_PERSONA_CHANGE_EVENT = "quieter:preview-persona-change";

type StoredPreviewPersona = {
  expiresAt: number;
  persona: PreviewPersona;
};

export const isPreviewPersonasAvailable = () =>
  import.meta.env.DEV || clientEnv.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED === "true";

const readPreviewPersona = () => {
  if (!isPreviewPersonasAvailable() || typeof window === "undefined") return null;

  const value = window.localStorage.getItem(PREVIEW_PERSONA_STORAGE_KEY);
  if (!value) return null;

  try {
    const stored = JSON.parse(value) as Partial<StoredPreviewPersona>;
    if (isPreviewPersona(stored.persona) && typeof stored.expiresAt === "number") {
      if (stored.expiresAt > Date.now()) return stored.persona;
    }
  } catch {
    if (isPreviewPersona(value)) {
      window.localStorage.removeItem(PREVIEW_PERSONA_STORAGE_KEY);
      return null;
    }
  }

  window.localStorage.removeItem(PREVIEW_PERSONA_STORAGE_KEY);
  return null;
};

const subscribeToPreviewPersona = (callback: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PREVIEW_PERSONA_STORAGE_KEY) callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PREVIEW_PERSONA_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PREVIEW_PERSONA_CHANGE_EVENT, callback);
  };
};

export const setPreviewPersona = (persona: PreviewPersona | null) => {
  if (!isPreviewPersonasAvailable()) return;

  if (persona) {
    window.localStorage.setItem(
      PREVIEW_PERSONA_STORAGE_KEY,
      JSON.stringify({ expiresAt: Date.now() + previewPersonaCookieMaxAgeMs, persona }),
    );
  } else {
    window.localStorage.removeItem(PREVIEW_PERSONA_STORAGE_KEY);
  }

  window.dispatchEvent(new Event(PREVIEW_PERSONA_CHANGE_EVENT));
};

export const clearPreviewPersonaCookie = async () => {
  if (!isPreviewPersonasAvailable()) return;

  const response = await fetch("/api/preview-persona", {
    credentials: "same-origin",
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    throw new Error("Could not clear preview persona.");
  }

  setPreviewPersona(null);
};

export const usePreviewPersona = () =>
  useSyncExternalStore(subscribeToPreviewPersona, readPreviewPersona, () => null);
