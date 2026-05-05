import { SimpleGrid } from "@mantine/core";
import type { LibraryNovel } from "../db/queries/novel";
import { NovelCard } from "./NovelCard";

interface LibraryGridProps {
  novels: readonly LibraryNovel[];
}

export function LibraryGrid({ novels }: LibraryGridProps) {
  return (
    <SimpleGrid
      cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6 }}
      spacing="md"
      verticalSpacing="lg"
    >
      {novels.map((novel) => (
        <NovelCard key={novel.id} name={novel.name} cover={novel.cover} />
      ))}
    </SimpleGrid>
  );
}
