import { create } from "zustand";

export type ReaderTheme = "light" | "dark" | "sepia";

export interface ReaderSettings {
  paged: boolean;
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
}

interface ReaderState extends ReaderSettings {
  setPaged: (paged: boolean) => void;
  togglePaged: () => void;
  setFontSize: (size: number) => void;
  setLineHeight: (lh: number) => void;
  setTheme: (theme: ReaderTheme) => void;
  reset: () => void;
}

export const READER_DEFAULTS: ReaderSettings = {
  paged: false,
  fontSize: 18,
  lineHeight: 1.6,
  theme: "light",
};

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 36;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 2.4;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Reader UI/typography state.
 *
 * v0.1 keeps these in memory. Persistence to SQLite (sync at app
 * boot, write-through on change) lands when the Settings/More
 * surface is built in Sprint 6.
 */
export const useReaderStore = create<ReaderState>((set) => ({
  ...READER_DEFAULTS,
  setPaged: (paged) => set({ paged }),
  togglePaged: () => set((state) => ({ paged: !state.paged })),
  setFontSize: (fontSize) =>
    set({ fontSize: clamp(fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX) }),
  setLineHeight: (lineHeight) =>
    set({
      lineHeight: clamp(lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX),
    }),
  setTheme: (theme) => set({ theme }),
  reset: () => set({ ...READER_DEFAULTS }),
}));
