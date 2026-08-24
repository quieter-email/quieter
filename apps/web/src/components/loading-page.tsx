import { LoadingSpinner } from "#/components/loading-spinner";

export const LoadingPage = () => (
  <output
    aria-label="Loading"
    aria-live="polite"
    className="grid min-h-dvh place-items-center"
  >
    <LoadingSpinner />
    <span className="sr-only">Loading</span>
  </output>
);
