import type { Component } from "solid-js";
import { A } from "@solidjs/router";

type ErrorBoundaryProps = {
  error: unknown;
  reset: () => void;
};

export const ErrorBoundary: Component<ErrorBoundaryProps> = (props) => {
  console.error(props.error);

  const message = props.error instanceof Error ? props.error.message : String(props.error);

  return (
    <div class="flex min-h-dvh w-full min-w-0 flex-1 flex-col items-center justify-center gap-6 p-4">
      <div class="text-center">
        <h1 class="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p class="mt-2 text-muted-foreground">{message}</p>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => props.reset()}
          class="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-secondary bg-secondary px-4 text-sm font-medium text-secondary-foreground uppercase shadow-sm transition-colors select-none hover:bg-secondary/90"
        >
          Try Again
        </button>
        <button
          onClick={() => window.history.back()}
          class="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-secondary bg-secondary px-4 text-sm font-medium text-secondary-foreground uppercase shadow-sm transition-colors select-none hover:bg-secondary/90"
        >
          Go Back
        </button>
        <A
          href="/"
          class="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-secondary bg-secondary px-4 text-sm font-medium text-secondary-foreground uppercase shadow-sm transition-colors select-none hover:bg-secondary/90"
        >
          Home
        </A>
      </div>
    </div>
  );
};
