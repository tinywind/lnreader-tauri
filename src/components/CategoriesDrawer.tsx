import { useQuery } from "@tanstack/react-query";
import { Drawer, NavLink, Stack, Text } from "@mantine/core";
import { listCategories } from "../db/queries/category";

interface CategoriesDrawerProps {
  opened: boolean;
  onClose: () => void;
  selectedCategoryId: number | null;
  onSelect: (id: number | null) => void;
}

export function CategoriesDrawer({
  opened,
  onClose,
  selectedCategoryId,
  onSelect,
}: CategoriesDrawerProps) {
  const categories = useQuery({
    queryKey: ["category", "list"],
    queryFn: listCategories,
  });

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title="Categories"
      position="left"
      size="xs"
    >
      <Stack gap={4}>
        <NavLink
          label="All"
          active={selectedCategoryId === null}
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        />
        {categories.isLoading ? (
          <Text c="dimmed" size="sm" px="md" py="xs">
            Loading…
          </Text>
        ) : categories.error ? (
          <Text c="red" size="sm" px="md" py="xs">
            {categories.error instanceof Error
              ? categories.error.message
              : String(categories.error)}
          </Text>
        ) : categories.data && categories.data.length > 0 ? (
          categories.data.map((cat) => (
            <NavLink
              key={cat.id}
              label={cat.name}
              active={selectedCategoryId === cat.id}
              onClick={() => {
                onSelect(cat.id);
                onClose();
              }}
            />
          ))
        ) : (
          <Text c="dimmed" size="sm" px="md" py="xs">
            No categories yet.
          </Text>
        )}
      </Stack>
    </Drawer>
  );
}
