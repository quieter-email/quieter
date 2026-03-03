import { ColorModeProvider } from "@quietr/ui";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { ErrorBoundary as SolidErrorBoundary, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { ErrorBoundary } from "~/components/error-boundary";
import "~/styles.css";

const QUERY_GC_TIME_MS = 1000 * 60 * 30;
const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const createQueryClient = () => {
  const persister = experimental_createQueryPersister({
    storage: isServer ? undefined : localStorage,
    refetchOnRestore: "always",
    maxAge: QUERY_PERSIST_MAX_AGE_MS,
  });

  return new QueryClient({
    defaultOptions: {
      queries: {
        persister: persister.persisterFn,
        gcTime: QUERY_GC_TIME_MS,
      },
    },
  });
};

let browserQueryClient: QueryClient | undefined;

const getQueryClient = () => {
  if (isServer) {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
};

function RootLayout(props: Readonly<{ children?: JSX.Element }>) {
  const queryClient = getQueryClient();

  return (
    <ColorModeProvider initialColorMode="system">
      <QueryClientProvider client={queryClient}>
        {props.children}
        <footer class="fixed right-2 bottom-2 text-[10px] text-muted-foreground">
          <a
            href="https://logo.dev"
            title="Logo API"
            target="_blank"
            rel="noopener"
            class="hover:text-foreground"
          >
            Logos provided by Logo.dev
          </a>
        </footer>
      </QueryClientProvider>
    </ColorModeProvider>
  );
}

export default function App() {
  return (
    <Router
      root={(props) => (
        <SolidErrorBoundary
          fallback={(error, reset) => <ErrorBoundary error={error} reset={reset} />}
        >
          <RootLayout>{props.children}</RootLayout>
        </SolidErrorBoundary>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
