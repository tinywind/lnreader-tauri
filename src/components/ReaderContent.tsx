import type { CSSProperties } from "react";
import { Box } from "@mantine/core";
import { useReaderStore, type ReaderTheme } from "../store/reader";

interface ReaderContentProps {
  html: string;
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

/**
 * Renders chapter HTML in either paged (CSS columns) or scroll
 * mode. Typography settings come from the reader store so tweaks
 * via the settings panel reflow live.
 */
export function ReaderContent({ html }: ReaderContentProps) {
  const paged = useReaderStore((s) => s.paged);
  const fontSize = useReaderStore((s) => s.fontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const theme = useReaderStore((s) => s.theme);
  const themeStyles = THEME_STYLES[theme];

  const sharedStyle: CSSProperties = {
    fontSize: `${fontSize}px`,
    lineHeight,
    background: themeStyles.background,
    color: themeStyles.color,
    transition: "background 150ms ease, color 150ms ease",
  };

  if (paged) {
    return (
      <Box
        component="div"
        className="reader-content reader-paged"
        style={{
          ...sharedStyle,
          columnWidth: `${PAGED_COLUMN_WIDTH}px`,
          columnGap: `${PAGED_COLUMN_GAP}px`,
          height: "calc(100vh - 56px)",
          padding: "1.5rem 2rem",
          overflow: "hidden",
        }}
        // We trust the upstream chapter HTML for now; sanitization
        // before persistence is part of Sprint 3 follow-up work.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <Box
      component="div"
      className="reader-content reader-scroll"
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
}
