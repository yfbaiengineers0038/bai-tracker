import JSZip from "jszip";
import { getUrl } from "aws-amplify/storage";
import {
  buildCsvText,
  downloadBlob,
  safeFilename,
  type ExportPoint,
  type ExportProject,
} from "./exportPoints";
import { buildGeoJson, buildPointLayouts, buildShapefile, type PointLayout } from "./exportGis";

/* ── File System Access API (typed inline to match App.tsx's existing style) ──
   No ambient @types dependency is added; the minimal shapes we use are
   declared here. Browsers without the API simply won't expose
   `showDirectoryPicker`, and the caller falls back to a ZIP. */

interface FsWritable {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}
interface FsFileHandle {
  createWritable: () => Promise<FsWritable>;
}
interface FsDirHandle {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FsFileHandle>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FsDirHandle>;
}

interface WindowWithDirectoryPicker {
  showDirectoryPicker?: (opts?: {
    mode?: "read" | "readwrite";
  }) => Promise<FsDirHandle>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" &&
    typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

export async function pickDirectory(): Promise<FsDirHandle | null> {
  const fn = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!fn) return null;
  try {
    return await fn({ mode: "readwrite" });
  } catch (err) {
    // User dismissed the picker — not an error, just a cancel.
    if ((err as DOMException)?.name === "AbortError") return null;
    throw err;
  }
}

/* ── Filename helpers ── */

/**
 * Recovers the original upload filename from an S3 key. Mirrors the helper in
 * App.tsx: strips the leading `{timestamp}-` and optional `{index}-` prefix
 * from the last path segment.
 *
 *   point-photos/<id>/1750000000000-2-site.jpg  →  site.jpg
 */
export function filenameFromKey(key: string): string {
  const last = key.split("/").pop() ?? "download";
  return last.replace(/^\d+-(\d+-)?/, "");
}

/** Top-level export folder name: `2026-07-23 1430 - Bent NM`. */
export function exportFolderName(project: ExportProject, when = new Date()): string {
  const stamp = formatStamp(when);
  return safeFilename(`${stamp} - ${project.name}`, "export");
}

function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/* ── Byte fetching ── */

/**
 * Fetch one media file's bytes. Resolves a fresh presigned URL per call (so a
 * long batch never trips a URL-expiry window) then fetches the blob. Works for
 * both images and videos — the key's URL is a plain GET regardless of type.
 */
export async function fetchBlob(key: string): Promise<Blob> {
  const { url } = await getUrl({ path: key });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${filenameFromKey(key)} (HTTP ${res.status}).`);
  return res.blob();
}

/* ── Progress / cancel ── */

export interface ExportMediaProgress {
  /** Media files fully fetched so far. */
  fetched: number;
  /** Total media files to fetch. */
  total: number;
  /** Filename currently being fetched, for display. */
  current: string;
}

/** Thrown when the user cancels mid-export. Callers treat it as a clean stop. */
export class ExportCanceledError extends Error {
  constructor() {
    super("Export canceled.");
    this.name = "ExportCanceledError";
  }
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new ExportCanceledError();
}

/* ── Data files (CSV / shapefile / GeoJSON) ── */

export interface ExportFormats {
  csv: boolean;
  shapefile: boolean;
  geojson: boolean;
}

export interface RootFile {
  name: string;
  data: Blob;
}

/**
 * Build the per-point layout and every data file chosen in `formats`, named
 * `<baseName>.csv`, `<baseName>.shp/.shx/.dbf/.prj/.cpg`, `<baseName>.geojson`.
 * `includeMedia` only decides whether the GeoJSON lists the photo paths.
 */
export function buildExportFiles(
  project: ExportProject,
  points: ExportPoint[],
  { formats, baseName, includeMedia }: { formats: ExportFormats; baseName: string; includeMedia: boolean },
): { layouts: PointLayout[]; rootFiles: RootFile[] } {
  if (!project.coordinateSystemEpsg) throw new Error("The project coordinate system is not configured.");
  if (points.length === 0) throw new Error("Select at least one point.");

  const base = safeFilename(baseName, "points");
  const layouts = buildPointLayouts(points);
  const rootFiles: RootFile[] = [];
  if (formats.csv) {
    rootFiles.push({ name: `${base}.csv`, data: new Blob([buildCsvText(project, points, layouts.map((l) => l.name))], { type: "text/csv;charset=utf-8" }) });
  }
  if (formats.shapefile) {
    const shape = buildShapefile(project, layouts);
    for (const ext of ["shp", "shx", "dbf", "prj", "cpg"] as const) {
      rootFiles.push({ name: `${base}.${ext}`, data: shape[ext] });
    }
  }
  if (formats.geojson) {
    const json = buildGeoJson(project, layouts, { includeMedia, name: base });
    rootFiles.push({ name: `${base}.geojson`, data: new Blob([json], { type: "application/geo+json" }) });
  }
  return { layouts, rootFiles };
}

/**
 * Data files only, no media. A lone CSV or GeoJSON downloads as-is; more than
 * one file (a shapefile alone is five) is bundled into `<baseName>.zip`.
 */
export async function downloadExportFiles(rootFiles: RootFile[], baseName: string): Promise<void> {
  if (rootFiles.length === 1) {
    downloadBlob(rootFiles[0].data, rootFiles[0].name);
    return;
  }
  const zip = new JSZip();
  for (const file of rootFiles) zip.file(file.name, file.data);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `${safeFilename(baseName, "points")}.zip`);
}

/* ── Export paths ── */

interface ExportMediaArgs {
  project: ExportProject;
  /** Point folders and media file names, from buildExportFiles. */
  layouts: PointLayout[];
  /** Data files written at the root of the export folder. */
  rootFiles: RootFile[];
  onProgress?: (progress: ExportMediaProgress) => void;
  signal: AbortSignal;
}

/**
 * Write the folder tree into the user-picked directory via the File System
 * Access API. Streams each file to disk as it's fetched, so memory stays
 * bounded regardless of total size. Points with no media still get an empty
 * subfolder so the structure is uniform. Media files are renamed to the
 * GeoJSON's ImageList names (`1000_Water-Meter-1000_1.jpg`).
 */
export async function exportToDirectory({
  project,
  layouts,
  rootFiles,
  onProgress,
  signal,
  rootHandle,
}: ExportMediaArgs & { rootHandle: FsDirHandle }): Promise<void> {
  // Create the dated top-level folder inside the picked directory.
  const topFolder = exportFolderName(project);
  const root = await rootHandle.getDirectoryHandle(topFolder, { create: true });
  checkAbort(signal);

  // CSV / shapefile / GeoJSON at the root of the export folder.
  for (const file of rootFiles) {
    const handle = await root.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.data);
    await writable.close();
    checkAbort(signal);
  }

  const total = layouts.reduce((sum, l) => sum + l.files.length, 0);
  let fetched = 0;
  report(onProgress, { fetched, total, current: "" });

  for (const layout of layouts) {
    checkAbort(signal);
    const folder = await root.getDirectoryHandle(layout.folder, { create: true });

    for (const { key, name } of layout.files) {
      checkAbort(signal);
      report(onProgress, { fetched, total, current: name });
      const blob = await fetchBlob(key);
      const fileHandle = await folder.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      fetched += 1;
      report(onProgress, { fetched, total, current: name });
    }
  }
}

/**
 * Build the same folder tree inside a single ZIP and trigger a download. This
 * is the fallback for browsers without the File System Access API (Safari,
 * Firefox). Holds all blobs in memory until the ZIP is generated, so it's
 * best suited to moderate total sizes.
 */
export async function exportToZip({
  project,
  layouts,
  rootFiles,
  onProgress,
  signal,
}: ExportMediaArgs): Promise<void> {
  const zip = new JSZip();
  const topFolder = exportFolderName(project);
  for (const file of rootFiles) zip.file(`${topFolder}/${file.name}`, file.data);

  const total = layouts.reduce((sum, l) => sum + l.files.length, 0);
  let fetched = 0;
  report(onProgress, { fetched, total, current: "" });

  for (const layout of layouts) {
    checkAbort(signal);
    const folder = layout.folder;

    for (const { key, name } of layout.files) {
      checkAbort(signal);
      report(onProgress, { fetched, total, current: name });
      const blob = await fetchBlob(key);
      zip.file(`${topFolder}/${folder}/${name}`, blob);
      fetched += 1;
      report(onProgress, { fetched, total, current: name });
    }
  }

  checkAbort(signal);
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "STORE", // media is already compressed; STORE avoids wasted CPU
  });
  downloadBlob(blob, `${topFolder}.zip`);
}

function report(
  onProgress: ((p: ExportMediaProgress) => void) | undefined,
  progress: ExportMediaProgress,
) {
  onProgress?.(progress);
}

export { buildCsvText };
