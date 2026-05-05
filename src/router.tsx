import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { BrowsePage } from "./routes/browse";
import { GlobalSearchPage } from "./routes/global-search";
import { HistoryPage } from "./routes/history";
import { LibraryPage } from "./routes/library";
import { MorePage } from "./routes/more";
import { NovelDetailPage } from "./routes/novel";
import { ReaderPage } from "./routes/reader";
import { SourcePage } from "./routes/source";
import { UpdatesPage } from "./routes/updates";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LibraryPage,
});

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/browse",
  component: BrowsePage,
});

const globalSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: GlobalSearchPage,
});

function asPositiveId(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reader",
  validateSearch: (search: Record<string, unknown>) => ({
    chapterId: asPositiveId(search.chapterId),
  }),
  component: ReaderPage,
});

export const novelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/novel",
  validateSearch: (search: Record<string, unknown>) => ({
    id: asPositiveId(search.id),
  }),
  component: NovelDetailPage,
});

const moreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more",
  component: MorePage,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  component: HistoryPage,
});

const updatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/updates",
  component: UpdatesPage,
});

export const sourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/source",
  validateSearch: (search: Record<string, unknown>) => ({
    pluginId:
      typeof search.pluginId === "string" ? search.pluginId : "",
  }),
  component: SourcePage,
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  browseRoute,
  globalSearchRoute,
  readerRoute,
  moreRoute,
  novelRoute,
  historyRoute,
  updatesRoute,
  sourceRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
