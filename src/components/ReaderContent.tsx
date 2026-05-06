import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type Ref,
  type WheelEvent,
} from "react";
import { Box } from "@mantine/core";
import { formatTimeForLocale, useTranslation, type AppLocale } from "../i18n";
import {
  useReaderStore,
  type ReaderTapAction,
  type ReaderTapZone,
} from "../store/reader";

export interface ReaderContentHandle {
  completeIfAtEnd: () => boolean;
  scrollByPage: (direction: 1 | -1) => void;
  scrollToStart: () => void;
}

interface ReaderContentProps {
  bottomOverlayOffset?: number;
  html: string;
  initialProgress?: number;
  interactionBlocked?: boolean;
  onProgressChange?: (progress: number) => void;
  onPageIndexChange?: (pageIndex: number) => void;
  onToggleChrome?: () => void;
  onBoundaryPage?: (direction: 1 | -1) => void;
  viewportHeight?: string;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

interface PageInfo {
  current: number;
  total: number;
}

const SCROLL_MAX_WIDTH = 760;
const SCROLL_PAGE_FRACTION = 0.9;
const TWO_PAGE_MEDIA_QUERY = "(min-width: 62em)";
const PROGRESS_SAVE_DELAY_MS = 350;
const WHEEL_PAGE_COOLDOWN_MS = 220;
const WHEEL_PAGE_DELTA_THRESHOLD = 20;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function getTwoPageMediaMatches(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(TWO_PAGE_MEDIA_QUERY).matches
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("button,a,input,select,textarea,[role='button']");
}

function formatClock(date: Date, locale: AppLocale): string {
  return formatTimeForLocale(locale, date);
}

function emphasizeWord(word: string): string {
  if (word.length < 4) return word;
  const splitAt = Math.ceil(word.length * 0.42);
  return `<strong>${word.slice(0, splitAt)}</strong>${word.slice(splitAt)}`;
}

function applyBionicReading(html: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, "text/html");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.textContent?.trim()) {
      nodes.push(node);
    }
  }

  for (const node of nodes) {
    const span = document.createElement("span");
    span.innerHTML = node.textContent!.replace(/[A-Za-z0-9]{4,}/g, emphasizeWord);
    node.replaceWith(span);
  }

  return document.body.innerHTML;
}

function getProgress(node: HTMLElement, pageReader: boolean): number {
  if (pageReader) {
    const scrollWidth = Math.max(0, node.scrollWidth);
    if (scrollWidth <= node.clientWidth + 2) return 0;
    const pageLeft = getPagedLeft(node, getPagedPageIndex(node));
    return (pageLeft / scrollWidth) * 100;
  }
  const maxTop = node.scrollHeight - node.clientHeight;
  return maxTop <= 0 ? 100 : (node.scrollTop / maxTop) * 100;
}

function getPagedStep(node: HTMLElement): number {
  return Math.max(1, node.clientWidth);
}

function getPagedPageCount(node: HTMLElement): number {
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth);
  if (maxLeft <= 2) return 1;
  return Math.max(1, Math.ceil(maxLeft / getPagedStep(node)) + 1);
}

function getPagedPageIndex(node: HTMLElement): number {
  const total = getPagedPageCount(node);
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth);
  if (maxLeft <= 2) return 1;
  if (node.scrollLeft >= maxLeft - 2) return total;
  const current = Math.floor(node.scrollLeft / getPagedStep(node)) + 1;
  return Math.max(1, Math.min(total, current));
}

function getPagedLeft(node: HTMLElement, pageIndex: number): number {
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth);
  return Math.max(0, Math.min(maxLeft, (pageIndex - 1) * getPagedStep(node)));
}

function getProgressPageIndex(node: HTMLElement, progress: number): number {
  const total = getPagedPageCount(node);
  if (total <= 1) return 1;
  const ratio = clampProgress(progress) / 100;
  if (ratio >= 1) return total;
  const targetLeft = node.scrollWidth * ratio;
  const maxLeft = Math.max(0, node.scrollWidth - node.clientWidth);
  if (targetLeft >= maxLeft - 2) return total;
  const pageIndex = Math.floor(targetLeft / getPagedStep(node)) + 1;
  return Math.max(1, Math.min(total, pageIndex));
}

function isAtReadingEnd(node: HTMLElement, pageReader: boolean): boolean {
  if (pageReader) {
    return getPagedPageIndex(node) >= getPagedPageCount(node);
  }
  const maxTop = node.scrollHeight - node.clientHeight;
  return maxTop <= 2 || node.scrollTop >= maxTop - 2;
}

function getPageIndex(node: HTMLElement, pageReader: boolean): number {
  if (pageReader) {
    return getPagedPageIndex(node);
  }
  return Math.floor(node.scrollTop / Math.max(1, node.clientHeight)) + 1;
}

function getPageInfo(node: HTMLElement, pageReader: boolean): PageInfo {
  if (pageReader) {
    const total = getPagedPageCount(node);
    return {
      current: Math.max(1, Math.min(total, getPagedPageIndex(node))),
      total,
    };
  }
  const total = Math.max(
    1,
    Math.ceil(node.scrollHeight / Math.max(1, node.clientHeight)),
  );
  return {
    current: Math.max(1, Math.min(total, getPageIndex(node, false))),
    total,
  };
}

function scrollToProgress(
  node: HTMLElement,
  progress: number,
  pageReader: boolean,
  behavior: ScrollBehavior,
): void {
  const ratio = clampProgress(progress) / 100;
  if (pageReader) {
    const pageIndex = getProgressPageIndex(node, progress);
    node.scrollTo({ left: getPagedLeft(node, pageIndex), behavior });
    return;
  }
  const maxTop = node.scrollHeight - node.clientHeight;
  node.scrollTo({ top: maxTop * ratio, behavior });
}

function getNormalizedWheelDelta(event: WheelEvent<HTMLElement>): number {
  const primaryDelta =
    Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
  if (event.deltaMode === WHEEL_DELTA_LINE) return primaryDelta * 16;
  if (event.deltaMode === WHEEL_DELTA_PAGE) {
    return primaryDelta * window.innerHeight;
  }
  return primaryDelta;
}

function getTapZone(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): ReaderTapZone {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const column =
    x < rect.width / 3 ? "Left" : x > (rect.width * 2) / 3 ? "Right" : "Center";
  const row =
    y < rect.height / 3
      ? "top"
      : y > (rect.height * 2) / 3
        ? "bottom"
        : "middle";
  return `${row}${column}` as ReaderTapZone;
}

function ReaderContentInner(
  props: ReaderContentProps,
  ref: Ref<ReaderContentHandle>,
) {
  const {
    html,
    bottomOverlayOffset,
    initialProgress = 0,
    interactionBlocked = false,
    onProgressChange,
    onPageIndexChange,
    onToggleChrome,
    onBoundaryPage,
    viewportHeight: requestedViewportHeight,
  } = props;
  const general = useReaderStore((state) => state.general);
  const appearance = useReaderStore((state) => state.appearance);
  const { locale, t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const latestProgressRef = useRef(clampProgress(initialProgress));
  const lastSavedProgressRef = useRef(Math.round(clampProgress(initialProgress)));
  const progressTimerRef = useRef<number | null>(null);
  const completedForNavigationRef = useRef(false);
  const wheelDeltaRef = useRef(0);
  const wheelCooldownTimerRef = useRef<number | null>(null);
  const wheelPagingLockedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [progress, setProgress] = useState(clampProgress(initialProgress));
  const [pageInfo, setPageInfo] = useState<PageInfo>({
    current: 1,
    total: 1,
  });
  const [now, setNow] = useState(() => new Date());
  const [battery, setBattery] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [twoPageMediaMatches, setTwoPageMediaMatches] = useState(
    getTwoPageMediaMatches,
  );

  const renderedHtml = useMemo(
    () => (general.bionicReading ? applyBionicReading(html) : html),
    [general.bionicReading, html],
  );

  const viewportHeight =
    requestedViewportHeight ??
    "calc(var(--lnr-app-content-height) - 56px)";
  const overlayBottom = bottomOverlayOffset ?? 8;
  const isPagedReader = general.pageReader;
  const isTwoPageReader =
    isPagedReader && general.twoPageReader && twoPageMediaMatches;
  const visiblePageColumns = isTwoPageReader ? 2 : 1;

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const node = viewportRef.current;
      if (!node) return;
      if (direction === -1) {
        completedForNavigationRef.current = false;
      }
      if (isPagedReader) {
        const currentPage = getPagedPageIndex(node);
        const targetPage = currentPage + direction;
        if (targetPage < 1 || targetPage > getPagedPageCount(node)) {
          onBoundaryPage?.(direction);
          return;
        }
        node.scrollTo({
          left: getPagedLeft(node, targetPage),
          behavior: "smooth",
        });
        return;
      }
      const axisMax = node.scrollHeight - node.clientHeight;
      const current = node.scrollTop;
      if (
        (direction === 1 && current >= axisMax - 2) ||
        (direction === -1 && current <= 2)
      ) {
        onBoundaryPage?.(direction);
        return;
      }
      const amount = node.clientHeight * SCROLL_PAGE_FRACTION;
      node.scrollBy({ top: amount * direction, behavior: "smooth" });
    },
    [isPagedReader, onBoundaryPage],
  );

  const flushProgress = useCallback(
    (value: number) => {
      if (!onProgressChange) return;
      const rounded = Math.round(clampProgress(value));
      if (
        rounded >= 97 ||
        Math.abs(rounded - lastSavedProgressRef.current) >= 1
      ) {
        lastSavedProgressRef.current = rounded;
        onProgressChange(rounded);
      }
    },
    [onProgressChange],
  );

  const scheduleProgressSave = useCallback(
    (value: number) => {
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
      }
      progressTimerRef.current = window.setTimeout(() => {
        flushProgress(value);
        progressTimerRef.current = null;
      }, PROGRESS_SAVE_DELAY_MS);
    },
    [flushProgress],
  );

  useImperativeHandle(
    ref,
    () => ({
      completeIfAtEnd() {
        const node = viewportRef.current;
        if (!node || !isAtReadingEnd(node, isPagedReader)) return false;
        completedForNavigationRef.current = true;
        latestProgressRef.current = 100;
        setProgress(100);
        if (progressTimerRef.current !== null) {
          window.clearTimeout(progressTimerRef.current);
          progressTimerRef.current = null;
        }
        flushProgress(100);
        return true;
      },
      scrollByPage,
      scrollToStart() {
        const node = viewportRef.current;
        if (!node) return;
        node.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      },
    }),
    [flushProgress, isPagedReader, scrollByPage],
  );

  const applyPageInfo = useCallback(
    (nextPageInfo: PageInfo) => {
      setPageInfo((current) =>
        current.current === nextPageInfo.current &&
        current.total === nextPageInfo.total
          ? current
          : nextPageInfo,
      );
      onPageIndexChange?.(nextPageInfo.current);
    },
    [onPageIndexChange],
  );

  const restoreProgressPosition = useCallback(
    (value: number) => {
      const node = viewportRef.current;
      if (!node) return;
      scrollToProgress(node, value, isPagedReader, "auto");
      if (!completedForNavigationRef.current) {
        const restoredProgress = clampProgress(
          getProgress(node, isPagedReader),
        );
        latestProgressRef.current = restoredProgress;
        setProgress(restoredProgress);
      }
      applyPageInfo(getPageInfo(node, isPagedReader));
    },
    [applyPageInfo, isPagedReader],
  );

  const updateProgressFromScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    if (completedForNavigationRef.current) return;
    const nextProgress = clampProgress(getProgress(node, isPagedReader));
    latestProgressRef.current = nextProgress;
    setProgress(nextProgress);
    applyPageInfo(getPageInfo(node, isPagedReader));
    scheduleProgressSave(nextProgress);
  }, [applyPageInfo, isPagedReader, scheduleProgressSave]);

  useEffect(() => {
    latestProgressRef.current = clampProgress(initialProgress);
    setProgress(clampProgress(initialProgress));
    lastSavedProgressRef.current = Math.round(clampProgress(initialProgress));
    if (clampProgress(initialProgress) < 97) {
      completedForNavigationRef.current = false;
    }
  }, [initialProgress]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(TWO_PAGE_MEDIA_QUERY);
    const syncMedia = () => setTwoPageMediaMatches(media.matches);
    syncMedia();
    media.addEventListener("change", syncMedia);
    return () => media.removeEventListener("change", syncMedia);
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      restoreProgressPosition(latestProgressRef.current);
    });
  }, [
    renderedHtml,
    appearance.fontFamily,
    appearance.lineHeight,
    appearance.padding,
    appearance.textSize,
    viewportWidth,
    visiblePageColumns,
    restoreProgressPosition,
  ]);

  useEffect(() => {
    const node = viewportRef.current;
    const content = contentRef.current;
    if (!node) return;
    const syncViewportWidth = () => {
      setViewportWidth((current) =>
        current === node.clientWidth ? current : node.clientWidth,
      );
    };
    syncViewportWidth();
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      syncViewportWidth();
      window.requestAnimationFrame(() => {
        restoreProgressPosition(latestProgressRef.current);
      });
    });
    observer.observe(node);
    observer.observe(content);
    return () => observer.disconnect();
  }, [restoreProgressPosition]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || appearance.customJs.trim() === "") return;
    try {
      const run = new Function("container", appearance.customJs);
      run(content);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[reader] custom JS failed", error);
    }
  }, [appearance.customJs, renderedHtml]);

  useEffect(() => {
    if (!general.showBatteryAndTime) return;
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, [general.showBatteryAndTime]);

  useEffect(() => {
    if (!general.showBatteryAndTime) {
      setBattery(null);
      return;
    }
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
    };
    let manager: BatteryManagerLike | null = null;
    let disposed = false;
    const update = () => {
      if (!manager || disposed) return;
      setBattery(
        `${Math.round(manager.level * 100)}%${
          manager.charging ? ` ${t("readerContent.charging")}` : ""
        }`,
      );
    };
    void nav
      .getBattery?.()
      .then((nextManager) => {
        if (disposed) return;
        manager = nextManager;
        update();
        manager.addEventListener?.("levelchange", update);
        manager.addEventListener?.("chargingchange", update);
      })
      .catch(() => setBattery(null));
    return () => {
      disposed = true;
      manager?.removeEventListener?.("levelchange", update);
      manager?.removeEventListener?.("chargingchange", update);
    };
  }, [general.showBatteryAndTime, t]);

  useEffect(() => {
    if (!general.keepScreenOn) return;
    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
      };
    };
    let lock: { release: () => Promise<void> } | null = null;
    let disposed = false;
    void nav.wakeLock
      ?.request("screen")
      .then((nextLock) => {
        if (disposed) {
          void nextLock.release();
          return;
        }
        lock = nextLock;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (lock) void lock.release();
    };
  }, [general.keepScreenOn]);

  useEffect(() => {
    if (!general.autoScroll) return;
    const interval = window.setInterval(() => {
      const node = viewportRef.current;
      if (!node) return;
      if (isPagedReader) {
        node.scrollBy({ left: general.autoScrollOffset, behavior: "auto" });
      } else {
        node.scrollBy({ top: general.autoScrollOffset, behavior: "auto" });
      }
    }, general.autoScrollInterval);
    return () => window.clearInterval(interval);
  }, [
    general.autoScroll,
    general.autoScrollInterval,
    general.autoScrollOffset,
    isPagedReader,
  ]);

  useEffect(
    () => () => {
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
      }
      if (wheelCooldownTimerRef.current !== null) {
        window.clearTimeout(wheelCooldownTimerRef.current);
      }
      flushProgress(latestProgressRef.current);
    },
    [flushProgress],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (interactionBlocked) return;
    if (isInteractiveTarget(event.target)) return;
    const node = viewportRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();

    const zone = getTapZone(rect, event.clientX, event.clientY);
    const zoneMap =
      rect.width > rect.height
        ? general.landscapeTapZones
        : general.portraitTapZones;
    const action: ReaderTapAction =
      zone === "middleCenter"
        ? "menu"
        : general.tapToScroll
          ? zoneMap[zone]
          : "none";

    switch (action) {
      case "previous":
        scrollByPage(-1);
        break;
      case "next":
        scrollByPage(1);
        break;
      case "menu":
        onToggleChrome?.();
        break;
      case "none":
        break;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (interactionBlocked || event.ctrlKey) return;
    if (isInteractiveTarget(event.target)) return;

    const delta = getNormalizedWheelDelta(event);
    if (Math.abs(delta) < 1) return;

    event.preventDefault();
    if (wheelPagingLockedRef.current) return;

    wheelDeltaRef.current += delta;
    if (Math.abs(wheelDeltaRef.current) < WHEEL_PAGE_DELTA_THRESHOLD) return;

    const direction: 1 | -1 = wheelDeltaRef.current > 0 ? 1 : -1;
    wheelDeltaRef.current = 0;
    wheelPagingLockedRef.current = true;
    scrollByPage(direction);

    if (wheelCooldownTimerRef.current !== null) {
      window.clearTimeout(wheelCooldownTimerRef.current);
    }
    wheelCooldownTimerRef.current = window.setTimeout(() => {
      wheelPagingLockedRef.current = false;
      wheelCooldownTimerRef.current = null;
    }, WHEEL_PAGE_COOLDOWN_MS);
  };

  const contentStyle: CSSProperties = {
    boxSizing: "border-box",
    color: appearance.textColor,
    fontSize: `${appearance.textSize}px`,
    lineHeight: appearance.lineHeight,
    textAlign: appearance.textAlign,
    fontFamily: appearance.fontFamily || undefined,
    padding: `${appearance.padding}px`,
  };

  const pagedViewportWidth =
    viewportWidth > 0
      ? viewportWidth
      : typeof window !== "undefined"
        ? window.innerWidth
        : 0;
  const pageColumnGap = appearance.padding * 2;
  const pageContentWidth = Math.max(
    1,
    pagedViewportWidth - appearance.padding * 2,
  );
  const pageColumnWidth = Math.max(
    1,
    Math.floor(
      visiblePageColumns > 1
        ? (pageContentWidth - pageColumnGap) / visiblePageColumns
        : pageContentWidth,
    ),
  );
  const pageStyle: CSSProperties = isPagedReader
    ? {
        columnWidth: `${pageColumnWidth}px`,
        columnGap: `${pageColumnGap}px`,
        height: "100%",
        maxWidth: "none",
      }
    : {
        maxWidth: `${SCROLL_MAX_WIDTH}px`,
        minHeight: "100%",
        margin: "0 auto",
      };
  const viewportClassName = `reader-viewport ${
    isPagedReader ? "reader-viewport-paged" : "reader-viewport-scroll"
  }${isTwoPageReader ? " reader-viewport-two-page" : ""}`;

  return (
    <Box
      ref={viewportRef}
      className={viewportClassName}
      onClick={handleClick}
      onScroll={updateProgressFromScroll}
      onWheel={handleWheel}
      onTouchStart={(event) => {
        if (interactionBlocked) return;
        const touch = event.changedTouches[0];
        if (touch) {
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }
      }}
      onTouchEnd={(event) => {
        if (interactionBlocked) {
          touchStartRef.current = null;
          return;
        }
        if (!general.swipeGestures || !touchStartRef.current) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        touchStartRef.current = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          scrollByPage(dx < 0 ? 1 : -1);
        }
      }}
      style={{
        position: "relative",
        height: viewportHeight,
        overflowX: "hidden",
        overflowY: isPagedReader ? "hidden" : "auto",
        background: appearance.backgroundColor,
        color: appearance.textColor,
        cursor: "pointer",
        scrollBehavior: "smooth",
      }}
    >
      {appearance.customCss.trim() ? <style>{appearance.customCss}</style> : null}
      <Box
        ref={contentRef}
        className="reader-content"
        style={{
          ...contentStyle,
          ...pageStyle,
        }}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      <style>
        {`
          .reader-content img {
            max-width: 100%;
            height: auto;
          }
          .reader-content p {
            margin-block: ${
              general.removeExtraParagraphSpacing ? "0.65em" : "1em"
            };
          }
          .reader-content strong {
            font-weight: 800;
          }
          .reader-viewport-paged {
            overscroll-behavior-x: contain;
            scroll-snap-type: x mandatory;
            scrollbar-width: none;
          }
          .reader-viewport-paged::-webkit-scrollbar {
            display: none;
          }
        `}
      </style>
      {(general.showScrollPercentage || general.showBatteryAndTime) && (
        <Box
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: overlayBottom,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            color: appearance.textColor,
            fontSize: 12,
            pointerEvents: "none",
            opacity: 0.78,
            zIndex: 4,
          }}
        >
          <span>
            {general.showScrollPercentage
              ? isPagedReader
                ? `${pageInfo.current}/${pageInfo.total}`
                : `${Math.round(progress)}%`
              : ""}
          </span>
          <span>
            {general.showBatteryAndTime
              ? [battery, formatClock(now, locale)].filter(Boolean).join(" | ")
              : ""}
          </span>
        </Box>
      )}
    </Box>
  );
}

export const ReaderContent = forwardRef(ReaderContentInner);
