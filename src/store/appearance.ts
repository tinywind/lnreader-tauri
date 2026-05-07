import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeAppLocale, type AppLocale } from "../i18n/locales";
import { APP_THEMES, type AppThemeId } from "../theme/md3";

export type AppThemeMode = "system" | "light" | "dark";

interface AppearanceState {
  themeMode: AppThemeMode;
  appThemeId: AppThemeId;
  amoledBlack: boolean;
  customAccentColor: string;
  appLocale: AppLocale;
  showHistoryTab: boolean;
  showUpdatesTab: boolean;
  showDownloadsTab: boolean;
  showTasksTab: boolean;
  showLabelsInNav: boolean;
  setThemeMode: (themeMode: unknown) => void;
  setAppThemeId: (appThemeId: unknown) => void;
  setAmoledBlack: (amoledBlack: boolean) => void;
  setCustomAccentColor: (customAccentColor: string) => void;
  setAppLocale: (appLocale: string) => void;
  setShowHistoryTab: (showHistoryTab: boolean) => void;
  setShowUpdatesTab: (showUpdatesTab: boolean) => void;
  setShowDownloadsTab: (showDownloadsTab: boolean) => void;
  setShowTasksTab: (showTasksTab: boolean) => void;
  setShowLabelsInNav: (showLabelsInNav: boolean) => void;
  resetAppearance: () => void;
}

export const DEFAULT_APPEARANCE = {
  themeMode: "system" as AppThemeMode,
  appThemeId: "default" as AppThemeId,
  amoledBlack: false,
  customAccentColor: "",
  appLocale: "en" as AppLocale,
  showHistoryTab: true,
  showUpdatesTab: true,
  showDownloadsTab: true,
  showTasksTab: true,
  showLabelsInNav: true,
};

const APP_THEME_IDS = new Set<string>(APP_THEMES.map((theme) => theme.id));

export function normalizeAppThemeMode(themeMode: unknown): AppThemeMode {
  switch (themeMode) {
    case "system":
    case "light":
    case "dark":
      return themeMode;
    default:
      return DEFAULT_APPEARANCE.themeMode;
  }
}

export function normalizeAppThemeId(appThemeId: unknown): AppThemeId {
  return typeof appThemeId === "string" && APP_THEME_IDS.has(appThemeId)
    ? (appThemeId as AppThemeId)
    : DEFAULT_APPEARANCE.appThemeId;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...DEFAULT_APPEARANCE,
      setThemeMode: (themeMode) =>
        set({ themeMode: normalizeAppThemeMode(themeMode) }),
      setAppThemeId: (appThemeId) =>
        set({ appThemeId: normalizeAppThemeId(appThemeId) }),
      setAmoledBlack: (amoledBlack) => set({ amoledBlack }),
      setCustomAccentColor: (customAccentColor) =>
        set({ customAccentColor: customAccentColor.trim() }),
      setAppLocale: (appLocale) =>
        set({ appLocale: normalizeAppLocale(appLocale) }),
      setShowHistoryTab: (showHistoryTab) => set({ showHistoryTab }),
      setShowUpdatesTab: (showUpdatesTab) => set({ showUpdatesTab }),
      setShowDownloadsTab: (showDownloadsTab) => set({ showDownloadsTab }),
      setShowTasksTab: (showTasksTab) => set({ showTasksTab }),
      setShowLabelsInNav: (showLabelsInNav) => set({ showLabelsInNav }),
      resetAppearance: () => set({ ...DEFAULT_APPEARANCE }),
    }),
    {
      name: "app-appearance-settings",
      partialize: (state) => ({
        themeMode: state.themeMode,
        appThemeId: state.appThemeId,
        amoledBlack: state.amoledBlack,
        customAccentColor: state.customAccentColor,
        appLocale: state.appLocale,
        showHistoryTab: state.showHistoryTab,
        showUpdatesTab: state.showUpdatesTab,
        showDownloadsTab: state.showDownloadsTab,
        showTasksTab: state.showTasksTab,
        showLabelsInNav: state.showLabelsInNav,
      }),
      merge: (persistedState, currentState) => {
        if (persistedState === null || typeof persistedState !== "object") {
          return currentState;
        }
        const persisted = persistedState as Partial<AppearanceState>;
        return {
          ...currentState,
          ...persisted,
          themeMode: normalizeAppThemeMode(persisted.themeMode),
          appThemeId: normalizeAppThemeId(persisted.appThemeId),
          appLocale: normalizeAppLocale(persisted.appLocale),
        };
      },
    },
  ),
);
