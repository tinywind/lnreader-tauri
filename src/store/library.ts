import { create } from "zustand";

interface LibraryState {
  selectedCategoryId: number | null;
  search: string;
  setSelectedCategoryId: (id: number | null) => void;
  setSearch: (search: string) => void;
}

/**
 * Library tab UI/transient state.
 *
 * Server (DB) state is owned by TanStack Query. This store holds
 * only client-side selections that aren't worth persisting yet
 * (the search-as-URL strategy lands when filtering matures).
 */
export const useLibraryStore = create<LibraryState>((set) => ({
  selectedCategoryId: null,
  search: "",
  setSelectedCategoryId: (selectedCategoryId) => set({ selectedCategoryId }),
  setSearch: (search) => set({ search }),
}));
