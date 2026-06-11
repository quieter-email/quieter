export {};

declare global {
  interface Window {
    posthog?: {
      capture?: (event: string, properties?: Record<string, unknown>) => void;
      identify?: (userId: string, properties?: Record<string, unknown>) => void;
      init?: (token: string, options: Record<string, unknown>) => void;
      opt_in_capturing?: () => void;
      opt_out_capturing?: () => void;
      reset?: () => void;
      [key: string]: unknown;
    };
  }
}
