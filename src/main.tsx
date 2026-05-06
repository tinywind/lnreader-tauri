import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles/app.css";
import { RouterProvider } from "@tanstack/react-router";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { pluginManager } from "./lib/plugins/manager";
import { isAndroidRuntime, isTauriRuntime } from "./lib/tauri-runtime";
import { router } from "./router";
import { useAppearanceStore } from "./store/appearance";
import { makeMantineColorScale, resolveMd3Palette } from "./theme/md3";
import { translate } from "./i18n";

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
    onError: (error) =>
      showErrorToast(
        translate(useAppearanceStore.getState().appLocale, "common.loadFailed"),
        error,
      ),
  }),
  mutationCache: new MutationCache({
    onError: (error) =>
      showErrorToast(
        translate(
          useAppearanceStore.getState().appLocale,
          "common.actionFailed",
        ),
        error,
      ),
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
if (isTauriRuntime()) {
  void pluginManager.loadInstalledFromDb().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.warn("[bootstrap] failed to rehydrate installed plugins", error);
  });
}

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

const ROOT_FONT_SIZE_PX = 16;
const DEFAULT_VIEWPORT_META =
  "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
const ANDROID_MIN_VIEWPORT_WIDTH = 320;
const ANDROID_MAX_VIEWPORT_WIDTH = 1920;
const MANTINE_XS_MIN_WIDTH = 576;
const MANTINE_SM_MIN_WIDTH = 768;
const MANTINE_MD_MIN_WIDTH = 992;
const MANTINE_LG_MIN_WIDTH = 1200;
const MANTINE_XL_MIN_WIDTH = 1408;

type AndroidLayoutClass = "base" | "xs" | "sm" | "md" | "lg" | "xl";

interface AndroidSafeAreaBridge {
  getInsets(): string;
}

interface AndroidWindowBridge {
  getMetrics(): string;
}

interface RuntimeSafeAreaInsets {
  bottom?: unknown;
  left?: unknown;
  right?: unknown;
  top?: unknown;
}

interface RuntimeWindowMetrics {
  density?: unknown;
  heightDp?: unknown;
  heightPx?: unknown;
  widthDp?: unknown;
  widthPx?: unknown;
}

declare global {
  interface Window {
    __LNReaderAndroidSafeArea?: AndroidSafeAreaBridge;
    __LNReaderAndroidWindow?: AndroidWindowBridge;
    __lnrApplyAndroidSafeAreaInsets?: (insets: RuntimeSafeAreaInsets) => void;
  }
}

interface AndroidLayoutConfig {
  className: AndroidLayoutClass;
  nativePxPerCssPx: number;
  viewportWidth: number;
}

let androidNativePxPerCssPx = 1;

function positiveNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function classifyAndroidLayout(width: number): AndroidLayoutClass {
  if (width >= MANTINE_XL_MIN_WIDTH) return "xl";
  if (width >= MANTINE_LG_MIN_WIDTH) return "lg";
  if (width >= MANTINE_MD_MIN_WIDTH) return "md";
  if (width >= MANTINE_SM_MIN_WIDTH) return "sm";
  if (width >= MANTINE_XS_MIN_WIDTH) return "xs";
  return "base";
}

function readAndroidWindowMetrics(): RuntimeWindowMetrics | null {
  const raw = window.__LNReaderAndroidWindow?.getMetrics();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as RuntimeWindowMetrics)
      : null;
  } catch {
    return null;
  }
}

function resolveFallbackAndroidLayout(): AndroidLayoutConfig {
  const density =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  const fallbackWidth =
    positiveNumber(window.screen?.availWidth) ??
    positiveNumber(window.screen?.width) ??
    window.innerWidth;
  const widthPx = fallbackWidth >= MANTINE_SM_MIN_WIDTH
    ? fallbackWidth
    : fallbackWidth * density;
  const viewportWidth = clamp(
    widthPx / density,
    ANDROID_MIN_VIEWPORT_WIDTH,
    ANDROID_MAX_VIEWPORT_WIDTH,
  );

  return {
    className: classifyAndroidLayout(viewportWidth),
    nativePxPerCssPx: Math.max(1, widthPx / viewportWidth),
    viewportWidth,
  };
}

function resolveAndroidLayout(): AndroidLayoutConfig {
  const metrics = readAndroidWindowMetrics();
  if (!metrics) return resolveFallbackAndroidLayout();

  const widthDp = positiveNumber(metrics.widthDp);
  const widthPx = positiveNumber(metrics.widthPx);
  const density = positiveNumber(metrics.density);
  const rawViewportWidth = widthDp ?? (widthPx && density ? widthPx / density : null);

  if (!rawViewportWidth) return resolveFallbackAndroidLayout();

  const viewportWidth = clamp(
    rawViewportWidth,
    ANDROID_MIN_VIEWPORT_WIDTH,
    ANDROID_MAX_VIEWPORT_WIDTH,
  );
  const nativePxPerCssPx =
    widthPx && widthPx > 0 ? widthPx / viewportWidth : density ?? 1;

  return {
    className: classifyAndroidLayout(viewportWidth),
    nativePxPerCssPx: Math.max(1, nativePxPerCssPx),
    viewportWidth,
  };
}

function viewportMeta(): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
}

function applyAndroidViewportWidth(width: number): void {
  const viewport = viewportMeta();
  if (!viewport) return;
  const content =
    `width=${Math.round(width)}, initial-scale=1.0, maximum-scale=1.0, ` +
    "user-scalable=no, viewport-fit=cover";
  if (viewport.content !== content) {
    viewport.content = content;
  }
}

function resetViewportScale(): void {
  const viewport = viewportMeta();
  if (viewport && viewport.content !== DEFAULT_VIEWPORT_META) {
    viewport.content = DEFAULT_VIEWPORT_META;
  }
}

function safeInsetPx(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  const nativePxPerCssPx = isAndroidRuntime() ? androidNativePxPerCssPx : 1;
  const cssPixels =
    (Number.isFinite(numeric) ? numeric : 0) / nativePxPerCssPx;
  return `${Math.max(0, Math.round(cssPixels))}px`;
}

function applyNativeSafeAreaInsets(insets: RuntimeSafeAreaInsets): void {
  const root = document.documentElement;
  root.style.setProperty("--lnr-native-safe-area-top", safeInsetPx(insets.top));
  root.style.setProperty(
    "--lnr-native-safe-area-right",
    safeInsetPx(insets.right),
  );
  root.style.setProperty(
    "--lnr-native-safe-area-bottom",
    safeInsetPx(insets.bottom),
  );
  root.style.setProperty(
    "--lnr-native-safe-area-left",
    safeInsetPx(insets.left),
  );
}

function readAndroidSafeAreaInsets(): RuntimeSafeAreaInsets | null {
  const raw = window.__LNReaderAndroidSafeArea?.getInsets();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as RuntimeSafeAreaInsets)
      : null;
  } catch {
    return null;
  }
}

function clearNativeSafeAreaInsets(): void {
  const root = document.documentElement;
  root.style.removeProperty("--lnr-native-safe-area-top");
  root.style.removeProperty("--lnr-native-safe-area-right");
  root.style.removeProperty("--lnr-native-safe-area-bottom");
  root.style.removeProperty("--lnr-native-safe-area-left");
}

function applyRuntimeSafeAreaInsets(): void {
  if (!isAndroidRuntime()) {
    clearNativeSafeAreaInsets();
    return;
  }
  const insets = readAndroidSafeAreaInsets();
  if (insets) {
    applyNativeSafeAreaInsets(insets);
  }
}

function applyRuntimeUiScale(): void {
  const root = document.documentElement;
  if (!isAndroidRuntime()) {
    resetViewportScale();
    delete root.dataset.lnrPlatform;
    delete root.dataset.lnrAndroidLayout;
    root.style.removeProperty("--lnr-root-font-size");
    root.style.removeProperty("--lnr-ui-scale");
    root.style.removeProperty("--lnr-mobile-nav-content-height");
    androidNativePxPerCssPx = 1;
    clearNativeSafeAreaInsets();
    return;
  }

  const layout = resolveAndroidLayout();
  androidNativePxPerCssPx = layout.nativePxPerCssPx;
  root.dataset.lnrPlatform = "android";
  root.dataset.lnrAndroidLayout = layout.className;
  applyAndroidViewportWidth(layout.viewportWidth);
  root.style.setProperty("--lnr-root-font-size", `${ROOT_FONT_SIZE_PX}px`);
  root.style.setProperty("--lnr-ui-scale", layout.nativePxPerCssPx.toFixed(2));
  root.style.removeProperty("--lnr-mobile-nav-content-height");
}

window.__lnrApplyAndroidSafeAreaInsets = (insets) => {
  if (isAndroidRuntime()) {
    applyNativeSafeAreaInsets(insets);
  }
};

applyRuntimeUiScale();
applyRuntimeSafeAreaInsets();

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
  const appLocale = useAppearanceStore((state) => state.appLocale);
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
        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        primaryColor: "lnreader",
        colors: {
          lnreader: makeMantineColorScale(palette),
        },
        defaultRadius: "sm",
        components: {
          Alert: {
            defaultProps: {
              radius: "sm",
            },
          },
          Button: {
            defaultProps: {
              radius: "sm",
            },
          },
          Paper: {
            defaultProps: {
              radius: "sm",
            },
          },
          TextInput: {
            defaultProps: {
              radius: "sm",
            },
          },
        },
      }),
    [palette],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.lang = appLocale;
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
  }, [appLocale, palette]);

  useEffect(() => {
    if (!isAndroidRuntime()) return;

    let frame = 0;
    const scheduleRuntimeUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        applyRuntimeUiScale();
        applyRuntimeSafeAreaInsets();
      });
    };

    scheduleRuntimeUpdate();
    window.addEventListener("resize", scheduleRuntimeUpdate);
    window.visualViewport?.addEventListener("resize", scheduleRuntimeUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleRuntimeUpdate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleRuntimeUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleRuntimeUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleRuntimeUpdate);
    };
  }, []);

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
