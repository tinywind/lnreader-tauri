import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReaderPresetTheme = "paper" | "sepia" | "sage" | "dark" | "amoled";
export type ReaderTextAlign = "left" | "justify" | "center" | "right";

export interface ReaderThemeDefinition {
  id: string;
  label: string;
  backgroundColor: string;
  textColor: string;
}

export interface ReaderGeneralSettings {
  fullScreen: boolean;
  keepScreenOn: boolean;
  pageReader: boolean;
  swipeGestures: boolean;
  tapToScroll: boolean;
  showSeekbar: boolean;
  verticalSeekbar: boolean;
  showScrollPercentage: boolean;
  showBatteryAndTime: boolean;
  autoScroll: boolean;
  autoScrollInterval: number;
  autoScrollOffset: number;
  bionicReading: boolean;
  removeExtraParagraphSpacing: boolean;
}

export interface ReaderAppearanceSettings {
  themeId: string;
  backgroundColor: string;
  textColor: string;
  textSize: number;
  textAlign: ReaderTextAlign;
  padding: number;
  fontFamily: string;
  lineHeight: number;
  customCss: string;
  customJs: string;
  customThemes: ReaderThemeDefinition[];
}

interface ReaderState {
  general: ReaderGeneralSettings;
  appearance: ReaderAppearanceSettings;
  lastReadChapterByNovel: Record<number, number>;
  novelPageIndexByNovel: Record<number, number>;
  setGeneral: (settings: Partial<ReaderGeneralSettings>) => void;
  setAppearance: (settings: Partial<ReaderAppearanceSettings>) => void;
  applyTheme: (theme: ReaderThemeDefinition) => void;
  saveCustomTheme: (theme: ReaderThemeDefinition) => void;
  deleteCustomTheme: (themeId: string) => void;
  setLastReadChapter: (novelId: number, chapterId: number) => void;
  setNovelPageIndex: (novelId: number, pageIndex: number) => void;
  resetReaderSettings: () => void;
}

export const READER_PRESET_THEMES: ReaderThemeDefinition[] = [
  {
    id: "paper",
    label: "Paper",
    backgroundColor: "#f5f5fa",
    textColor: "#111111",
  },
  {
    id: "sepia",
    label: "Sepia",
    backgroundColor: "#F7DFC6",
    textColor: "#593100",
  },
  {
    id: "sage",
    label: "Sage",
    backgroundColor: "#dce5e2",
    textColor: "#000000",
  },
  {
    id: "dark",
    label: "Dark",
    backgroundColor: "#292832",
    textColor: "#CCCCCC",
  },
  {
    id: "amoled",
    label: "AMOLED",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
  },
];

export const READER_FONT_OPTIONS = [
  { value: "", label: "Original" },
  { value: "Lora, Georgia, serif", label: "Lora" },
  { value: "Nunito, Arial, sans-serif", label: "Nunito" },
  { value: "\"Noto Sans\", Arial, sans-serif", label: "Noto Sans" },
  { value: "\"Open Sans\", Arial, sans-serif", label: "Open Sans" },
  { value: "\"Arbutus Slab\", Georgia, serif", label: "Arbutus Slab" },
  { value: "Domine, Georgia, serif", label: "Domine" },
  { value: "Lato, Arial, sans-serif", label: "Lato" },
  { value: "\"PT Serif\", Georgia, serif", label: "PT Serif" },
  { value: "OpenDyslexic, Arial, sans-serif", label: "OpenDyslexic" },
];

const DEFAULT_READER_THEME = READER_PRESET_THEMES[3]!;

export const READER_GENERAL_DEFAULTS: ReaderGeneralSettings = {
  fullScreen: false,
  keepScreenOn: false,
  pageReader: false,
  swipeGestures: true,
  tapToScroll: true,
  showSeekbar: true,
  verticalSeekbar: false,
  showScrollPercentage: true,
  showBatteryAndTime: true,
  autoScroll: false,
  autoScrollInterval: 80,
  autoScrollOffset: 1,
  bionicReading: false,
  removeExtraParagraphSpacing: false,
};

export const READER_APPEARANCE_DEFAULTS: ReaderAppearanceSettings = {
  themeId: DEFAULT_READER_THEME.id,
  backgroundColor: DEFAULT_READER_THEME.backgroundColor,
  textColor: DEFAULT_READER_THEME.textColor,
  textSize: 16,
  textAlign: "left",
  padding: 16,
  fontFamily: "",
  lineHeight: 1.5,
  customCss: "",
  customJs: "",
  customThemes: [],
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeGeneral(
  settings: Partial<ReaderGeneralSettings>,
): Partial<ReaderGeneralSettings> {
  return {
    ...settings,
    ...(settings.autoScrollInterval !== undefined
      ? {
          autoScrollInterval: Math.round(
            clamp(settings.autoScrollInterval, 16, 500),
          ),
        }
      : {}),
    ...(settings.autoScrollOffset !== undefined
      ? { autoScrollOffset: clamp(settings.autoScrollOffset, 0.25, 12) }
      : {}),
  };
}

function normalizeAppearance(
  settings: Partial<ReaderAppearanceSettings>,
): Partial<ReaderAppearanceSettings> {
  return {
    ...settings,
    ...(settings.textSize !== undefined
      ? { textSize: Math.round(clamp(settings.textSize, 12, 36)) }
      : {}),
    ...(settings.padding !== undefined
      ? { padding: Math.round(clamp(settings.padding, 0, 64)) }
      : {}),
    ...(settings.lineHeight !== undefined
      ? { lineHeight: clamp(settings.lineHeight, 1, 2.6) }
      : {}),
  };
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      general: READER_GENERAL_DEFAULTS,
      appearance: READER_APPEARANCE_DEFAULTS,
      lastReadChapterByNovel: {},
      novelPageIndexByNovel: {},
      setGeneral: (settings) =>
        set((state) => ({
          general: {
            ...state.general,
            ...normalizeGeneral(settings),
          },
        })),
      setAppearance: (settings) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            ...normalizeAppearance(settings),
          },
        })),
      applyTheme: (theme) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            themeId: theme.id,
            backgroundColor: theme.backgroundColor,
            textColor: theme.textColor,
          },
        })),
      saveCustomTheme: (theme) =>
        set((state) => {
          const customThemes = state.appearance.customThemes.filter(
            (entry) => entry.id !== theme.id,
          );
          customThemes.push(theme);
          return {
            appearance: {
              ...state.appearance,
              customThemes,
            },
          };
        }),
      deleteCustomTheme: (themeId) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            customThemes: state.appearance.customThemes.filter(
              (theme) => theme.id !== themeId,
            ),
          },
        })),
      setLastReadChapter: (novelId, chapterId) =>
        set((state) => ({
          lastReadChapterByNovel: {
            ...state.lastReadChapterByNovel,
            [novelId]: chapterId,
          },
        })),
      setNovelPageIndex: (novelId, pageIndex) =>
        set((state) => ({
          novelPageIndexByNovel: {
            ...state.novelPageIndexByNovel,
            [novelId]: Math.max(1, Math.round(pageIndex)),
          },
        })),
      resetReaderSettings: () =>
        set({
          general: READER_GENERAL_DEFAULTS,
          appearance: READER_APPEARANCE_DEFAULTS,
        }),
    }),
    {
      name: "reader-settings",
      partialize: (state) => ({
        general: state.general,
        appearance: state.appearance,
        lastReadChapterByNovel: state.lastReadChapterByNovel,
        novelPageIndexByNovel: state.novelPageIndexByNovel,
      }),
    },
  ),
);
