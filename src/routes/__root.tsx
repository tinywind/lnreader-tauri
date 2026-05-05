import { useEffect, useState, type ReactNode } from "react";
import { Anchor, AppShell } from "@mantine/core";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { SiteBrowserOverlay } from "../components/SiteBrowserOverlay";
import { useTranslation, type TranslationKey } from "../i18n";
import { startDeepLinkListener } from "../lib/deep-link";
import { useAppearanceStore } from "../store/appearance";
import { useBrowseStore } from "../store/browse";
import { useReaderStore } from "../store/reader";
import { BrowsePage } from "./browse";
import { HistoryPage } from "./history";
import { LibraryPage } from "./library";
import { SettingsPage } from "./settings";
import { UpdatesPage } from "./updates";

type NavItem = {
  compactKey: TranslationKey;
  icon: "library" | "browse" | "updates" | "history" | "settings";
  labelKey: TranslationKey;
  to: "/" | "/browse" | "/updates" | "/history" | "/settings";
  visibleWhen?: "updates" | "history";
};

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", labelKey: "nav.library", compactKey: "nav.library", icon: "library" },
  {
    to: "/browse",
    labelKey: "nav.browse",
    compactKey: "nav.browse",
    icon: "browse",
  },
  {
    to: "/updates",
    labelKey: "nav.updates",
    compactKey: "nav.updates",
    icon: "updates",
    visibleWhen: "updates",
  },
  {
    to: "/history",
    labelKey: "nav.history",
    compactKey: "nav.history",
    icon: "history",
    visibleWhen: "history",
  },
  {
    to: "/settings",
    labelKey: "nav.settings",
    compactKey: "nav.settings",
    icon: "settings",
  },
] as const;

type PersistentPage = "library" | "browse" | "updates" | "history" | "settings";

function getPersistentPage(pathname: string): PersistentPage | null {
  switch (pathname) {
    case "/":
      return "library";
    case "/browse":
      return "browse";
    case "/updates":
      return "updates";
    case "/history":
      return "history";
    case "/settings":
      return "settings";
    default:
      return null;
  }
}

function getSearchString(
  search: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = search[key];
  return typeof value === "string" ? value : fallback;
}

function asSearchRecord(search: unknown): Record<string, unknown> {
  return search !== null && typeof search === "object"
    ? (search as Record<string, unknown>)
    : {};
}

function PersistentPageSlot({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}

function isNavItemVisible(
  item: NavItem,
  visible: { history: boolean; updates: boolean },
): boolean {
  if (item.visibleWhen === "history") return visible.history;
  if (item.visibleWhen === "updates") return visible.updates;
  return true;
}

function NavIcon({ icon }: { icon: NavItem["icon"] }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    height: 16,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    width: 16,
  };

  switch (icon) {
    case "library":
      return (
        <svg {...common}>
          <path d="M4 4h4v16H4z" />
          <path d="M10 4h4v16h-4z" />
          <path d="m16 6 4-1 3 15-4 1z" />
        </svg>
      );
    case "browse":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case "updates":
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      );
  }
}

function AppNavLink({
  activeClassName,
  className,
  item,
  label,
}: {
  activeClassName: string;
  className: string;
  item: NavItem;
  label: string;
}) {
  return (
    <Anchor
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{ className: `${className} ${activeClassName}` }}
      aria-label={label}
      className={className}
      component={Link}
      title={label}
      to={item.to}
      underline="never"
    >
      <span className="lnr-rail-icon">
        <NavIcon icon={item.icon} />
      </span>
      <span className="lnr-rail-label">{label}</span>
    </Anchor>
  );
}

export function RootLayout() {
  const { t } = useTranslation();
  const showHistoryTab = useAppearanceStore((s) => s.showHistoryTab);
  const showUpdatesTab = useAppearanceStore((s) => s.showUpdatesTab);
  const fullScreenReader = useReaderStore((s) => s.general.fullScreen);
  const location = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search,
    }),
  });
  const pathname = location.pathname;
  const search = asSearchRecord(location.search);
  const navigate = useNavigate();
  const hideShellNav = fullScreenReader && pathname === "/reader";
  const activePersistentPage = getPersistentPage(pathname);
  const [visitedPages, setVisitedPages] = useState<ReadonlySet<PersistentPage>>(
    () =>
      new Set<PersistentPage>(
        activePersistentPage ? [activePersistentPage] : [],
      ),
  );
  const [lastBrowseQuery, setLastBrowseQuery] = useState(() =>
    getSearchString(search, "q", ""),
  );
  const [lastSettingsSection, setLastSettingsSection] = useState(() =>
    getSearchString(search, "section", "app"),
  );
  const browseQuery =
    activePersistentPage === "browse"
      ? getSearchString(search, "q", "")
      : lastBrowseQuery;
  const settingsSection =
    activePersistentPage === "settings"
      ? getSearchString(search, "section", "app")
      : lastSettingsSection;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    startDeepLinkListener({
      onRepoAdd: (repoUrl) => {
        useBrowseStore.getState().setPendingRepoUrl(repoUrl);
        void navigate({ to: "/browse", search: { q: "" } });
      },
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {
        // Plugin not initialized (e.g. running outside Tauri host
        // for vite-only dev). Listener registration silently no-ops.
      });
    return () => {
      unlisten?.();
    };
  }, [navigate]);

  useEffect(() => {
    if (activePersistentPage) {
      setVisitedPages((current) => {
        if (current.has(activePersistentPage)) return current;
        return new Set([...current, activePersistentPage]);
      });
    }

    if (activePersistentPage === "browse") {
      const nextQuery = getSearchString(search, "q", "");
      setLastBrowseQuery((current) =>
        current === nextQuery ? current : nextQuery,
      );
    }

    if (activePersistentPage === "settings") {
      const nextSection = getSearchString(search, "section", "app");
      setLastSettingsSection((current) =>
        current === nextSection ? current : nextSection,
      );
    }
  }, [activePersistentPage, search]);

  const pageVisited = (page: PersistentPage) =>
    visitedPages.has(page) || activePersistentPage === page;
  const navItems = NAV_ITEMS.filter((item) =>
    isNavItemVisible(item, {
      history: showHistoryTab,
      updates: showUpdatesTab,
    }),
  );

  return (
    <AppShell
      navbar={{
        width: { sm: 56, lg: 184 },
        breakpoint: "sm",
        collapsed: { mobile: true, desktop: hideShellNav },
      }}
      padding={0}
    >
      <AppShell.Navbar className="lnr-app-rail">
        <Anchor className="lnr-rail-brand" component={Link} to="/" underline="never">
          <span className="lnr-rail-mark">L</span>
          <span className="lnr-rail-title">LNReader</span>
        </Anchor>
        <nav className="lnr-rail-nav" aria-label={t("nav.primary")}>
          {navItems.map((item) => (
            <AppNavLink
              activeClassName="lnr-rail-link--active"
              className="lnr-rail-link"
              item={item}
              key={item.to}
              label={t(item.labelKey)}
            />
          ))}
        </nav>
      </AppShell.Navbar>
      <AppShell.Main
        className="lnr-app-main"
        style={{
          background: "var(--lnr-design-bg)",
          color: "var(--lnr-design-ink)",
        }}
      >
        {pageVisited("library") ? (
          <PersistentPageSlot active={activePersistentPage === "library"}>
            <LibraryPage active={activePersistentPage === "library"} />
          </PersistentPageSlot>
        ) : null}
        {pageVisited("browse") ? (
          <PersistentPageSlot active={activePersistentPage === "browse"}>
            <BrowsePage
              active={activePersistentPage === "browse"}
              query={browseQuery}
            />
          </PersistentPageSlot>
        ) : null}
        {pageVisited("updates") ? (
          <PersistentPageSlot active={activePersistentPage === "updates"}>
            <UpdatesPage />
          </PersistentPageSlot>
        ) : null}
        {pageVisited("history") ? (
          <PersistentPageSlot active={activePersistentPage === "history"}>
            <HistoryPage />
          </PersistentPageSlot>
        ) : null}
        {pageVisited("settings") ? (
          <PersistentPageSlot active={activePersistentPage === "settings"}>
            <SettingsPage section={settingsSection} />
          </PersistentPageSlot>
        ) : null}
        {activePersistentPage === null ? <Outlet /> : null}
      </AppShell.Main>
      {hideShellNav ? null : (
        <nav className="lnr-mobile-nav" aria-label={t("nav.primary")}>
          {navItems.map((item) => (
            <AppNavLink
              activeClassName="lnr-mobile-nav-link--active"
              className="lnr-mobile-nav-link"
              item={item}
              key={item.to}
              label={t(item.compactKey)}
            />
          ))}
        </nav>
      )}
      <SiteBrowserOverlay />
    </AppShell>
  );
}
