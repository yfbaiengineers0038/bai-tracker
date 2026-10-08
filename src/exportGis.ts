import { projectCoordinate } from "./survey";
import type { ExportPoint, ExportProject } from "./exportPoints";

/* ── Point naming / media layout ──
   Shared by the GeoJSON (ImageFolder / ImageList) and the media export, so the
   paths written into the GeoJSON are exactly the folders written to disk. */

export interface PointLayout {
  point: ExportPoint;
  /** Unique export name: spaces → hyphens, counter appended when repeated. */
  name: string;
  /** Per-point media folder, same as `name`: `Water-Meter-2`. */
  folder: string;
  /** Media files in the folder: `Water-Meter-2_1.jpg`, … */
  files: { key: string; name: string }[];
}

function slug(text: string) {
  return text
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionOf(key: string) {
  const last = key.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot) : "";
}

/**
 * The name is the join key between the shapefile and the GeoJSON, so every
 * point gets a unique one:
 *   "Point 57" (unique)          → Point-57
 *   "Water Meter" (×3)           → Water-Meter-1, Water-Meter-2, Water-Meter-3
 *   no name                      → Point (or Point-1, Point-2, … when several)
 * Repeats are numbered oldest first by date and time, so re-exporting the same
 * selection gives the same names.
 */
export function buildPointLayouts(points: ExportPoint[]): PointLayout[] {
  const bases = points.map((p) => slug(p.location ?? "") || "Point");
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base.toLowerCase(), (counts.get(base.toLowerCase()) ?? 0) + 1);

  const chronological = points
    .map((point, index) => ({ index, when: `${point.date} ${point.time ?? ""}` }))
    .sort((a, b) => a.when.localeCompare(b.when) || a.index - b.index);

  const names: string[] = new Array(points.length);
  const seen = new Map<string, number>();
  const used = new Set<string>();
  for (const { index } of chronological) {
    const base = bases[index];
    const key = base.toLowerCase();
    let name = base;
    if ((counts.get(key) ?? 0) > 1) {
      const k = (seen.get(key) ?? 0) + 1;
      seen.set(key, k);
      name = `${base}-${k}`;
    }
    // Defensive: a typed "Water-Meter-2" can collide with a generated one.
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    names[index] = name;
  }

  return points.map((point, index) => {
    const name = names[index];
    const files = (point.photoKeys ?? []).filter(Boolean).map((key, i) => ({
      key,
      name: `${name}_${i + 1}${extensionOf(key)}`,
    }));
    return { point, name, folder: name, files };
  });
}

/* ── Shared attribute helpers ── */

function unitSuffix(units: string | null | undefined) {
  return units === "m" ? "m" : "ft";
}

function elevationMeters(elevation: number, units: string | null | undefined) {
  if (units === "m") return elevation;
  if (units === "ft") return elevation * 0.3048;
  return elevation * (1200 / 3937); // US survey feet (the project default)
}

/* ── GeoJSON ── */

export function buildGeoJson(
  project: ExportProject,
  layouts: PointLayout[],
  { includeMedia, name }: { includeMedia: boolean; name: string },
): string {
  const epsg = project.coordinateSystemEpsg!;
  const xy = unitSuffix(project.coordinateUnits);
  const z = unitSuffix(project.elevationUnits);

  const features = layouts.map(({ point, name: pointName, folder, files }) => {
    const { easting, northing } = projectCoordinate(point.lat, point.lng, epsg);
    const coordinates = [point.lng, point.lat];
    if (point.elevation != null) {
      coordinates.push(round(elevationMeters(point.elevation, project.elevationUnits), 3));
    }
    return {
      type: "Feature",
      properties: {
        Name: pointName,
        OriginalName: point.location || null,
        Date: isoDateTime(point.date, point.time),
        ConditionDescription: point.description || null,
        UtilityType: point.category || null,
        LATITUDE: point.lat,
        LONGITUDE: point.lng,
        [`Elevation_${z}`]: point.elevation ?? null,
        [`Northing_${xy}`]: round(northing, 3),
        [`Easting_${xy}`]: round(easting, 3),
        ImageFolder: includeMedia ? folder : null,
        ImageList: includeMedia ? files.map((f) => `${folder}/${f.name}`) : [],
        ImageCount: files.length,
      },
      geometry: { type: "Point", coordinates },
    };
  });

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name,
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features,
    },
    null,
    2,
  );
}

/** `2026-07-13` + `15:31` → `2026-07-13T15:31:00`; no time → midnight. */
function isoDateTime(date: string, time: string | null | undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const hm = /^\d{2}:\d{2}(:\d{2})?$/.test(time ?? "") ? time! : "00:00";
  return `${date}T${hm.length === 5 ? `${hm}:00` : hm}`;
}

function round(value: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/* ── Shapefile (PointZ) ──
   Geometry is lat/lon tagged NAD83(2011) — the same datum the CSV's State Plane
   coordinates are computed in (see NAD83_2011 in survey.ts), so the shapefile
   lines up with the CSV/Civil 3D points. Z is the elevation. */

const PRJ_NAD83_2011 =
  'GEOGCS["GCS_NAD_1983_2011",DATUM["D_NAD_1983_2011",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

interface DbfField {
  name: string;
  type: "N" | "C";
  length: number;
  decimals: number;
}

const DBF_FIELDS: DbfField[] = [
  { name: "Field1", type: "C", length: 254, decimals: 0 },  // name (join key to the GeoJSON's Name)
  { name: "Field2", type: "N", length: 19, decimals: 11 },  // latitude
  { name: "Field3", type: "N", length: 19, decimals: 11 },  // longitude
  { name: "Field4", type: "N", length: 19, decimals: 11 },  // elevation (also Z)
  { name: "Northing", type: "N", length: 19, decimals: 3 },
  { name: "Easting", type: "N", length: 19, decimals: 3 },
];

export interface ShapefileParts {
  shp: Blob;
  shx: Blob;
  dbf: Blob;
  prj: Blob;
  cpg: Blob;
}

export function buildShapefile(project: ExportProject, layouts: PointLayout[]): ShapefileParts {
  const epsg = project.coordinateSystemEpsg!;
  const n = layouts.length;
  const xs = layouts.map((l) => l.point.lng);
  const ys = layouts.map((l) => l.point.lat);
  const zs = layouts.map((l) => l.point.elevation ?? 0);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const zRange = [Math.min(...zs), Math.max(...zs)];

  // PointZ record content: type + X, Y, Z, M = 36 bytes = 18 words.
  const contentWords = 18;
  const shpWords = 50 + n * (4 + contentWords);
  const shxWords = 50 + n * 4;

  const shp = new DataView(new ArrayBuffer(shpWords * 2));
  const shx = new DataView(new ArrayBuffer(shxWords * 2));
  writeShpHeader(shp, shpWords, bbox, zRange);
  writeShpHeader(shx, shxWords, bbox, zRange);

  let offset = 100;
  for (let i = 0; i < n; i++) {
    shx.setInt32(100 + i * 8, offset / 2, false);
    shx.setInt32(104 + i * 8, contentWords, false);

    shp.setInt32(offset, i + 1, false);
    shp.setInt32(offset + 4, contentWords, false);
    shp.setInt32(offset + 8, 11, true); // PointZ
    shp.setFloat64(offset + 12, xs[i], true);
    shp.setFloat64(offset + 20, ys[i], true);
    shp.setFloat64(offset + 28, zs[i], true);
    shp.setFloat64(offset + 36, 0, true); // M
    offset += 8 + contentWords * 2;
  }

  const rows = layouts.map(({ point, name }) => {
    const { easting, northing } = projectCoordinate(point.lat, point.lng, epsg);
    return [name, point.lat, point.lng, point.elevation ?? null, northing, easting];
  });

  return {
    shp: new Blob([shp.buffer], { type: "application/octet-stream" }),
    shx: new Blob([shx.buffer], { type: "application/octet-stream" }),
    dbf: new Blob([buildDbf(DBF_FIELDS, rows)], { type: "application/octet-stream" }),
    prj: new Blob([PRJ_NAD83_2011], { type: "text/plain" }),
    cpg: new Blob(["UTF-8"], { type: "text/plain" }),
  };
}

function writeShpHeader(view: DataView, words: number, bbox: number[], zRange: number[]) {
  view.setInt32(0, 9994, false);
  view.setInt32(24, words, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 11, true); // PointZ
  bbox.forEach((v, i) => view.setFloat64(36 + i * 8, v, true));
  view.setFloat64(68, zRange[0], true);
  view.setFloat64(76, zRange[1], true);
  // Mmin / Mmax at 84 / 92 stay 0.
}

function buildDbf(fields: DbfField[], rows: (string | number | null)[][]): Uint8Array {
  const encoder = new TextEncoder();
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);

  const now = new Date();
  bytes[0] = 0x03;
  bytes[1] = now.getFullYear() - 1900;
  bytes[2] = now.getMonth() + 1;
  bytes[3] = now.getDate();
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, i) => {
    const at = 32 + i * 32;
    bytes.set(encoder.encode(field.name).slice(0, 10), at);
    bytes[at + 11] = field.type.charCodeAt(0);
    bytes[at + 16] = field.length;
    bytes[at + 17] = field.decimals;
  });
  bytes[headerLength - 1] = 0x0d;

  let at = headerLength;
  for (const row of rows) {
    bytes[at++] = 0x20; // not deleted
    fields.forEach((field, i) => {
      const value = row[i];
      let cell: Uint8Array;
      if (field.type === "N") {
        const text = value == null || !Number.isFinite(Number(value)) ? "" : Number(value).toFixed(field.decimals);
        cell = encoder.encode(text.padStart(field.length, " ").slice(-field.length));
      } else {
        cell = truncateUtf8(encoder.encode(value == null ? "" : String(value)), field.length);
      }
      bytes.fill(0x20, at, at + field.length);
      bytes.set(cell, at);
      at += field.length;
    });
  }
  bytes[at] = 0x1a;
  return bytes;
}

/** Cut to `max` bytes without splitting a multi-byte UTF-8 character. */
function truncateUtf8(bytes: Uint8Array, max: number) {
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.slice(0, end);
}
