import { SimpleGrid, Stack } from "@mantine/core";
import type { LibraryNovel } from "../db/queries/novel";
import type { LibraryDisplayMode } from "../store/library";
import { NovelCard } from "./NovelCard";

interface LibraryGridProps {
  novels: readonly LibraryNovel[];
  displayMode: LibraryDisplayMode;
  novelsPerRow: number;
  showDownloadBadges: boolean;
  showUnreadBadges: boolean;
  showNumberBadges: boolean;
  selectedIds?: ReadonlySet<number>;
  onActivate?: (id: number) => void;
  onLongPress?: (id: number) => void;
}

export function LibraryGrid({
  novels,
  displayMode,
  novelsPerRow,
  showDownloadBadges,
  showUnreadBadges,
  showNumberBadges,
  selectedIds,
  onActivate,
  onLongPress,
}: LibraryGridProps) {
  const children = novels.map((novel, index) => (
    <NovelCard
      key={novel.id}
      name={novel.name}
      cover={novel.cover}
      displayMode={displayMode}
      itemNumber={index + 1}
      chaptersDownloaded={novel.chaptersDownloaded}
      chaptersUnread={novel.chaptersUnread}
      totalChapters={novel.totalChapters}
      showDownloadBadge={showDownloadBadges}
      showUnreadBadge={showUnreadBadges}
      showNumberBadge={showNumberBadges}
      selected={selectedIds?.has(novel.id) ?? false}
      onActivate={onActivate ? () => onActivate(novel.id) : undefined}
      onLongPress={onLongPress ? () => onLongPress(novel.id) : undefined}
    />
  ));

  return displayMode === "list" ? (
    <Stack gap="xs">{children}</Stack>
  ) : (
    <SimpleGrid
      cols={{
        base: Math.min(2, novelsPerRow),
        xs: Math.min(3, novelsPerRow),
        sm: novelsPerRow,
      }}
      spacing="md"
      verticalSpacing="lg"
    >
      {children}
    </SimpleGrid>
  );
}
