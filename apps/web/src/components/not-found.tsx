import type { Component, JSX } from "solid-js";
import { A } from "@solidjs/router";

type NotFoundProps = {
  children?: JSX.Element;
};

export const NotFound: Component<NotFoundProps> = (props) => (
  <div class="flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-4">
    <div class="text-center text-muted-foreground">
      {props.children || <p>The page you are looking for does not exist.</p>}
    </div>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <button
        onClick={() => window.history.back()}
        class="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-primary bg-primary px-4 text-sm font-medium text-primary-foreground uppercase shadow-sm transition-colors select-none hover:bg-primary/95"
      >
        Go back
      </button>
      <A
        href="/"
        class="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-primary bg-primary px-4 text-sm font-medium text-primary-foreground uppercase shadow-sm transition-colors select-none hover:bg-primary/95"
      >
        Start Over
      </A>
    </div>
  </div>
);
