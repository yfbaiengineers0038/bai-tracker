import { useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "./ProjectPicker";
import type { ExportPoint } from "./exportPoints";
import { buildCsvText, exportSelectedPoints, safeFilename } from "./exportPoints";
import {
  ExportCanceledError,
  exportToDirectory,
  exportToZip,
  pickDirectory,
  supportsDirectoryPicker,
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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportMediaProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const mediaCount = points.reduce((sum, p) => sum + (p.photoKeys?.length ?? 0), 0);
  const canPickDir = supportsDirectoryPicker();

  async function runExport() {
    setBusy(true);
    setError("");
    setProgress(null);

    // CSV-only path (media off) — unchanged behavior.
    if (!includeMedia) {
      try {
        await exportSelectedPoints({ project, points, filename });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Media path — build the CSV once, then write the folder tree.
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const csvText = buildCsvText(project, points);

      if (canPickDir) {
        const rootHandle = await pickDirectory();
        if (!rootHandle) {
          // User dismissed the folder picker — treat as cancel, no error.
          return;
        }
        await exportToDirectory({
          project,
          points,
          csvText,
          signal: controller.signal,
          onProgress: setProgress,
          rootHandle,
        });
      } else {
        // Safari/Firefox: bundle the same tree into a ZIP download.
        await exportToZip({
          project,
          points,
          csvText,
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
          <input value={filename} onChange={(event) => setFilename(event.target.value)} disabled={busy || includeMedia} />
        </label>
        {includeMedia && (
          <p className="export-help export-help-note">
            With media on, a dated folder is created containing the CSV plus a subfolder per point with its photos and videos. The file name above applies only to the CSV-only export.
          </p>
        )}
        <div className="survey-export-facts">
          <div><span>Coordinate system</span><strong>EPSG:{project.coordinateSystemEpsg}</strong></div>
          <div><span>System</span><strong>{project.coordinateSystemName}</strong></div>
          <div><span>Units</span><strong>{unitsLabel(project.coordinateUnits)}</strong></div>
          <div><span>Elevation</span><strong>{project.elevationUnits || "Not specified"}</strong></div>
        </div>
        <div className="export-columns">
          <span className="export-columns-label">Columns</span>
          <code>Date, Name, X (Easting), Y (Northing), Z (Elevation)</code>
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
            disabled={busy || (!includeMedia && !filename.trim())}
          >
            {busy
              ? "Working…"
              : includeMedia
                ? (canPickDir ? "Export to folder" : "Export ZIP")
                : "Export CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}
