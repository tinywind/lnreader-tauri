import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GlobalSearchResult } from "../lib/plugins/global-search";

export const DEFAULT_GLOBAL_SEARCH_CONCURRENCY = 3;

function getDefaultPluginLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.split("-")[0]?.toLowerCase() || "en";
}

function normalizeStringArray(
  value: unknown,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeConcurrency(value: unknown): number {
  const numeric =
    typeof value === "number" ? value : DEFAULT_GLOBAL_SEARCH_CONCURRENCY;
  if (!Number.isFinite(numeric)) return DEFAULT_GLOBAL_SEARCH_CONCURRENCY;
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

interface BrowseGlobalSearchState {
  query: string;
  searchKey: string;
  results: GlobalSearchResult[];
  searching: boolean;
  totalPluginCount: number;
}

const EMPTY_GLOBAL_SEARCH: BrowseGlobalSearchState = {
  query: "",
  searchKey: "",
  results: [],
  searching: false,
  totalPluginCount: 0,
};

interface BrowseState {
  /**
   * URL pending insertion via the Add Repository modal, set by
   * an `lnreader://repo/add?url=...` deep-link or other intent.
   * The Browse route consumes and clears it on render.
   */
  pendingRepoUrl: string | null;
  pluginLanguageFilter: string[];
  globalSearchConcurrency: number;
  pinnedPluginIds: string[];
  lastUsedPluginId: string | null;
  globalSearch: BrowseGlobalSearchState;
  setPendingRepoUrl: (url: string | null) => void;
  clearPendingRepoUrl: () => void;
  setPluginLanguageFilter: (languages: string[]) => void;
  setGlobalSearchConcurrency: (concurrency: number) => void;
  togglePinnedPlugin: (pluginId: string) => void;
  setLastUsedPluginId: (pluginId: string | null) => void;
  beginGlobalSearch: (search: BrowseGlobalSearchState) => void;
  appendGlobalSearchResult: (
    searchKey: string,
    result: GlobalSearchResult,
  ) => void;
  finishGlobalSearch: (searchKey: string) => void;
  clearGlobalSearch: () => void;
}

export const useBrowseStore = create<BrowseState>()(
  persist(
    (set) => ({
      pendingRepoUrl: null,
      pluginLanguageFilter: [getDefaultPluginLanguage()],
      globalSearchConcurrency: DEFAULT_GLOBAL_SEARCH_CONCURRENCY,
      pinnedPluginIds: [],
      lastUsedPluginId: null,
      globalSearch: EMPTY_GLOBAL_SEARCH,
      setPendingRepoUrl: (pendingRepoUrl) => set({ pendingRepoUrl }),
      clearPendingRepoUrl: () => set({ pendingRepoUrl: null }),
      setPluginLanguageFilter: (pluginLanguageFilter) =>
        set({
          pluginLanguageFilter: normalizeStringArray(
            pluginLanguageFilter,
            [],
          ),
        }),
      setGlobalSearchConcurrency: (globalSearchConcurrency) =>
        set({
          globalSearchConcurrency: normalizeConcurrency(
            globalSearchConcurrency,
          ),
        }),
      togglePinnedPlugin: (pluginId) =>
        set((state) => ({
          pinnedPluginIds: state.pinnedPluginIds.includes(pluginId)
            ? state.pinnedPluginIds.filter((id) => id !== pluginId)
            : [...state.pinnedPluginIds, pluginId],
        })),
      setLastUsedPluginId: (lastUsedPluginId) => set({ lastUsedPluginId }),
      beginGlobalSearch: (globalSearch) => set({ globalSearch }),
      appendGlobalSearchResult: (searchKey, result) =>
        set((state) => {
          if (state.globalSearch.searchKey !== searchKey) return state;
          const results = state.globalSearch.results.filter(
            (row) => row.pluginId !== result.pluginId,
          );
          return {
            globalSearch: {
              ...state.globalSearch,
              results: [...results, result],
            },
          };
        }),
      finishGlobalSearch: (searchKey) =>
        set((state) =>
          state.globalSearch.searchKey === searchKey
            ? {
                globalSearch: {
                  ...state.globalSearch,
                  searching: false,
                },
              }
            : state,
        ),
      clearGlobalSearch: () => set({ globalSearch: EMPTY_GLOBAL_SEARCH }),
    }),
    {
      name: "browse-plugin-settings",
      merge: (persistedState, currentState) => {
        if (persistedState === null || typeof persistedState !== "object") {
          return currentState;
        }
        const persisted = persistedState as Partial<BrowseState>;
        return {
          ...currentState,
          pluginLanguageFilter: normalizeStringArray(
            persisted.pluginLanguageFilter,
            currentState.pluginLanguageFilter,
          ),
          globalSearchConcurrency: normalizeConcurrency(
            persisted.globalSearchConcurrency,
          ),
          pinnedPluginIds: normalizeStringArray(
            persisted.pinnedPluginIds,
            currentState.pinnedPluginIds,
          ),
          lastUsedPluginId:
            typeof persisted.lastUsedPluginId === "string"
              ? persisted.lastUsedPluginId
              : null,
        };
      },
      partialize: (state) => ({
        pluginLanguageFilter: normalizeStringArray(
          state.pluginLanguageFilter,
          [],
        ),
        globalSearchConcurrency: normalizeConcurrency(
          state.globalSearchConcurrency,
        ),
        pinnedPluginIds: normalizeStringArray(state.pinnedPluginIds, []),
        lastUsedPluginId: state.lastUsedPluginId,
      }),
    },
  ),
);
