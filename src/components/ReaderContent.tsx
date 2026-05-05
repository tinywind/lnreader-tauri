import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { Box } from "@mantine/core";
import { useReaderStore, type ReaderTheme } from "../store/reader";

export type ClickZone = "top" | "middle" | "bottom";

export interface ReaderContentHandle {
  scrollByPage: (direction: 1 | -1) => void;
  scrollToStart: () => void;
}

interface ReaderContentProps {
  html: string;
  onClickZone?: (zone: ClickZone) => void;
}

interface ThemeStyles {
  background: string;
  color: string;
}

const THEME_STYLES: Record<ReaderTheme, ThemeStyles> = {
  light: { background: "#ffffff", color: "#1a1a1a" },
  dark: { background: "#1a1a1a", color: "#e6e6e6" },
  sepia: { background: "#f4ecd8", color: "#5b4636" },
};

const PAGED_COLUMN_WIDTH = 540;
const PAGED_COLUMN_GAP = 48;
const SCROLL_MAX_WIDTH = 720;
const SCROLL_PAGE_FRACTION = 0.9;

function classifyClick(
  event: MouseEvent<HTMLDivElement>,
  element: HTMLElement,
): ClickZone {
  const rect = element.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  const third = rect.height / 3;
  if (offset < third) return "top";
  if (offset > rect.height - third) return "bottom";
  return "middle";
}

/**
 * Renders chapter HTML in either paged (CSS columns) or scroll
 * mode. Typography settings come from the reader store so tweaks
 * via the settings panel reflow live.
 *
 * Imperative handle exposes scrollByPage / scrollToStart so the
 * route's keyboard / button handlers can drive navigation
 * regardless of paged-vs-scroll mode.
 */
export const ReaderContent = forwardRef<
  ReaderContentHandle,
  ReaderContentProps
>(function ReaderContent({ html, onClickZone }, ref) {
  const paged = useReaderStore((s) => s.paged);
  const fontSize = useReaderStore((s) => s.fontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const theme = useReaderStore((s) => s.theme);
  const themeStyles = THEME_STYLES[theme];
  const innerRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollByPage(direction) {
        const node = innerRef.current;
        if (!node) {
          window.scrollBy({
            top:
              direction *
              window.innerHeight *
              SCROLL_PAGE_FRACTION,
            behavior: "smooth",
          });
          return;
        }
        if (paged) {
          node.scrollBy({
            left: direction * (PAGED_COLUMN_WIDTH + PAGED_COLUMN_GAP),
            behavior: "smooth",
          });
        } else {
          window.scrollBy({
            top:
              direction *
              window.innerHeight *
              SCROLL_PAGE_FRACTION,
            behavior: "smooth",
          });
        }
      },
      scrollToStart() {
        const node = innerRef.current;
        if (paged && node) {
          node.scrollTo({ left: 0, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      },
    }),
    [paged],
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onClickZone) return;
    const node = innerRef.current;
    if (!node) return;
    onClickZone(classifyClick(event, node));
  };

  const sharedStyle: CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight,
    background: themeStyles.background,
    color: themeStyles.color,
    transition: "background 150ms ease, color 150ms ease",
    cursor: onClickZone ? "pointer" : "auto",
  };

  if (paged) {
    return (
      <Box
        ref={innerRef}
        component="div"
        className="reader-content reader-paged"
        onClick={handleClick}
        style={{
          ...sharedStyle,
          columnWidth: `${PAGED_COLUMN_WIDTH}px`,
          columnGap: `${PAGED_COLUMN_GAP}px`,
          height: "calc(100vh - 56px)",
          padding: "1.5rem 2rem",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x proximity",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <Box
      ref={innerRef}
      component="div"
      className="reader-content reader-scroll"
      onClick={handleClick}
      style={{
        ...sharedStyle,
        maxWidth: `${SCROLL_MAX_WIDTH}px`,
        margin: "0 auto",
        padding: "1.5rem 1rem",
        minHeight: "calc(100vh - 56px)",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
