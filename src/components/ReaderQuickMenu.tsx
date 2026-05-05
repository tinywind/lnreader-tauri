import { type CSSProperties, type SyntheticEvent } from "react";
import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { useReaderStore } from "../store/reader";

interface ReaderQuickMenuProps {
  visible: boolean;
  chapterName?: string;
  progress: number;
  incognitoMode: boolean;
  bookmarked: boolean;
  bookmarkLoading: boolean;
  bookmarkDisabled: boolean;
  hasNextChapter: boolean;
  hasPreviousChapter: boolean;
  onBookmark: () => void;
  onBack: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onPreviousChapter: () => void;
  onNextChapter: () => void;
  onScrollToStart: () => void;
}

function stopMenuEvent(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function ReaderQuickMenu({
  visible,
  chapterName,
  progress,
  incognitoMode,
  bookmarked,
  bookmarkLoading,
  bookmarkDisabled,
  hasNextChapter,
  hasPreviousChapter,
  onBookmark,
  onBack,
  onClose,
  onOpenSettings,
  onPreviousChapter,
  onNextChapter,
  onScrollToStart,
}: ReaderQuickMenuProps) {
  const fullScreen = useReaderStore((state) => state.general.fullScreen);

  if (!visible) return null;

  return (
    <Box
      onClick={onClose}
      style={{
        "--reader-menu-top": fullScreen ? "8px" : "44px",
        position: "fixed",
        inset: 0,
        zIndex: 20,
        background: "rgba(26, 26, 24, 0.22)",
      } as CSSProperties}
    >
      <Group
        className="reader-quick-menu-toolbar"
        gap="xs"
        wrap="nowrap"
        onClick={stopMenuEvent}
        style={{
          position: "fixed",
          top: "var(--reader-menu-top)",
          left: 12,
          right: 12,
          justifyContent: "space-between",
        }}
      >
        <Group gap="xs" wrap="nowrap">
          <Button
            className="lnr-reader-menu-button"
            size="xs"
            variant="default"
            onClick={onOpenSettings}
          >
            Settings
          </Button>
          <Button
            className="lnr-reader-menu-button"
            size="xs"
            variant={bookmarked ? "light" : "default"}
            loading={bookmarkLoading}
            disabled={bookmarkDisabled}
            onClick={onBookmark}
          >
            {bookmarked ? "Bookmarked" : "Bookmark"}
          </Button>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          {incognitoMode ? (
            <Badge className="lnr-reader-menu-badge" variant="light" color="gray">
              Incognito
            </Badge>
          ) : null}
          <Badge
            className="lnr-reader-menu-badge"
            variant="light"
            title={chapterName}
            style={{
              maxWidth: "min(52vw, 520px)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {chapterName ? `${chapterName} - ` : ""}
            {Math.round(progress)}%
          </Badge>
        </Group>
      </Group>

      <Paper
        className="reader-quick-menu-panel"
        withBorder
        p="sm"
        onClick={stopMenuEvent}
      >
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Group gap="xs" wrap="nowrap">
              <Button
                className="lnr-reader-menu-button"
                size="xs"
                variant="subtle"
                onClick={onBack}
              >
                Back
              </Button>
              <Text className="lnr-reader-menu-title" fw={600}>
                Reader
              </Text>
            </Group>
            <Button
              className="lnr-reader-menu-button"
              size="xs"
              variant="subtle"
              onClick={onClose}
            >
              Hide
            </Button>
          </Group>

          <Group grow>
            <Button
              className="lnr-reader-menu-button"
              variant="default"
              disabled={!hasPreviousChapter}
              onClick={onPreviousChapter}
            >
              Previous
            </Button>
            <Button
              className="lnr-reader-menu-button"
              variant="default"
              onClick={onScrollToStart}
            >
              Top
            </Button>
            <Button
              className="lnr-reader-menu-button"
              variant="default"
              disabled={!hasNextChapter}
              onClick={onNextChapter}
            >
              Next
            </Button>
          </Group>
        </Stack>
      </Paper>
      <style>
        {`
          .reader-quick-menu-panel {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            max-height: 70vh;
            overflow-y: auto;
            border-bottom-left-radius: 0;
            border-bottom-right-radius: 0;
          }

          @media (min-width: 900px) and (orientation: landscape) {
            .reader-quick-menu-toolbar {
              left: auto;
              right: 16px;
              width: min(380px, calc(100vw - 32px));
            }

            .reader-quick-menu-panel {
              left: auto;
              right: 16px;
              bottom: auto;
              top: calc(var(--reader-menu-top) + 44px);
              width: min(380px, calc(100vw - 32px));
              max-height: calc(100vh - var(--reader-menu-top) - 60px);
              border-radius: var(--mantine-radius-md);
            }
          }
        `}
      </style>
    </Box>
  );
}
