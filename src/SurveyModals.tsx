import { useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "./ProjectPicker";
import type { ExportPoint } from "./exportPoints";
import { safeFilename } from "./exportPoints";
import {
  ExportCanceledError,
  buildExportFiles,
  downloadExportFiles,
  exportToDirectory,
  exportToZip,
  pickDirectory,
  supportsDirectoryPicker,
  type ExportFormats,
  type ExportMediaProgress,
} from "./exportMedia";
import { coordinateOptionsForLocation, groupCoordinateOptions, unitsLabel } from "./survey";
import "./SurveyModals.css";

export function CoordinateSettingsModal({
  project,
  onClose,
  onSave,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onSave: (values: {
    coordinateSystemEpsg: string;
    coordinateSystemName: string;
    coordinateUnits: string;
    coordinateSystemConfirmed: boolean;
    verticalDatum?: string;
    elevationUnits: string;
  }) => Promise<void>;
}) {
  const options = useMemo(() => coordinateOptionsForLocation(project.lat, project.lng), [project.lat, project.lng]);
  const initial = options.some((option) => option.epsg === project.coordinateSystemEpsg)
    ? project.coordinateSystemEpsg!
    : options.find((option) => option.recommended)?.epsg ?? options[0]?.epsg ?? "";
  const [epsg, setEpsg] = useState(initial);
  const [verticalDatum, setVerticalDatum] = useState(project.verticalDatum ?? "");
  const [elevationUnits, setElevationUnits] = useState(project.elevationUnits ?? "us-ft");
  const [confirmed, setConfirmed] = useState(project.coordinateSystemConfirmed && epsg === project.coordinateSystemEpsg);
  const [busy, setBusy] = useState(false);
  const selected = options.find((option) => option.epsg === epsg);

  async function save() {
    if (!selected || !confirmed) return;
    setBusy(true);
    try {
      await onSave({
        coordinateSystemEpsg: selected.epsg,
        coordinateSystemName: selected.name,
        coordinateUnits: selected.units,
        coordinateSystemConfirmed: true,
        verticalDatum: verticalDatum.trim() || undefined,
        elevationUnits,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attr-overlay" onClick={onClose}>
      <div className="attr-window survey-modal" onClick={(event) => event.stopPropagation()}>
        <div className="attr-window-header">
          <div>
            <h2>Coordinate settings</h2>
            <p>{project.name}</p>
          </div>
          <button className="attr-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <div className="survey-notice">
          The recommendation uses the project location. Confirm it matches the coordinate system in the Civil 3D drawing.
        </div>
        <label>
          Coordinate system
          <select value={epsg} onChange={(event) => { setEpsg(event.target.value); setConfirmed(false); }}>
            {groupCoordinateOptions(options).map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.options.map((option) => (
                  <option key={option.epsg} value={option.epsg}>
                    {option.recommended ? "Recommended — " : ""}{option.name} (EPSG:{option.epsg})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="survey-system-summary">
          <span>EPSG:{selected?.epsg}</span>
          <span>{unitsLabel(selected?.units)}</span>
        </div>
        {selected?.civil3dName && (
          <p className="survey-civil3d-name">Civil 3D: <code>{selected.civil3dName}</code></p>
        )}
        <label>
          Vertical datum (optional)
          <input value={verticalDatum} onChange={(event) => setVerticalDatum(event.target.value)} placeholder="e.g. NAVD88" />
        </label>
        <label>
          Elevation units
          <select value={elevationUnits} onChange={(event) => setElevationUnits(event.target.value)}>
            <option value="us-ft">US survey feet</option>
            <option value="ft">International feet</option>
            <option value="m">Meters</option>
          </select>
        </label>
        <label className="survey-confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I confirm this is the coordinate system used by the project drawing.
        </label>
        <div className="attr-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !confirmed || !selected}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExportPointsModal({
  project,
  points,
  onClose,
}: {
  project: ProjectSummary;
  points: ExportPoint[];
  onClose: () => void;
}) {
  const [filename, setFilename] = useState(`${safeFilename(project.name)}-points`);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [formats, setFormats] = useState<ExportFormats>({ csv: true, shapefile: true, geojson: true });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportMediaProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const mediaCount = points.reduce((sum, p) => sum + (p.photoKeys?.length ?? 0), 0);
  const canPickDir = supportsDirectoryPicker();
  const anyFormat = formats.csv || formats.shapefile || formats.geojson;
  // Only a lone CSV or GeoJSON downloads unzipped; a shapefile is always five files.
  const singleFile = !includeMedia && !formats.shapefile && formats.csv !== formats.geojson;

  function toggleFormat(key: keyof ExportFormats, value: boolean) {
    setFormats((previous) => ({ ...previous, [key]: value }));
  }

  async function runExport() {
    setBusy(true);
    setError("");
    setProgress(null);

    // Data files only (media off) — one file downloads directly, several as a ZIP.
    if (!includeMedia) {
      try {
        const { rootFiles } = buildExportFiles(project, points, { formats, baseName: filename, includeMedia });
        await downloadExportFiles(rootFiles, filename);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Media path — build the data files once, then write the folder tree.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { layouts, rootFiles } = buildExportFiles(project, points, { formats, baseName: filename, includeMedia });

      if (canPickDir) {
        const rootHandle = await pickDirectory();
        if (!rootHandle) {
          // User dismissed the folder picker — treat as cancel, no error.
          return;
        }
        await exportToDirectory({
          project,
          layouts,
          rootFiles,
          signal: controller.signal,
          onProgress: setProgress,
          rootHandle,
        });
      } else {
        // Safari/Firefox: bundle the same tree into a ZIP download.
        await exportToZip({
          project,
          layouts,
          rootFiles,
          signal: controller.signal,
          onProgress: setProgress,
        });
      }
      onClose();
    } catch (err) {
      if (err instanceof ExportCanceledError) {
        // Clean cancel — reset without an error banner.
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  return (
    <div className="attr-overlay" onClick={onClose}>
      <div className="attr-window survey-modal export-modal" onClick={(event) => event.stopPropagation()}>
        <div className="attr-window-header">
          <div>
            <h2>Export selected points</h2>
            <p>{points.length} point{points.length === 1 ? "" : "s"} selected</p>
          </div>
          <button className="attr-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <label>
          File name
          <input value={filename} onChange={(event) => setFilename(event.target.value)} disabled={busy} />
        </label>
        {includeMedia && (
          <p className="export-help export-help-note">
            With media on, a dated folder is created containing the data files plus a subfolder per point (e.g. <code>Water-Meter-2</code>) with its photos and videos.
          </p>
        )}
        <div className="survey-export-facts">
          <div><span>Coordinate system</span><strong>EPSG:{project.coordinateSystemEpsg}</strong></div>
          <div><span>System</span><strong>{project.coordinateSystemName}</strong></div>
          <div><span>Units</span><strong>{unitsLabel(project.coordinateUnits)}</strong></div>
          <div><span>Elevation</span><strong>{project.elevationUnits || "Not specified"}</strong></div>
        </div>
        <div className="export-columns">
          <span className="export-columns-label">Formats</span>
          <label className="export-media-toggle">
            <input type="checkbox" checked={formats.csv} onChange={(event) => toggleFormat("csv", event.target.checked)} disabled={busy} />
            <span>
              CSV
              <span className="export-media-meta">Date, Name, X (Easting), Y (Northing), Z (Elevation)</span>
            </span>
          </label>
          <label className="export-media-toggle">
            <input type="checkbox" checked={formats.shapefile} onChange={(event) => toggleFormat("shapefile", event.target.checked)} disabled={busy} />
            <span>
              Shapefile (ArcMap / ArcGIS)
              <span className="export-media-meta">PointZ, NAD83(2011) lat/lon · Field1 name, Field2 lat, Field3 lon, Field4 elevation, Northing, Easting</span>
            </span>
          </label>
          <label className="export-media-toggle">
            <input type="checkbox" checked={formats.geojson} onChange={(event) => toggleFormat("geojson", event.target.checked)} disabled={busy} />
            <span>
              GeoJSON
              <span className="export-media-meta">WGS84 lat/lon with name, date, description, category, elevation, northing/easting and photo list</span>
            </span>
          </label>
        </div>
        <label className="export-media-toggle">
          <input
            type="checkbox"
            checked={includeMedia}
            onChange={(event) => setIncludeMedia(event.target.checked)}
            disabled={busy}
          />
          <span>
            Include photos &amp; videos
            <span className="export-media-meta">
              {mediaCount} file{mediaCount === 1 ? "" : "s"} across {points.length} point{points.length === 1 ? "" : "s"}
              {mediaCount > 0 && !canPickDir && " · your browser will download a ZIP"}
            </span>
          </span>
        </label>
        {busy && progress && (
          <div className="export-progress">
            <div className="export-progress-bar">
              <div
                className="export-progress-fill"
                style={{ width: `${progress.total ? Math.round((progress.fetched / progress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="export-progress-text">
              {progress.total === 0
                ? "Preparing…"
                : `Downloading media ${progress.fetched} / ${progress.total}${progress.current ? ` — ${progress.current}` : ""}`}
            </div>
          </div>
        )}
        {error && <div className="survey-error" role="alert">{error}</div>}
        <div className="attr-actions">
          {busy && includeMedia && (
            <button className="btn btn-secondary" onClick={cancelExport}>Cancel export</button>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          <button
            className="btn btn-primary"
            onClick={runExport}
            disabled={busy || !anyFormat || !filename.trim()}
          >
            {busy
              ? "Working…"
              : includeMedia
                ? (canPickDir ? "Export to folder" : "Export ZIP")
                : singleFile
                  ? (formats.csv ? "Export CSV" : "Export GeoJSON")
                  : "Export ZIP"}
          </button>
        </div>
      </div>
    </div>
  );
}
