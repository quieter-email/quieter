export type ErrorContext = Readonly<
  Record<string, boolean | number | string | undefined>
>;

export type ErrorReporter = (error: unknown, context: ErrorContext) => void;

let errorReporter: ErrorReporter | null = null;

export const configureErrorReporter = (reporter: ErrorReporter): void => {
  errorReporter = reporter;
};

export const reportError = (
  error: unknown,
  context: ErrorContext = {}
): void => {
  try {
    errorReporter?.(error, context);
  } catch {
    // oxlint-disable-next-line no-console -- Keep the original failure visible without disabling future reports.
    console.error("Error reporting failed", error, context);
  }
};
