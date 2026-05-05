import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppThemeId } from "../theme/md3";

export type AppThemeMode = "system" | "light" | "dark";

interface AppearanceState {
  themeMode: AppThemeMode;
  appThemeId: AppThemeId;
  amoledBlack: boolean;
  customAccentColor: string;
  appLocale: string;
  showHistoryTab: boolean;
  showUpdatesTab: boolean;
  showLabelsInNav: boolean;
  setThemeMode: (themeMode: AppThemeMode) => void;
  setAppThemeId: (appThemeId: AppThemeId) => void;
  setAmoledBlack: (amoledBlack: boolean) => void;
  setCustomAccentColor: (customAccentColor: string) => void;
  setAppLocale: (appLocale: string) => void;
  setShowHistoryTab: (showHistoryTab: boolean) => void;
  setShowUpdatesTab: (showUpdatesTab: boolean) => void;
  setShowLabelsInNav: (showLabelsInNav: boolean) => void;
  resetAppearance: () => void;
}

export const DEFAULT_APPEARANCE = {
  themeMode: "system" as AppThemeMode,
  appThemeId: "default" as AppThemeId,
  amoledBlack: false,
  customAccentColor: "",
  appLocale: "en",
  showHistoryTab: true,
  showUpdatesTab: true,
  showLabelsInNav: true,
};

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      ...DEFAULT_APPEARANCE,
      setThemeMode: (themeMode) => set({ themeMode }),
      setAppThemeId: (appThemeId) => set({ appThemeId }),
      setAmoledBlack: (amoledBlack) => set({ amoledBlack }),
      setCustomAccentColor: (customAccentColor) =>
        set({ customAccentColor: customAccentColor.trim() }),
      setAppLocale: (appLocale) =>
        set({ appLocale: appLocale.trim() || DEFAULT_APPEARANCE.appLocale }),
      setShowHistoryTab: (showHistoryTab) => set({ showHistoryTab }),
      setShowUpdatesTab: (showUpdatesTab) => set({ showUpdatesTab }),
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
        showLabelsInNav: state.showLabelsInNav,
      }),
    },
  ),
);
