import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { BrowsePage } from "./routes/browse";
import { GlobalSearchPage } from "./routes/global-search";
import { LibraryPage } from "./routes/library";
import { MorePage } from "./routes/more";
import { ReaderPage } from "./routes/reader";

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

const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reader",
  component: ReaderPage,
});

const moreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/more",
  component: MorePage,
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  browseRoute,
  globalSearchRoute,
  readerRoute,
  moreRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
