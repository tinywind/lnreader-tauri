import {
  forwardRef,
  memo,
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
import type { ChapterMediaElementPatch } from "../lib/chapter-media";
import { formatTimeForLocale, useTranslation, type AppLocale } from "../i18n";
import {
  useReaderStore,
  type ReaderAppearanceSettings,
  type ReaderGeneralSettings,
  type ReaderTapAction,
  type ReaderTapZone,
} from "../store/reader";
import { ReaderSeekbars } from "./ReaderSeekbars";

export interface ReaderContentHandle {
  completeIfAtEnd: () => boolean;
  patchMediaElements: (patches: ChapterMediaElementPatch[]) => void;
  scrollByPage: (direction: 1 | -1, source?: string) => void;
  scrollToStart: () => void;
}

interface ReaderContentProps {
  appearanceSettings?: ReaderAppearanceSettings;
  bottomOverlayOffset?: number | string;
  generalSettings?: ReaderGeneralSettings;
  html: string;
  initialProgress?: number;
  interactionBlocked?: boolean;
  onProgressChange?: (progress: number) => void;
  onPageIndexChange?: (pageIndex: number) => void;
  onSeekbarActivity?: () => void;
  onSeekbarActiveChange?: (active: boolean) => void;
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
const TWO_PAGE_MEDIA_QUERY = "(min-width: 992px)";
const PAGED_SCROLL_ANIMATION_MS = 120;
const PROGRESS_SAVE_DELAY_MS = 350;
const WHEEL_PAGE_COOLDOWN_MS = 220;
const WHEEL_PAGE_DELTA_THRESHOLD = 20;
const NATIVE_WHEEL_ACTION_LOCK_MS = 240;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const READER_MEDIA_EVENT_SELECTOR =
  "img,picture,svg,video,audio,canvas,iframe,figure";
const READER_MEDIA_PATCH_SELECTOR = [
  "img[src]",
  "video[src]",
  "audio[src]",
  "source[src]",
  "embed[src]",
  "track[src]",
  "img[data-src]",
  "img[data-original]",
  "img[data-lazy-src]",
  "img[data-orig-src]",
  "video[data-src]",
  "video[data-original]",
  "video[data-lazy-src]",
  "video[data-orig-src]",
  "audio[data-src]",
  "audio[data-original]",
  "audio[data-lazy-src]",
  "audio[data-orig-src]",
  "source[data-src]",
  "source[data-original]",
  "source[data-lazy-src]",
  "source[data-orig-src]",
  "video[poster]",
  "object[data]",
  'link[href][rel~="preload"][as="image"]',
  'link[href][rel~="preload"][as="video"]',
  'link[href][rel~="preload"][as="audio"]',
  "img[srcset]",
  "source[srcset]",
  "[style]",
].join(",");
const READER_MEDIA_PATCH_ATTRIBUTES = [
  "src",
  "srcset",
  "poster",
  "data",
  "href",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-orig-src",
  "style",
] as const;
const READER_MEDIA_SOURCE_URL_ATTRIBUTE = "data-norea-media-source-url";
const READER_PENDING_MEDIA_ATTRIBUTE = "data-norea-reader-media-pending";
const READER_PENDING_BACKGROUND_ATTRIBUTE = "data-norea-reader-media-bg";
const READER_PENDING_DISPLAY_ATTRIBUTE = "data-norea-reader-media-display";
const READER_PENDING_HEIGHT_ATTRIBUTE = "data-norea-reader-media-height";
const READER_PENDING_PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221000%22%20height%3D%221400%22%20viewBox%3D%220%200%201000%201400%22%2F%3E";
const READER_PENDING_PLACEHOLDER_HEIGHT = "min(72vh, 56rem)";

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function getReaderDebugSnapshot(node: HTMLElement | null) {
  if (!node) return null;
  const maxTop = Math.max(0, node.scrollHeight - node.clientHeight);
  return {
    scrollTop: Math.round(node.scrollTop),
    maxTop: Math.round(maxTop),
    scrollLeft: Math.round(node.scrollLeft),
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  };
}

function logReaderInput(event: string, details: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.warn("[reader-input:html]", event, details);
}

function logReaderMediaPipeline(
  event: string,
  details: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  console.warn("[reader-media:content]", event, details);
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function getTwoPageMediaMatches(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(TWO_PAGE_MEDIA_QUERY).matches
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (isReaderMediaEventTarget(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    "button,a,input,select,textarea,[role='button'],[role='slider']",
  );
}

function getReaderEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function isReaderMediaEventTarget(target: EventTarget | null): boolean {
  const element = getReaderEventElement(target);
  if (!element) return false;
  if (element.closest(READER_MEDIA_EVENT_SELECTOR)) return true;
  const link = element.closest("a");
  return !!link?.querySelector(READER_MEDIA_EVENT_SELECTOR);
}

function stopReaderMediaClick(event: MouseEvent<HTMLDivElement>): void {
  if (!isReaderMediaEventTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
}

function mediaPatchValueKind(value: string): string {
  if (value === "") return "blank";
  if (value.startsWith("data:")) return "data-url";
  if (value.startsWith("norea-media://")) return "local-media";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return "remote";
  }
  return "other";
}

function prepareReaderHtmlForDisplay(html: string): string {
  if (
    typeof document === "undefined" ||
    !html.includes(READER_MEDIA_SOURCE_URL_ATTRIBUTE)
  ) {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  let changed = false;

  let placeholderCount = 0;
  for (const image of template.content.querySelectorAll<HTMLImageElement>(
    `img[${READER_MEDIA_SOURCE_URL_ATTRIBUTE}]`,
  )) {
    if ((image.getAttribute("src") ?? "").trim() !== "") continue;
    image.setAttribute("src", READER_PENDING_PLACEHOLDER_SRC);
    image.setAttribute(READER_PENDING_MEDIA_ATTRIBUTE, "true");
    if (image.style.display === "") {
      image.style.display = "block";
      image.setAttribute(READER_PENDING_DISPLAY_ATTRIBUTE, "true");
    }
    if (image.style.minHeight === "") {
      image.style.minHeight = READER_PENDING_PLACEHOLDER_HEIGHT;
      image.setAttribute(READER_PENDING_HEIGHT_ATTRIBUTE, "true");
    }
    if (image.style.backgroundColor === "") {
      image.style.backgroundColor = "rgba(148, 163, 184, 0.12)";
      image.setAttribute(READER_PENDING_BACKGROUND_ATTRIBUTE, "true");
    }
    placeholderCount += 1;
    changed = true;
  }

  if (changed) {
    logReaderMediaPipeline("placeholder-shell", {
      htmlLength: html.length,
      placeholderCount,
    });
  }
  return changed ? template.innerHTML : html;
}

function clearReaderPendingMedia(element: HTMLElement): void {
  if (!element.hasAttribute(READER_PENDING_MEDIA_ATTRIBUTE)) return;
  element.removeAttribute(READER_PENDING_MEDIA_ATTRIBUTE);
  if (element.hasAttribute(READER_PENDING_BACKGROUND_ATTRIBUTE)) {
    element.style.removeProperty("background-color");
    element.removeAttribute(READER_PENDING_BACKGROUND_ATTRIBUTE);
  }
  if (element.hasAttribute(READER_PENDING_DISPLAY_ATTRIBUTE)) {
    element.style.removeProperty("display");
    element.removeAttribute(READER_PENDING_DISPLAY_ATTRIBUTE);
  }
  if (element.hasAttribute(READER_PENDING_HEIGHT_ATTRIBUTE)) {
    element.style.removeProperty("min-height");
    element.removeAttribute(READER_PENDING_HEIGHT_ATTRIBUTE);
  }
}

function mergeMediaElementPatches(
  current: Map<number, ChapterMediaElementPatch>,
  patches: ChapterMediaElementPatch[],
): void {
  for (const patch of patches) {
    const existing = current.get(patch.index);
    current.set(patch.index, {
      index: patch.index,
      attributes: {
        ...(existing?.attributes ?? {}),
        ...patch.attributes,
      },
    });
  }
}

function patchReaderMediaElements(
  container: HTMLElement,
  patches: ChapterMediaElementPatch[],
): void {
  if (patches.length === 0) return;
  const currentElements = [
    ...container.querySelectorAll<HTMLElement>(READER_MEDIA_PATCH_SELECTOR),
  ];
  let changedCount = 0;
  const srcKinds = new Set<string>();

  for (const patch of patches) {
    const current = currentElements[patch.index];
    if (!current) continue;
    let changed = false;
    for (const [attribute, value] of Object.entries(patch.attributes)) {
      if (
        !(READER_MEDIA_PATCH_ATTRIBUTES as readonly string[]).includes(
          attribute,
        )
      ) {
        continue;
      }
      if (value.trim() === "") continue;
      if (attribute === "src" || attribute === "srcset") {
        srcKinds.add(mediaPatchValueKind(value));
      }
      if ((current.getAttribute(attribute) ?? "") !== value) {
        current.setAttribute(attribute, value);
        changed = true;
      }
    }
    if (changed) {
      changedCount += 1;
      clearReaderPendingMedia(current);
    }
  }
  logReaderMediaPipeline("patch-elements", {
    changedCount,
    patchCount: patches.length,
    srcKinds: [...srcKinds],
    firstIndexes: patches.slice(0, 8).map((patch) => patch.index),
    mediaElementCount: currentElements.length,
  });
}

function countBlankReaderMedia(html: string): number {
  if (typeof document === "undefined") return 0;
  const template = document.createElement("template");
  template.innerHTML = html;
  return [
    ...template.content.querySelectorAll<HTMLImageElement>(
      `img[${READER_MEDIA_SOURCE_URL_ATTRIBUTE}]`,
    ),
  ].filter((image) => (image.getAttribute("src") ?? "").trim() === "").length;
}

function countDataUrlReaderMedia(html: string): number {
  if (typeof document === "undefined") return 0;
  const template = document.createElement("template");
  template.innerHTML = html;
  return [...template.content.querySelectorAll<HTMLImageElement>("img")].filter(
    (image) => (image.getAttribute("src") ?? "").startsWith("data:"),
  ).length;
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
    onSeekbarActivity,
    onSeekbarActiveChange,
    onToggleChrome,
    onBoundaryPage,
    viewportHeight: requestedViewportHeight,
    appearanceSettings,
    generalSettings,
  } = props;
  const storedGeneral = useReaderStore((state) => state.general);
  const storedAppearance = useReaderStore((state) => state.appearance);
  const general = generalSettings ?? storedGeneral;
  const appearance = appearanceSettings ?? storedAppearance;
  const { locale, t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const latestProgressRef = useRef(clampProgress(initialProgress));
  const lastSavedProgressRef = useRef(Math.round(clampProgress(initialProgress)));
  const progressTimerRef = useRef<number | null>(null);
  const completedForNavigationRef = useRef(false);
  const latestMediaElementPatchesRef = useRef<
    Map<number, ChapterMediaElementPatch>
  >(new Map());
  const latestRenderedHtmlRef = useRef<string | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelCooldownTimerRef = useRef<number | null>(null);
  const wheelPagingLockedRef = useRef(false);
  const nativeWheelActionLockedUntilRef = useRef(0);
  const pageScrollAnimationRef = useRef<number | null>(null);
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
    () => {
      const preparedHtml = prepareReaderHtmlForDisplay(html);
      return general.bionicReading
        ? applyBionicReading(preparedHtml)
        : preparedHtml;
    },
    [general.bionicReading, html],
  );
  const renderedHtmlMarkup = useMemo(
    () => ({ __html: renderedHtml }),
    [renderedHtml],
  );

  useEffect(() => {
    if (latestRenderedHtmlRef.current === renderedHtml) return;
    latestRenderedHtmlRef.current = renderedHtml;
    logReaderMediaPipeline("html-replace", {
      blankMediaCount: countBlankReaderMedia(renderedHtml),
      dataUrlMediaCount: countDataUrlReaderMedia(renderedHtml),
      htmlLength: renderedHtml.length,
    });
  }, [renderedHtml]);

  const viewportHeight =
    requestedViewportHeight ??
    "calc(var(--lnr-app-content-height) - 3.75rem)";
  const overlayBottom = bottomOverlayOffset ?? "0.5rem";
  const isPagedReader = general.pageReader;
  const isTwoPageReader =
    isPagedReader && general.twoPageReader && twoPageMediaMatches;
  const visiblePageColumns = isTwoPageReader ? 2 : 1;

  const scrollPagedTo = useCallback((targetLeft: number) => {
    const node = viewportRef.current;
    if (!node) return;
    if (pageScrollAnimationRef.current !== null) {
      window.cancelAnimationFrame(pageScrollAnimationRef.current);
      pageScrollAnimationRef.current = null;
    }

    const startLeft = node.scrollLeft;
    const distance = targetLeft - startLeft;
    if (Math.abs(distance) <= 1) {
      node.scrollTo({ left: targetLeft, behavior: "auto" });
      return;
    }

    const startedAt = performance.now();
    const step = (timestamp: number) => {
      const elapsed = timestamp - startedAt;
      const progress = Math.min(1, elapsed / PAGED_SCROLL_ANIMATION_MS);
      node.scrollLeft = startLeft + distance * easeOutCubic(progress);
      if (progress < 1) {
        pageScrollAnimationRef.current = window.requestAnimationFrame(step);
        return;
      }
      node.scrollLeft = targetLeft;
      pageScrollAnimationRef.current = null;
    };

    pageScrollAnimationRef.current = window.requestAnimationFrame(step);
  }, []);

  const scrollByPage = useCallback(
    (direction: 1 | -1, source = "imperative") => {
      const node = viewportRef.current;
      if (!node) return;
      if (direction === -1) {
        completedForNavigationRef.current = false;
      }
      if (isPagedReader) {
        const currentPage = getPagedPageIndex(node);
        const targetPage = currentPage + direction;
        logReaderInput("page-step-request", {
          source,
          direction,
          mode: "paged",
          currentPage,
          targetPage,
          snapshot: getReaderDebugSnapshot(node),
        });
        if (targetPage < 1 || targetPage > getPagedPageCount(node)) {
          logReaderInput("page-step-boundary", {
            source,
            direction,
            snapshot: getReaderDebugSnapshot(node),
          });
          onBoundaryPage?.(direction);
          return;
        }
        scrollPagedTo(getPagedLeft(node, targetPage));
        return;
      }
      if (performance.now() < nativeWheelActionLockedUntilRef.current) {
        logReaderInput("page-step-suppressed", {
          source,
          direction,
          reason: "native-wheel-active",
          snapshot: getReaderDebugSnapshot(node),
        });
        return;
      }
      const axisMax = node.scrollHeight - node.clientHeight;
      const current = node.scrollTop;
      logReaderInput("page-step-request", {
        source,
        direction,
        mode: "scroll",
        axisMax: Math.round(axisMax),
        snapshot: getReaderDebugSnapshot(node),
      });
      if (
        (direction === 1 && current >= axisMax - 2) ||
        (direction === -1 && current <= 2)
      ) {
        logReaderInput("page-step-boundary", {
          source,
          direction,
          snapshot: getReaderDebugSnapshot(node),
        });
        onBoundaryPage?.(direction);
        return;
      }
      const amount = node.clientHeight * SCROLL_PAGE_FRACTION;
      logReaderInput("page-step-scroll", {
        source,
        direction,
        amount: Math.round(amount),
        snapshot: getReaderDebugSnapshot(node),
      });
      node.scrollBy({ top: amount * direction, behavior: "auto" });
    },
    [isPagedReader, onBoundaryPage, scrollPagedTo],
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

  const patchMediaElements = useCallback(
    (patches: ChapterMediaElementPatch[]) => {
      if (patches.length === 0) return;
      mergeMediaElementPatches(latestMediaElementPatchesRef.current, patches);
      const content = contentRef.current;
      if (!content) return;
      patchReaderMediaElements(content, patches);
    },
    [],
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
      patchMediaElements,
      scrollByPage,
      scrollToStart() {
        const node = viewportRef.current;
        if (!node) return;
        node.scrollTo({ top: 0, left: 0, behavior: "auto" });
      },
    }),
    [
      flushProgress,
      isPagedReader,
      patchMediaElements,
      scrollByPage,
    ],
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
    general.htmlImagePagingMode,
    viewportWidth,
    visiblePageColumns,
    restoreProgressPosition,
  ]);

  useEffect(() => {
    const patches = [...latestMediaElementPatchesRef.current.values()];
    if (patches.length === 0) return;
    window.requestAnimationFrame(() => {
      const content = contentRef.current;
      if (content) patchReaderMediaElements(content, patches);
    });
  }, [renderedHtml]);

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
    });
    observer.observe(node);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
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
    if (!general.autoScroll || isPagedReader) return;
    const interval = window.setInterval(() => {
      const node = viewportRef.current;
      if (!node) return;
      node.scrollBy({ top: general.autoScrollOffset, behavior: "auto" });
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
      if (pageScrollAnimationRef.current !== null) {
        window.cancelAnimationFrame(pageScrollAnimationRef.current);
        pageScrollAnimationRef.current = null;
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
    const action: ReaderTapAction =
      zone === "middleCenter"
        ? "menu"
        : general.tapToScroll
          ? general.tapZones[zone]
          : "none";

    switch (action) {
      case "previous":
        scrollByPage(-1, "tap-previous");
        break;
      case "next":
        scrollByPage(1, "tap-next");
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
    if (!isPagedReader) {
      nativeWheelActionLockedUntilRef.current =
        performance.now() + NATIVE_WHEEL_ACTION_LOCK_MS;
      return;
    }

    event.preventDefault();
    if (wheelPagingLockedRef.current) {
      logReaderInput("wheel-suppressed", {
        delta: Math.round(delta),
        reason: "wheel-cooldown",
        snapshot: getReaderDebugSnapshot(viewportRef.current),
      });
      return;
    }

    wheelDeltaRef.current += delta;
    if (Math.abs(wheelDeltaRef.current) < WHEEL_PAGE_DELTA_THRESHOLD) {
      logReaderInput("wheel-accumulate", {
        delta: Math.round(delta),
        accumulated: Math.round(wheelDeltaRef.current),
        snapshot: getReaderDebugSnapshot(viewportRef.current),
      });
      return;
    }

    const direction: 1 | -1 = wheelDeltaRef.current > 0 ? 1 : -1;
    wheelDeltaRef.current = 0;
    wheelPagingLockedRef.current = true;
    logReaderInput("wheel-page-step", {
      direction,
      snapshot: getReaderDebugSnapshot(viewportRef.current),
    });
    scrollByPage(direction, "wheel-page-step");

    if (wheelCooldownTimerRef.current !== null) {
      window.clearTimeout(wheelCooldownTimerRef.current);
    }
    wheelCooldownTimerRef.current = window.setTimeout(() => {
      wheelPagingLockedRef.current = false;
      wheelCooldownTimerRef.current = null;
    }, WHEEL_PAGE_COOLDOWN_MS);
  };

  const seekToProgress = useCallback(
    (value: number) => {
      const node = viewportRef.current;
      if (!node) return;
      const clamped = clampProgress(value);
      if (clamped < 97) {
        completedForNavigationRef.current = false;
      }
      scrollToProgress(node, clamped, isPagedReader, "auto");
      const nextProgress = clampProgress(getProgress(node, isPagedReader));
      latestProgressRef.current = nextProgress;
      setProgress(nextProgress);
      applyPageInfo(getPageInfo(node, isPagedReader));
      scheduleProgressSave(nextProgress);
    },
    [applyPageInfo, isPagedReader, scheduleProgressSave],
  );

  const commitSeekProgress = useCallback(() => {
    flushProgress(latestProgressRef.current);
  }, [flushProgress]);

  const contentStyle = useMemo<CSSProperties>(
    () => ({
      boxSizing: "border-box",
      color: appearance.textColor,
      fontSize: `${appearance.textSize}px`,
      lineHeight: appearance.lineHeight,
      textAlign: appearance.textAlign,
      fontFamily: appearance.fontFamily || undefined,
      padding: `${appearance.padding}px`,
    }),
    [
      appearance.fontFamily,
      appearance.lineHeight,
      appearance.padding,
      appearance.textAlign,
      appearance.textColor,
      appearance.textSize,
    ],
  );

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
  const pageStyle = useMemo<CSSProperties>(
    () =>
      isPagedReader
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
          },
    [isPagedReader, pageColumnGap, pageColumnWidth],
  );
  const contentBoxStyle = useMemo<CSSProperties>(
    () => ({
      ...contentStyle,
      ...pageStyle,
    }),
    [contentStyle, pageStyle],
  );
  const viewportClassName = `reader-viewport ${
    isPagedReader ? "reader-viewport-paged" : "reader-viewport-scroll"
  }${isTwoPageReader ? " reader-viewport-two-page" : ""}`;

  return (
    <Box
      className="lnr-reader-content-stage"
      style={{
        height: viewportHeight,
        background: appearance.backgroundColor,
        color: appearance.textColor,
      }}
    >
      <Box
        ref={viewportRef}
        className={viewportClassName}
        onClickCapture={stopReaderMediaClick}
        onDoubleClickCapture={stopReaderMediaClick}
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
            scrollByPage(dx < 0 ? 1 : -1, "swipe");
          }
        }}
        style={{
          position: "relative",
          height: "100%",
          overflowX: "hidden",
          overflowY: isPagedReader ? "hidden" : "auto",
          color: appearance.textColor,
          cursor: "pointer",
          scrollBehavior: "auto",
        }}
      >
        {appearance.customCss.trim() ? (
          <style>{appearance.customCss}</style>
        ) : null}
        <Box
          ref={contentRef}
          className="reader-content"
          data-image-paging={
            isPagedReader ? general.htmlImagePagingMode : undefined
          }
          style={contentBoxStyle}
          dangerouslySetInnerHTML={renderedHtmlMarkup}
        />
        <style>
          {`
          .reader-content :where(img, svg, video, canvas, iframe) {
            max-width: 100%;
            height: auto;
          }
          .reader-viewport-paged .reader-content[data-image-paging="auto"] :where(img, svg, video, canvas, iframe) {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .reader-viewport-paged .reader-content[data-image-paging="next-page"] :where(img, svg, video, canvas, iframe) {
            break-before: column;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .reader-viewport-paged .reader-content[data-image-paging="next-page"] > :where(img, svg, video, canvas, iframe):first-child,
          .reader-viewport-paged .reader-content[data-image-paging="next-page"] > :first-child :where(img, svg, video, canvas, iframe) {
            break-before: auto;
          }
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] > :where(p, div, figure, a) {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] :where(img, picture, svg, video, canvas, iframe) {
            break-before: column !important;
            break-after: column !important;
            break-inside: avoid !important;
            page-break-before: always !important;
            page-break-after: always !important;
            page-break-inside: avoid !important;
          }
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] > :where(img, picture, svg, video, canvas, iframe):first-child,
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] > :first-child :where(img, picture, svg, video, canvas, iframe):first-child {
            break-before: auto !important;
            page-break-before: auto !important;
          }
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] > :where(img, picture, svg, video, canvas, iframe):last-child,
          .reader-viewport-paged .reader-content[data-image-paging="single-image"] > :last-child :where(img, picture, svg, video, canvas, iframe):last-child {
            break-after: auto !important;
            page-break-after: auto !important;
          }
          .reader-viewport-paged .reader-content[data-image-paging="fragment"] :where(img, svg, video, canvas, iframe) {
            break-inside: auto;
            page-break-inside: auto;
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
              left: "0.75rem",
              right: "0.75rem",
              bottom: overlayBottom,
              display: "flex",
              justifyContent: "space-between",
              gap: "0.75rem",
              color: appearance.textColor,
              fontSize: "0.75rem",
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
      <ReaderSeekbars
        bottomOffset={overlayBottom}
        label={t("reader.progressAria", { progress: Math.round(progress) })}
        onActivity={onSeekbarActivity}
        onActiveChange={onSeekbarActiveChange}
        onCommit={commitSeekProgress}
        onSeek={seekToProgress}
        progress={progress}
        showHorizontal={general.showSeekbar}
        showVertical={general.showSeekbar && general.verticalSeekbar}
      />
    </Box>
  );
}

export const ReaderContent = memo(forwardRef(ReaderContentInner));
