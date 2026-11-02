type PosthogClient = {
  capture?: (event: string, properties?: Record<string, unknown>) => void;
};

let ready = false;
const listeners = new Set<() => void>();

export const getPosthogClient = (): PosthogClient | null => {
  if (typeof window === "undefined" || !ready) {
    return null;
  }

  return window.posthog ?? null;
};

export const getPosthogReady = () => ready;

export const markPosthogReady = () => {
  ready = true;
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeToPosthogReady = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
