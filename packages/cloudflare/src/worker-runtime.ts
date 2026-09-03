import { configureErrorReporter } from "@quieter/observability";
import { z } from "zod";

export { reportError as reportWorkerError } from "@quieter/observability";

const runtimeReportError = globalThis as typeof globalThis & {
  reportError?: (error: unknown) => void;
};

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- Configures the synchronous reporter hook.
configureErrorReporter((error) => {
  runtimeReportError.reportError?.(error);
});

export const readLinkedSecret = (value: string) =>
  z.object({ value: z.string().min(1) }).parse(JSON.parse(value)).value;
