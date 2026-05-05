import { StrictMode, useEffect, useMemo, useState } from "react";
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
import { pluginManager } from "./lib/plugins/manager";
import { router } from "./router";
import { useAppearanceStore } from "./store/appearance";
import { makeMantineColorScale, resolveMd3Palette } from "./theme/md3";

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
 * bug. Every mutation/query that throws gets a red toast at minimum.
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
 * Rehydrate previously-installed plugins from the DB at app start.
 * Fire-and-forget; failures get logged but don't block boot.
 */
void pluginManager.loadInstalledFromDb().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.warn("[bootstrap] failed to rehydrate installed plugins", error);
});

/**
 * Async errors that escape React Query entirely get logged for
 * devtools but are not toasted; plugin-side scrape failures during
 * global search would otherwise spam the user with one toast per
 * plugin.
 */
window.addEventListener("unhandledrejection", (event) => {
  // eslint-disable-next-line no-console
  console.warn("[unhandledrejection]", event.reason);
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in index.html");
}

function useResolvedColorScheme(): "light" | "dark" {
  const themeMode = useAppearanceStore((state) => state.themeMode);
  const [prefersDark, setPrefersDark] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    if (themeMode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => {
      setPrefersDark(event.matches);
    };
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [themeMode]);

  if (themeMode === "light" || themeMode === "dark") {
    return themeMode;
  }
  return prefersDark ? "dark" : "light";
}

function AppProviders() {
  const appThemeId = useAppearanceStore((state) => state.appThemeId);
  const amoledBlack = useAppearanceStore((state) => state.amoledBlack);
  const customAccentColor = useAppearanceStore(
    (state) => state.customAccentColor,
  );
  const colorScheme = useResolvedColorScheme();
  const palette = useMemo(
    () =>
      resolveMd3Palette(appThemeId, colorScheme, {
        amoledBlack,
        customAccentColor,
      }),
    [amoledBlack, appThemeId, colorScheme, customAccentColor],
  );
  const theme = useMemo(
    () =>
      createTheme({
        fontFamily: "system-ui, -apple-system, sans-serif",
        primaryColor: "lnreader",
        colors: {
          lnreader: makeMantineColorScale(palette),
        },
        defaultRadius: "sm",
      }),
    [palette],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--lnr-background", palette.background);
    root.style.setProperty("--lnr-on-background", palette.onBackground);
    root.style.setProperty("--lnr-surface", palette.surface);
    root.style.setProperty("--lnr-on-surface", palette.onSurface);
    root.style.setProperty("--lnr-surface-variant", palette.surfaceVariant);
    root.style.setProperty(
      "--lnr-on-surface-variant",
      palette.onSurfaceVariant,
    );
    root.style.setProperty("--lnr-outline", palette.outlineVariant);
    root.style.setProperty("--lnr-primary", palette.primary);
    root.style.setProperty("--lnr-on-primary", palette.onPrimary);
    document.body.style.background = palette.background;
    document.body.style.color = palette.onBackground;
  }, [palette]);

  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
      <Notifications position="top-right" />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
