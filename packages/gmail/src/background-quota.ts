import { AsyncLocalStorage } from "node:async_hooks";

type GmailQuotaMeter = {
  reserve: (units: number, purpose: "work" | "watch") => Promise<void>;
  observeProjectLimit: (retryAfterMs: number) => Promise<void>;
};

export class GmailBackgroundQuotaDeferredError extends Error {
  readonly retryAt: number;

  constructor(retryAt: number) {
    super("Gmail background work is waiting for project quota.");
    this.name = "GmailBackgroundQuotaDeferredError";
    this.retryAt = retryAt;
  }
}

const quotaMeters = new AsyncLocalStorage<GmailQuotaMeter>();

export const withGmailBackgroundQuota = async <T>(
  meter: GmailQuotaMeter,
  run: () => Promise<T>
) => await quotaMeters.run(meter, run);

export const gmailBackgroundQuotaMeter = () => quotaMeters.getStore();

// Charge for the most expensive documented format when the request defaults
// or OAuth project migration make the actual cost ambiguous.
export const gmailRequestQuotaUnits = (url: URL, method: string): number => {
  const [resource, id, operation] = url.pathname.split("/").slice(5);
  const format = url.searchParams.get("format");
  switch (resource) {
    case "history": {
      return 2;
    }
    case "profile": {
      return 1;
    }
    case "watch": {
      return 100;
    }
    case "stop": {
      return 50;
    }
    case "labels": {
      return method === "GET" ? 1 : 5;
    }
    case "messages": {
      if (operation === "attachments" || operation === "trash") {
        return 20;
      }
      if (operation === "modify" || operation === "untrash") {
        return 5;
      }
      if (id === "send") {
        return 100;
      }
      if (id === "batchModify" || id === "batchDelete") {
        return 50;
      }
      if (id === "import" || id === "insert") {
        return 25;
      }
      if (method === "DELETE") {
        return 10;
      }
      if (id === undefined) {
        return 5;
      }
      return format === "minimal" || format === "metadata" ? 20 : 60;
    }
    case "threads": {
      if (
        id === undefined ||
        operation === "modify" ||
        operation === "untrash"
      ) {
        return 10;
      }
      if (method === "DELETE" || operation === "trash") {
        return 20;
      }
      return format === "minimal" || format === "metadata" ? 40 : 120;
    }
    case "drafts": {
      if (id === "send") {
        return 100;
      }
      if (method === "GET") {
        if (id === undefined) {
          return 5;
        }
        return format === "minimal" || format === "metadata" ? 20 : 60;
      }
      return method === "PUT" ? 15 : 10;
    }
    default: {
      return 100;
    }
  }
};
