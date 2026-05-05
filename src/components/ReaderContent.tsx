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
} from "react";
import { Box } from "@mantine/core";
import { useReaderStore } from "../store/reader";

export type ClickZone = "top" | "middle" | "bottom";

export interface ReaderContentHandle {
  scrollByPage: (direction: 1 | -1) => void;
  scrollToStart: () => void;
}

interface ReaderContentProps {
  html: string;
  initialProgress?: number;
  onProgressChange?: (progress: number) => void;
  onPageIndexChange?: (pageIndex: number) => void;
  onToggleChrome?: () => void;
  onBoundaryPage?: (direction: 1 | -1) => void;
}

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

const PAGED_COLUMN_GAP = 48;
const SCROLL_MAX_WIDTH = 760;
const SCROLL_PAGE_FRACTION = 0.9;
const PROGRESS_SAVE_DELAY_MS = 350;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("button,a,input,select,textarea,[role='button']");
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
    const maxLeft = node.scrollWidth - node.clientWidth;
    return maxLeft <= 0 ? 100 : (node.scrollLeft / maxLeft) * 100;
  }
  const maxTop = node.scrollHeight - node.clientHeight;
  return maxTop <= 0 ? 100 : (node.scrollTop / maxTop) * 100;
}

function getPageIndex(node: HTMLElement, pageReader: boolean): number {
  if (pageReader) {
    return Math.floor(node.scrollLeft / Math.max(1, node.clientWidth)) + 1;
  }
  return Math.floor(node.scrollTop / Math.max(1, node.clientHeight)) + 1;
}

function scrollToProgress(
  node: HTMLElement,
  progress: number,
  pageReader: boolean,
  behavior: ScrollBehavior,
): void {
  const ratio = clampProgress(progress) / 100;
  if (pageReader) {
    const maxLeft = node.scrollWidth - node.clientWidth;
    node.scrollTo({ left: maxLeft * ratio, behavior });
    return;
  }
  const maxTop = node.scrollHeight - node.clientHeight;
  node.scrollTo({ top: maxTop * ratio, behavior });
}

export const ReaderContent = forwardRef<
  ReaderContentHandle,
  ReaderContentProps
>(function ReaderContent(
  {
    html,
    initialProgress = 0,
    onProgressChange,
    onPageIndexChange,
    onToggleChrome,
    onBoundaryPage,
  },
  ref,
) {
  const general = useReaderStore((state) => state.general);
  const appearance = useReaderStore((state) => state.appearance);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const latestProgressRef = useRef(clampProgress(initialProgress));
  const lastSavedProgressRef = useRef(Math.round(clampProgress(initialProgress)));
  const progressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [progress, setProgress] = useState(clampProgress(initialProgress));
  const [now, setNow] = useState(() => new Date());
  const [battery, setBattery] = useState<string | null>(null);

  const renderedHtml = useMemo(
    () => (general.bionicReading ? applyBionicReading(html) : html),
    [general.bionicReading, html],
  );

  const viewportHeight = general.fullScreen
    ? "100vh"
    : "calc(100vh - 56px)";

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const node = viewportRef.current;
      if (!node) return;
      const axisMax = general.pageReader
        ? node.scrollWidth - node.clientWidth
        : node.scrollHeight - node.clientHeight;
      const current = general.pageReader ? node.scrollLeft : node.scrollTop;
      if (
        (direction === 1 && current >= axisMax - 2) ||
        (direction === -1 && current <= 2)
      ) {
        onBoundaryPage?.(direction);
        return;
      }
      const amount = general.pageReader
        ? node.clientWidth
        : node.clientHeight * SCROLL_PAGE_FRACTION;
      if (general.pageReader) {
        node.scrollBy({ left: amount * direction, behavior: "smooth" });
      } else {
        node.scrollBy({ top: amount * direction, behavior: "smooth" });
      }
    },
    [general.pageReader, onBoundaryPage],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollByPage,
      scrollToStart() {
        const node = viewportRef.current;
        if (!node) return;
        node.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      },
    }),
    [scrollByPage],
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

  const updateProgressFromScroll = useCallback(() => {
    const node = viewportRef.current;
    if (!node) return;
    const nextProgress = clampProgress(getProgress(node, general.pageReader));
    latestProgressRef.current = nextProgress;
    setProgress(nextProgress);
    onPageIndexChange?.(getPageIndex(node, general.pageReader));
    scheduleProgressSave(nextProgress);
  }, [general.pageReader, onPageIndexChange, scheduleProgressSave]);

  useEffect(() => {
    latestProgressRef.current = clampProgress(initialProgress);
    setProgress(clampProgress(initialProgress));
    lastSavedProgressRef.current = Math.round(clampProgress(initialProgress));
  }, [initialProgress]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      scrollToProgress(
        node,
        latestProgressRef.current,
        general.pageReader,
        "auto",
      );
      updateProgressFromScroll();
    });
  }, [
    renderedHtml,
    appearance.fontFamily,
    appearance.lineHeight,
    appearance.padding,
    appearance.textSize,
    general.pageReader,
    updateProgressFromScroll,
  ]);

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
        `${Math.round(manager.level * 100)}%${manager.charging ? " charging" : ""}`,
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
  }, [general.showBatteryAndTime]);

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
      if (general.pageReader) {
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
    general.pageReader,
  ]);

  useEffect(
    () => () => {
      if (progressTimerRef.current !== null) {
        window.clearTimeout(progressTimerRef.current);
      }
      flushProgress(latestProgressRef.current);
    },
    [flushProgress],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const node = viewportRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (general.pageReader) {
      const x = event.clientX - rect.left;
      if (x < rect.width / 3) {
        scrollByPage(-1);
      } else if (x > (rect.width * 2) / 3) {
        scrollByPage(1);
      } else {
        onToggleChrome?.();
      }
      return;
    }

    const y = event.clientY - rect.top;
    if (general.tapToScroll && y < rect.height / 3) {
      scrollByPage(-1);
    } else if (general.tapToScroll && y > (rect.height * 2) / 3) {
      scrollByPage(1);
    } else {
      onToggleChrome?.();
    }
  };

  const handleSeek = (value: string) => {
    const node = viewportRef.current;
    if (!node) return;
    const nextProgress = Number(value);
    latestProgressRef.current = nextProgress;
    setProgress(nextProgress);
    scrollToProgress(node, nextProgress, general.pageReader, "auto");
    scheduleProgressSave(nextProgress);
  };

  const contentStyle: CSSProperties = {
    color: appearance.textColor,
    fontSize: `${appearance.textSize}px`,
    lineHeight: appearance.lineHeight,
    textAlign: appearance.textAlign,
    fontFamily: appearance.fontFamily || undefined,
    padding: `${appearance.padding}px`,
  };

  const pageStyle: CSSProperties = general.pageReader
    ? {
        columnWidth: `min(${SCROLL_MAX_WIDTH}px, calc(100vw - ${
          appearance.padding * 2
        }px))`,
        columnGap: `${PAGED_COLUMN_GAP}px`,
        height: "100%",
        maxWidth: "none",
      }
    : {
        maxWidth: `${SCROLL_MAX_WIDTH}px`,
        minHeight: "100%",
        margin: "0 auto",
      };

  return (
    <Box
      ref={viewportRef}
      className={
        general.pageReader
          ? "reader-viewport reader-viewport-paged"
          : "reader-viewport reader-viewport-scroll"
      }
      onClick={handleClick}
      onScroll={updateProgressFromScroll}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
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
        overflowX: general.pageReader ? "auto" : "hidden",
        overflowY: general.pageReader ? "hidden" : "auto",
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
            scroll-snap-type: x proximity;
          }
        `}
      </style>
      {general.showSeekbar ? (
        <input
          aria-label="Reading progress"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(progress)}
          onChange={(event) => handleSeek(event.currentTarget.value)}
          onClick={(event) => event.stopPropagation()}
          style={
            general.verticalSeekbar
              ? {
                  position: "fixed",
                  right: 8,
                  top: general.fullScreen ? "8vh" : "calc(56px + 8vh)",
                  height: "70vh",
                  width: 24,
                  writingMode: "vertical-lr",
                  zIndex: 5,
                }
              : {
                  position: "fixed",
                  left: 16,
                  right: 16,
                  bottom: general.showBatteryAndTime ? 36 : 12,
                  width: "calc(100vw - 32px)",
                  zIndex: 5,
                }
          }
        />
      ) : null}
      {(general.showScrollPercentage || general.showBatteryAndTime) && (
        <Box
          style={{
            position: "fixed",
            left: 12,
            right: 12,
            bottom: 8,
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
              ? `${Math.round(progress)}%`
              : ""}
          </span>
          <span>
            {general.showBatteryAndTime
              ? [battery, formatClock(now)].filter(Boolean).join(" | ")
              : ""}
          </span>
        </Box>
      )}
    </Box>
  );
});
