/**
 * Which SQLite file the app reads and writes.
 *
 * "real" is the imported bank history; "demo" is a generated, entirely
 * fictional dataset used to show the app off without exposing real finances.
 * They are separate files in DATA_DIR, so switching never touches the other
 * one and the demo can be edited (or reset) freely.
 *
 * Deliberately free of server-only imports: the switcher renders on the
 * client and needs the same list the server resolves the file from.
 *
 * The names shown for these live in the message catalogues under
 * `dataSource`, not here: they are interface text and get translated.
 */

export type DataSource = "real" | "demo";

export interface DataSourceInfo {
  id: DataSource;
  /** File name inside DATA_DIR. */
  file: string;
}

export const DATA_SOURCES: Record<DataSource, DataSourceInfo> = {
  real: { id: "real", file: "financial-planner.db" },
  demo: { id: "demo", file: "financial-planner-demo.db" },
};

/** Display order in the switcher. */
export const DATA_SOURCE_IDS: DataSource[] = ["real", "demo"];

export const DEFAULT_DATA_SOURCE: DataSource = "real";

export function isDataSource(value: unknown): value is DataSource {
  return value === "real" || value === "demo";
}
