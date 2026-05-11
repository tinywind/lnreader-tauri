import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

type ReaderSeekbarOrientation = "horizontal" | "vertical";

interface ReaderSeekbarsProps {
  bottomOffset?: number | string;
  label: string;
  onCommit?: () => void;
  onSeek: (progress: number) => void;
  progress: number;
  showHorizontal: boolean;
  showVertical: boolean;
}

interface ReaderSeekbarProps {
  label: string;
  onCommit?: () => void;
  onSeek: (progress: number) => void;
  orientation: ReaderSeekbarOrientation;
  progress: number;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function getPointerProgress(
  element: HTMLElement,
  event: PointerEvent<HTMLElement>,
  orientation: ReaderSeekbarOrientation,
): number {
  const rect = element.getBoundingClientRect();
  if (orientation === "vertical") {
    return clampProgress(((event.clientY - rect.top) / rect.height) * 100);
  }
  return clampProgress(((event.clientX - rect.left) / rect.width) * 100);
}

function ReaderSeekbar({
  label,
  onCommit,
  onSeek,
  orientation,
  progress,
}: ReaderSeekbarProps) {
  const activePointerRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const clampedProgress = clampProgress(progress);

  function seekFromPointer(event: PointerEvent<HTMLElement>): void {
    onSeek(getPointerProgress(event.currentTarget, event, orientation));
  }

  function finishPointer(event: PointerEvent<HTMLElement>): void {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    setActive(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 10 : 5;
    let nextProgress: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        nextProgress = clampedProgress - step;
        break;
      case "ArrowRight":
      case "ArrowDown":
        nextProgress = clampedProgress + step;
        break;
      case "Home":
        nextProgress = 0;
        break;
      case "End":
        nextProgress = 100;
        break;
      default:
        break;
    }

    if (nextProgress === null) return;
    event.preventDefault();
    onSeek(clampProgress(nextProgress));
    onCommit?.();
  }

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(clampedProgress)}
      aria-valuetext={`${Math.round(clampedProgress)}%`}
      className="lnr-reader-floating-seekbar"
      data-active={active}
      data-orientation={orientation}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => {
        if (activePointerRef.current === null) return;
        activePointerRef.current = null;
        setActive(false);
        onCommit?.();
      }}
      onPointerCancel={finishPointer}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        activePointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (activePointerRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        seekFromPointer(event);
      }}
      onPointerUp={(event) => {
        if (activePointerRef.current !== event.pointerId) return;
        seekFromPointer(event);
        finishPointer(event);
      }}
      role="slider"
      style={
        { "--lnr-reader-seek-progress": `${clampedProgress}%` } as CSSProperties
      }
      tabIndex={0}
    >
      <span className="lnr-reader-floating-seekbar-track">
        <span className="lnr-reader-floating-seekbar-fill" />
      </span>
      <span className="lnr-reader-floating-seekbar-thumb" />
    </div>
  );
}

export function ReaderSeekbars({
  bottomOffset = "1rem",
  label,
  onCommit,
  onSeek,
  progress,
  showHorizontal,
  showVertical,
}: ReaderSeekbarsProps) {
  if (!showHorizontal) return null;

  return (
    <div
      className="lnr-reader-seekbars"
      style={
        {
          "--lnr-reader-seek-bottom":
            typeof bottomOffset === "number"
              ? `${bottomOffset}px`
              : bottomOffset,
        } as CSSProperties
      }
    >
      <ReaderSeekbar
        label={label}
        onCommit={onCommit}
        onSeek={onSeek}
        orientation="horizontal"
        progress={progress}
      />
      {showVertical ? (
        <ReaderSeekbar
          label={label}
          onCommit={onCommit}
          onSeek={onSeek}
          orientation="vertical"
          progress={progress}
        />
      ) : null}
    </div>
  );
}
