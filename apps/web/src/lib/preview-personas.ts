"use client";

import { useSyncExternalStore } from "react";
import { clientEnv } from "~/env";

export const previewPersonaCookieName = "quieter_preview_persona";
export const previewPersonas = ["gmail", "managed", "empty"] as const;

export type PreviewPersona = (typeof previewPersonas)[number];

const PREVIEW_PERSONA_STORAGE_KEY = "quieter:preview-persona";
const PREVIEW_PERSONA_CHANGE_EVENT = "quieter:preview-persona-change";

export const isPreviewPersona = (value: unknown): value is PreviewPersona =>
  typeof value === "string" && previewPersonas.includes(value as PreviewPersona);

export const isPreviewPersonasAvailable = () =>
  import.meta.env.DEV || clientEnv.VITE_QUIETER_PREVIEW_PERSONAS_ENABLED === "true";

const readPreviewPersona = () => {
  if (!isPreviewPersonasAvailable() || typeof window === "undefined") return null;

  const value = window.localStorage.getItem(PREVIEW_PERSONA_STORAGE_KEY);
  return isPreviewPersona(value) ? value : null;
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
    window.localStorage.setItem(PREVIEW_PERSONA_STORAGE_KEY, persona);
  } else {
    window.localStorage.removeItem(PREVIEW_PERSONA_STORAGE_KEY);
  }

  window.dispatchEvent(new Event(PREVIEW_PERSONA_CHANGE_EVENT));
};

export const usePreviewPersona = () =>
  useSyncExternalStore(subscribeToPreviewPersona, readPreviewPersona, () => null);
