import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Novel — a title in the user's library or browsable from a source plugin.
export const novelTable = sqliteTable(
  "novel",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pluginId: text("plugin_id").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    cover: text("cover"),
    summary: text("summary"),
    author: text("author"),
    artist: text("artist"),
    status: text("status"),
    genres: text("genres"),
    inLibrary: integer("in_library", { mode: "boolean" })
      .notNull()
      .default(false),
    isLocal: integer("is_local", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastReadAt: integer("last_read_at", { mode: "timestamp" }),
  },
  (t) => ({
    pluginPathUniq: uniqueIndex("novel_plugin_path_uniq").on(
      t.pluginId,
      t.path,
    ),
    inLibraryIdx: index("novel_in_library_idx").on(t.inLibrary),
  }),
);

// Chapter — one readable unit, owned by a novel.
export const chapterTable = sqliteTable(
  "chapter",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => novelTable.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    name: text("name").notNull(),
    chapterNumber: text("chapter_number"),
    position: integer("position").notNull(),
    page: text("page").notNull().default("1"),
    bookmark: integer("bookmark", { mode: "boolean" })
      .notNull()
      .default(false),
    unread: integer("unread", { mode: "boolean" }).notNull().default(true),
    progress: integer("progress").notNull().default(0),
    isDownloaded: integer("is_downloaded", { mode: "boolean" })
      .notNull()
      .default(false),
    content: text("content"),
    releaseTime: text("release_time"),
    readAt: integer("read_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    novelPathUniq: uniqueIndex("chapter_novel_path_uniq").on(
      t.novelId,
      t.path,
    ),
    novelPositionIdx: index("chapter_novel_position_idx").on(
      t.novelId,
      t.position,
    ),
  }),
);

// Category — user-defined Library tab grouping. `is_system` flags
// the seeded "Default" and "Local" categories so the UI can hide
// rename/delete affordances for them.
export const categoryTable = sqliteTable(
  "category",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    sort: integer("sort").notNull(),
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => ({
    nameUniq: uniqueIndex("category_name_uniq").on(t.name),
    sortIdx: index("category_sort_idx").on(t.sort),
  }),
);

// NovelCategory — many-to-many bridge between Novel and Category.
export const novelCategoryTable = sqliteTable(
  "novel_category",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => novelTable.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categoryTable.id, { onDelete: "cascade" }),
  },
  (t) => ({
    novelCategoryUniq: uniqueIndex("novel_category_uniq").on(
      t.novelId,
      t.categoryId,
    ),
    categoryIdx: index("novel_category_category_idx").on(t.categoryId),
  }),
);

// Repository — plugin source registry (a URL pointing at a JSON
// catalog of available plugins).
export const repositoryTable = sqliteTable(
  "repository",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    url: text("url").notNull(),
    name: text("name"),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    urlUniq: uniqueIndex("repository_url_uniq").on(t.url),
  }),
);

export type Novel = typeof novelTable.$inferSelect;
export type NovelInsert = typeof novelTable.$inferInsert;
export type Chapter = typeof chapterTable.$inferSelect;
export type ChapterInsert = typeof chapterTable.$inferInsert;
export type Category = typeof categoryTable.$inferSelect;
export type CategoryInsert = typeof categoryTable.$inferInsert;
export type NovelCategory = typeof novelCategoryTable.$inferSelect;
export type NovelCategoryInsert = typeof novelCategoryTable.$inferInsert;
export type Repository = typeof repositoryTable.$inferSelect;
export type RepositoryInsert = typeof repositoryTable.$inferInsert;
