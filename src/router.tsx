import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { BrowsePage } from "./routes/browse";
import { GlobalSearchPage } from "./routes/global-search";
import { LibraryPage } from "./routes/library";

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

const routeTree = rootRoute.addChildren([
  libraryRoute,
  browseRoute,
  globalSearchRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
