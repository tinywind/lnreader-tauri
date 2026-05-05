import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { router } from "./router";

const theme = createTheme({
  fontFamily: "system-ui, -apple-system, sans-serif",
  primaryColor: "blue",
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showErrorToast(title: string, error: unknown): void {
  notifications.show({
    color: "red",
    title,
    message: describeError(error),
    autoClose: 7_000,
  });
}

/**
 * Global error fallbacks for any mutation or query that doesn't
 * surface its own error UI. Silent-failure is the worst kind of
 * bug — every mutation/query that throws gets a red toast at
 * minimum, even if the originating component never rendered the
 * error. Components are still free to render an inline Alert for
 * stronger contextual feedback.
 */
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => showErrorToast("Load failed", error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => showErrorToast("Action failed", error),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

/**
 * Async errors that escape React Query entirely (e.g. fire-and-
 * forget promises inside sandboxed plugins) get logged for devtools
 * but NOT toasted — plugin-side scrape failures during a global
 * search would otherwise spam the user with one toast per plugin.
 * Per-row error UI in /search and /browse already shows the actual
 * cause where it matters.
 */
window.addEventListener("unhandledrejection", (event) => {
  // eslint-disable-next-line no-console
  console.warn("[unhandledrejection]", event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
