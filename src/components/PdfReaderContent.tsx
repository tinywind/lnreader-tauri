import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type Ref,
  type WheelEvent,
} from "react";
import { Box } from "@mantine/core";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { useTranslation } from "../i18n";
import {
  useReaderStore,
  type ReaderTapZone,
  type ReaderTapZoneMap,
} from "../store/reader";
import type { ReaderContentHandle } from "./ReaderContent";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfReaderContentProps {
  dataUrl: string;
  initialProgress?: number;
  onBoundaryPage?: (direction: 1 | -1) => void;
  onPageIndexChange?: (pageIndex: number) => void;
  onProgressChange?: (progress: number) => void;
  onToggleChrome?: () => void;
  viewportHeight?: string;
}

const MAX_CANVAS_SCALE = 3;
const MIN_CANVAS_WIDTH = 240;
const WHEEL_PAGE_COOLDOWN_MS = 220;
const WHEEL_PAGE_DELTA_THRESHOLD = 20;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function getPageFromProgress(progress: number, pageCount: number): number {
  if (pageCount <= 0) return 1;
  const page = Math.ceil((clampProgress(progress) / 100) * pageCount);
  return Math.max(1, Math.min(pageCount, page));
}

function decodeBase64Payload(payload: string): Uint8Array {
  const binary = window.atob(decodeURIComponent(payload).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodePercentPayload(payload: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (char === "%" && index + 2 < payload.length) {
      const value = Number.parseInt(payload.slice(index + 1, index + 3), 16);
      if (!Number.isNaN(value)) {
        bytes.push(value);
        index += 2;
        continue;
      }
    }
    bytes.push(char.charCodeAt(0));
  }
  return new Uint8Array(bytes);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Invalid PDF data URL.");
  }

  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  return header.includes(";base64")
    ? decodeBase64Payload(payload)
    : decodePercentPayload(payload);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("button,a,input,select,textarea,[role='button']");
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

function getTapZoneAction(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  tapZones: ReaderTapZoneMap,
) {
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
  const zone = `${row}${column}` as ReaderTapZone;
  return zone === "middleCenter" ? "menu" : tapZones[zone];
}

function PdfReaderContentInner(
  props: PdfReaderContentProps,
  ref: Ref<ReaderContentHandle>,
) {
  const {
    dataUrl,
    initialProgress = 0,
    onBoundaryPage,
    onPageIndexChange,
    onProgressChange,
    onToggleChrome,
    viewportHeight: requestedViewportHeight,
  } = props;
  const { t } = useTranslation();
  const general = useReaderStore((state) => state.general);
  const appearance = useReaderStore((state) => state.appearance);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pageNumberRef = useRef(1);
  const pageCountRef = useRef(0);
  const initialProgressRef = useRef(clampProgress(initialProgress));
  const wheelDeltaRef = useRef(0);
  const wheelCooldownTimerRef = useRef<number | null>(null);
  const wheelPagingLockedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const onBoundaryPageRef = useRef(onBoundaryPage);
  const onPageIndexChangeRef = useRef(onPageIndexChange);
  const onProgressChangeRef = useRef(onProgressChange);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [renderWidth, setRenderWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewportHeight =
    requestedViewportHeight ?? "calc(var(--lnr-app-content-height) - 3.75rem)";

  useEffect(() => {
    initialProgressRef.current = clampProgress(initialProgress);
  }, [initialProgress]);

  useEffect(() => {
    onBoundaryPageRef.current = onBoundaryPage;
  }, [onBoundaryPage]);

  useEffect(() => {
    onPageIndexChangeRef.current = onPageIndexChange;
  }, [onPageIndexChange]);

  useEffect(() => {
    onProgressChangeRef.current = onProgressChange;
  }, [onProgressChange]);

  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  useEffect(() => {
    pageCountRef.current = pageCount;
  }, [pageCount]);

  const moveToPage = useCallback((nextPageNumber: number) => {
    const nextPageCount = pageCountRef.current;
    if (nextPageCount <= 0) return;
    setPageNumber(Math.max(1, Math.min(nextPageCount, nextPageNumber)));
    viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const currentPage = pageNumberRef.current;
      const currentPageCount = pageCountRef.current;
      if (currentPageCount <= 0) return;
      const targetPage = currentPage + direction;
      if (targetPage < 1 || targetPage > currentPageCount) {
        onBoundaryPageRef.current?.(direction);
        return;
      }
      moveToPage(targetPage);
    },
    [moveToPage],
  );

  useImperativeHandle(
    ref,
    () => ({
      completeIfAtEnd() {
        const currentPageCount = pageCountRef.current;
        if (currentPageCount <= 0 || pageNumberRef.current < currentPageCount) {
          return false;
        }
        onProgressChangeRef.current?.(100);
        return true;
      },
      scrollByPage,
      scrollToStart() {
        moveToPage(1);
      },
    }),
    [moveToPage, scrollByPage],
  );

  useEffect(() => {
    let disposed = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;

    setDocument(null);
    setPageCount(0);
    setPageNumber(1);
    setError(null);
    setLoading(true);
    try {
      loadingTask = getDocument({ data: dataUrlToBytes(dataUrl) });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setLoading(false);
      return () => {
        disposed = true;
      };
    }

    void loadingTask.promise
      .then((nextDocument) => {
        if (disposed) {
          void nextDocument.destroy();
          return;
        }
        const nextPageCount = nextDocument.numPages;
        const restoredPage = getPageFromProgress(
          initialProgressRef.current,
          nextPageCount,
        );
        setDocument(nextDocument);
        setPageCount(nextPageCount);
        setPageNumber(restoredPage);
        setLoading(false);
      })
      .catch((nextError: unknown) => {
        if (disposed) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      void loadingTask?.destroy();
    };
  }, [dataUrl]);

  useEffect(() => {
    const node = canvasWrapRef.current;
    if (!node) return;

    const syncRenderWidth = () => {
      setRenderWidth((current) => {
        const style = window.getComputedStyle(node);
        const horizontalPadding =
          (Number.parseFloat(style.paddingLeft) || 0) +
          (Number.parseFloat(style.paddingRight) || 0);
        const nextWidth = Math.max(
          MIN_CANVAS_WIDTH,
          Math.floor(node.clientWidth - horizontalPadding),
        );
        return current === nextWidth ? current : nextWidth;
      });
    };
    syncRenderWidth();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncRenderWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || pageCount <= 0) return;
    onPageIndexChangeRef.current?.(pageNumber);
    onProgressChangeRef.current?.((pageNumber / pageCount) * 100);
  }, [document, pageCount, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas || pageCount <= 0 || renderWidth <= 0) return;

    let disposed = false;
    setRendering(true);
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    void document
      .getPage(pageNumber)
      .then((page) => {
        if (disposed) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const displayScale = renderWidth / baseViewport.width;
        const outputScale = Math.min(
          MAX_CANVAS_SCALE,
          Math.max(1, window.devicePixelRatio || 1),
        );
        const viewport = page.getViewport({ scale: displayScale * outputScale });
        const cssViewport = page.getViewport({ scale: displayScale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;

        const renderTask = page.render({ canvas, viewport });
        renderTaskRef.current = renderTask;
        return renderTask.promise;
      })
      .then(() => {
        if (disposed) return;
        renderTaskRef.current = null;
        setRendering(false);
      })
      .catch((nextError: unknown) => {
        if (disposed) return;
        renderTaskRef.current = null;
        setRendering(false);
        if (nextError instanceof Error && nextError.name === "RenderingCancelledException") {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [document, pageCount, pageNumber, renderWidth]);

  useEffect(
    () => () => {
      if (wheelCooldownTimerRef.current !== null) {
        window.clearTimeout(wheelCooldownTimerRef.current);
      }
    },
    [],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    const node = viewportRef.current;
    if (!node) return;
    const action = getTapZoneAction(
      node.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      general.tapZones,
    );
    const resolvedAction =
      general.tapToScroll || action === "menu" ? action : "none";

    switch (resolvedAction) {
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
    if (event.ctrlKey || isInteractiveTarget(event.target)) return;

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

  return (
    <Box
      ref={viewportRef}
      className="lnr-pdf-reader-viewport"
      onClick={handleClick}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        if (touch) {
          touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }
      }}
      onTouchEnd={(event) => {
        if (!general.swipeGestures || !touchStartRef.current) {
          touchStartRef.current = null;
          return;
        }
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        touchStartRef.current = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          scrollByPage(dx < 0 ? 1 : -1);
        }
      }}
      onWheel={handleWheel}
      style={{
        background: appearance.backgroundColor,
        color: appearance.textColor,
        cursor: "pointer",
        height: viewportHeight,
      }}
    >
      <div ref={canvasWrapRef} className="lnr-pdf-reader-page-wrap">
        {loading ? (
          <div className="lnr-pdf-reader-state">{t("reader.loadingContent")}</div>
        ) : error ? (
          <div className="lnr-pdf-reader-state" role="alert">
            <span>{t("reader.loadFailed")}</span>
            <span>{error}</span>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          aria-label={`${pageNumber} / ${pageCount}`}
          className="lnr-pdf-reader-canvas"
          data-rendering={rendering}
        />
      </div>
    </Box>
  );
}

export const PdfReaderContent = forwardRef(PdfReaderContentInner);
