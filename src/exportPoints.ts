import { projectCoordinate } from "./survey";

export interface ExportPoint {
  id: string;
  date: string;
  time?: string | null;
  location?: string | null;
  description?: string | null;
  lat: number;
  lng: number;
  elevation?: number | null;
  category?: string | null;
  /** S3 keys for this point's photos/videos (e.g. point-photos/<id>/<file>). */
  photoKeys?: string[];
}

export interface ExportProject {
  name: string;
  coordinateSystemEpsg?: string | null;
  coordinateSystemName?: string | null;
  coordinateUnits?: string | null;
  verticalDatum?: string | null;
  elevationUnits?: string | null;
}

export function safeFilename(value: string, fallback = "export") {
  const safe = value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").slice(0, 100);
  return safe || fallback;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Force a cell to render as literal text in spreadsheet apps. Writes an
 * Excel-style `="..."` formula so the value is never auto-converted — most
 * importantly, ISO dates like 2026-07-23 are kept as text instead of being
 * turned into locale-formatted date serials (which then show as ####### when
 * the column is narrow). Inner quotes are doubled.
 */
function csvTextCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `="${text.replace(/"/g, '""')}"`;
}

/** Triggers a browser download for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build the points CSV content as a string, with columns:
 *   Date, Name, X (Easting), Y (Northing), Z (Elevation)
 *
 * Exposed so the media export can write the same CSV into a folder or ZIP
 * without re-implementing the column logic. `names` overrides each point's
 * name with its unique export name, so the CSV matches the shapefile/GeoJSON.
 */
export function buildCsvText(project: ExportProject, points: ExportPoint[], names?: string[]): string {
  if (!project.coordinateSystemEpsg) throw new Error("The project coordinate system is not configured.");
  if (points.length === 0) throw new Error("Select at least one point.");

  const rows = ["Date,Name,X,Y,Z"];
  points.forEach((point, index) => {
    const { easting, northing } = projectCoordinate(point.lat, point.lng, project.coordinateSystemEpsg!);
    const z = point.elevation ?? 0;
    const name = names?.[index] ?? point.location ?? "";
    rows.push([
      csvTextCell(point.date),
      csvCell(name),
      easting.toFixed(3),
      northing.toFixed(3),
      z.toFixed(3),
    ].join(","));
  });
  // UTF-8 BOM so Excel reads the file correctly; CRLF line terminators.
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

/**
 * Export the selected points as a single CSV file with fixed columns:
 *   Date, Name, X (Easting), Y (Northing), Z (Elevation)
 *
 * Lat/lng is projected to the project's coordinate system via proj4.
 * Missing elevations are written as 0.000.
 */
export async function exportSelectedPoints({
  project,
  points,
  filename,
}: {
  project: ExportProject;
  points: ExportPoint[];
  filename: string;
}) {
  const csv = buildCsvText(project, points);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(filename, project.name)}.csv`);
}
