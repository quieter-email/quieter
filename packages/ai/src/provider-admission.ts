import { AsyncLocalStorage } from "node:async_hooks";

type AiProviderAdmission = {
  reserve: () => Promise<void>;
  observeRateLimit: (retryAfterMs: number) => Promise<void>;
};

export class AiProviderDeferredError extends Error {
  readonly retryAt: number;

  constructor(retryAt: number) {
    super("Background AI is waiting for provider capacity.");
    this.name = "AiProviderDeferredError";
    this.retryAt = retryAt;
  }
}

const providerAdmissions = new AsyncLocalStorage<AiProviderAdmission>();

export const withAiProviderAdmission = async <T>(
  admission: AiProviderAdmission,
  run: () => Promise<T>
) => await providerAdmissions.run(admission, run);

export const aiProviderAdmission = () => providerAdmissions.getStore();
