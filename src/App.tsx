import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import { uploadData, getUrl, remove } from "aws-amplify/storage";
import type { Schema } from "../amplify/data/resource";
import MapPicker from "./MapPicker";
import type { PointMarker, FocusTarget } from "./MapPicker";
import PlaceAutocompleteInput from "./PlaceAutocompleteInput";
import ProjectPicker from "./ProjectPicker";
import type { ProjectSummary, Role } from "./ProjectPicker";
import { CoordinateSettingsModal, ExportPointsModal } from "./SurveyModals";
import "./App.css";

const client = generateClient<Schema>();

const MST_TZ = "America/Denver";
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatTimeDisplay(date: string, time: string, _creatorTz?: string | null): string {
  if (!time) return "";
  const dt = new Date(`${date}T${time}`);

  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: tz,
    }).format(dt);

  const viewerTime = fmt(VIEWER_TZ);
  if (VIEWER_TZ === MST_TZ) return viewerTime;
  const mstTime = fmt(MST_TZ);
  return `${viewerTime} (${mstTime} MT)`;
}

// Categories from category.csv (Category,Color)
const CATEGORIES = [
  { name: "Water", color: "#1d4ed8" },
  { name: "Sewer",  color: "#7c3aed" },
  { name: "Well",   color: "#ca8a04" },
];

const DEFAULT_CATEGORY_COLOR = "#e11d48";
function getCategoryColor(category: string | null | undefined): string {
  if (!category) return DEFAULT_CATEGORY_COLOR;
  return CATEGORIES.find((c) => c.name === category)?.color ?? DEFAULT_CATEGORY_COLOR;
}

const VIDEO_RE = /\.(mp4|mov|webm|avi|mkv|m4v|ogv)$/i;

function isVideoKey(key: string): boolean {
  return VIDEO_RE.test(key);
}

function filenameFromKey(key: string): string {
  const last = key.split("/").pop() ?? "download";
  return last.replace(/^\d+-(\d+-)?/, "");
}

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface CreateFormData {
  date: string;
  time: string;
  location: string;
  description: string;
  pointNumber: string;
  elevation: string;
}

interface DetailFormData {
  date: string;
  time: string;
  location: string;
  lng: string;
  lat: string;
  description: string;
  pointNumber: string;
  elevation: string;
}

const emptyDetail: DetailFormData = {
  date: "", time: "", location: "", lng: "", lat: "", description: "", pointNumber: "", elevation: "",
};

function App() {
  const { user, signOut } = useAuthenticator((context) => [context.user]);

  // ── Role + project grants (from Cognito token custom attributes) ──
  // Set per-user in AWS Console: custom:role ("master"|"worker"|"field_worker")
  // and custom:projects (comma-separated project IDs; empty for master).
  const [role, setRole] = useState<Role>("field_worker");
  const [allowedProjectIds, setAllowedProjectIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await fetchAuthSession();

        if (cancelled) return;
        // TEMP: role check disabled — everyone gets master access
        setRole("master");
        setAllowedProjectIds([]);
      } catch {
        // If the session can't be read, default to most-restrictive role.
        if (!cancelled) setRole("field_worker");
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [points, setPoints] = useState<Schema["Point"]["type"][]>([]);
  const [loading, setLoading] = useState(true);

  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);

  // ── Create modal ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormData>({
    date: "", time: "", location: "", description: "", pointNumber: "", elevation: "",
  });
  const [createLat, setCreateLat] = useState("");
  const [createLng, setCreateLng] = useState("");
  const [createFocus, setCreateFocus] = useState<FocusTarget | null>(null);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  function openCreate() {
    const nextPointNumber = points.reduce((max, point) => Math.max(max, point.pointNumber ?? 0), 0) + 1;
    setCreateForm({ date: nowDate(), time: nowTime(), location: "", description: "", pointNumber: String(nextPointNumber), elevation: "" });
    setCreateLat("");
    setCreateLng("");
    setCreateFocus(null);
    setCreateFiles([]);
    setCreateBusy(false);
    setCreateOpen(true);
  }

  function closeCreate() {
    if (createBusy) return;
    setCreateOpen(false);
  }

  function handleCreateChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setCreateForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleCreateCoordChange(lat: string, lng: string) {
    setCreateLat(lat);
    setCreateLng(lng);
  }

  /** A place picked from the Location suggestions: drop the marker there and pan the mini-map to it. */
  function handleCreatePlaceSelect(place: { lat: number; lng: number }) {
    setCreateLat(place.lat.toFixed(6));
    setCreateLng(place.lng.toFixed(6));
    setCreateFocus({ lat: place.lat, lng: place.lng, nonce: Date.now() });
  }

  function handleCreateFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setCreateFiles((prev) => [...prev, ...files]);
  }

  function handleCreateRemoveFile(index: number) {
    setCreateFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        setCreateLat(lat);
        setCreateLng(lng);
        setCreateFocus({ lat: pos.coords.latitude, lng: pos.coords.longitude, nonce: Date.now() });
      },
      () => alert("Could not get your location.")
    );
  }

  async function handleCreateSubmit() {
    let lat = parseFloat(createLat);
    let lng = parseFloat(createLng);

    if (!createLat || !createLng || isNaN(lat) || isNaN(lng)) {
      const useGPS = window.confirm("No location set. Use your current GPS location?");
      if (useGPS) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject)
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          alert("Could not get your location. Please click the map to set a point.");
          return;
        }
      } else {
        return;
      }
    }

    const pointNumber = parseInt(createForm.pointNumber, 10);
    if (!Number.isInteger(pointNumber) || pointNumber <= 0) {
      alert("Enter a valid positive point number.");
      return;
    }
    if (points.some((point) => point.pointNumber === pointNumber)) {
      alert(`Point number ${pointNumber} is already used in this project.`);
      return;
    }
    const elevation = createForm.elevation.trim() === "" ? undefined : parseFloat(createForm.elevation);
    if (elevation !== undefined && !Number.isFinite(elevation)) {
      alert("Enter a valid elevation or leave it blank.");
      return;
    }

    setCreateBusy(true);
    try {
      const { data: newPoint } = await client.models.Point.create({
        date: createForm.date,
        time: createForm.time,
        location: createForm.location,
        description: createForm.description,
        pointNumber,
        elevation,
        lat,
        lng,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        photos: [],
        projectId: selectedProject?.id ?? undefined,
      });

      if (newPoint && createFiles.length > 0) {
        const keys: string[] = [];
        for (let i = 0; i < createFiles.length; i++) {
          const file = createFiles[i];
          const key = `point-photos/${newPoint.id}/${Date.now()}-${i}-${file.name}`;
          await uploadData({ path: key, data: file }).result;
          keys.push(key);
        }
        await client.models.Point.update({ id: newPoint.id, photos: keys });
      }

      setCreateOpen(false);
      await fetchPoints();
    } catch (err) {
      alert(`Failed to create point: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCreateBusy(false);
    }
  }

  // ── Attribute editor (opened by clicking a point on the map or Edit button) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailFormData>(emptyDetail);
  const [detailPhotos, setDetailPhotos] = useState<string[]>([]);
  const [detailComments, setDetailComments] = useState<string[]>([]);
  const [detailCategory, setDetailCategory] = useState("");
  const [newComment, setNewComment] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedProject) fetchPoints();
  }, [selectedProject]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        detailPhotos.map(async (key) => {
          const { url } = await getUrl({ path: key });
          return [key, url.toString()] as const;
        })
      );
      if (!cancelled) setPhotoUrls(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [detailPhotos]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowLeft") lightboxPrev();
      else if (e.key === "ArrowRight") lightboxNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, detailPhotos.length]);

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedId) ?? null,
    [points, selectedId]
  );

  function openDetail(id: string) {
    const point = points.find((p) => p.id === id);
    if (!point) return;
    setSelectedId(id);
    setDetail({
      date: point.date,
      time: point.time ?? "",
      location: point.location ?? "",
      lng: String(point.lng),
      lat: String(point.lat),
      description: point.description ?? "",
      pointNumber: point.pointNumber == null ? "" : String(point.pointNumber),
      elevation: point.elevation == null ? "" : String(point.elevation),
    });
    setDetailPhotos((point.photos ?? []).filter((p): p is string => !!p));
    setDetailComments((point.comments ?? []).filter((c): c is string => !!c));
    setDetailCategory(point.category ?? "");
    setNewComment("");
    setPendingFiles([]);
    setUploadMsg(null);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetailPhotos([]);
    setDetailComments([]);
    setDetailCategory("");
    setNewComment("");
    setPhotoUrls({});
    setPendingFiles([]);
    setUploadMsg(null);
    setLightboxIndex(null);
  }

  function lightboxPrev() {
    setLightboxIndex((cur) =>
      cur === null ? null : (cur - 1 + detailPhotos.length) % detailPhotos.length
    );
  }

  function lightboxNext() {
    setLightboxIndex((cur) =>
      cur === null ? null : (cur + 1) % detailPhotos.length
    );
  }

  async function handleDownload() {
    if (lightboxIndex === null) return;
    const key = detailPhotos[lightboxIndex];
    const url = photoUrls[key];
    if (!url) return;
    setBusy(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const suggestedName = filenameFromKey(key);

      const picker = (
        window as unknown as {
          showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<{
            createWritable: () => Promise<{
              write: (data: Blob) => Promise<void>;
              close: () => Promise<void>;
            }>;
          }>;
        }
      ).showSaveFilePicker;

      if (picker) {
        try {
          const handle = await picker({ suggestedName });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (err) {
          if ((err as DOMException)?.name === "AbortError") return;
          console.warn("Save picker failed, falling back to download:", err);
        }
      }

      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error("Download failed, opening in new tab:", err);
      window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  async function handleLightboxDelete() {
    if (lightboxIndex === null) return;
    const key = detailPhotos[lightboxIndex];
    const remaining = detailPhotos.length - 1;
    setBusy(true);
    await remove({ path: key }).catch(() => {});
    setDetailPhotos((prev) => prev.filter((k) => k !== key));
    setBusy(false);
    setLightboxIndex(remaining <= 0 ? null : Math.min(lightboxIndex, remaining - 1));
  }

  function handleDetailChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setDetail({ ...detail, [e.target.name]: e.target.value });
  }

  async function handleApply() {
    if (!selectedId) return;
    const pointNumber = parseInt(detail.pointNumber, 10);
    if (!Number.isInteger(pointNumber) || pointNumber <= 0) {
      alert("Enter a valid positive point number.");
      return;
    }
    if (points.some((point) => point.id !== selectedId && point.pointNumber === pointNumber)) {
      alert(`Point number ${pointNumber} is already used in this project.`);
      return;
    }
    const elevation = detail.elevation.trim() === "" ? null : parseFloat(detail.elevation);
    if (elevation !== null && !Number.isFinite(elevation)) {
      alert("Enter a valid elevation or leave it blank.");
      return;
    }
    setBusy(true);
    await client.models.Point.update({
      id: selectedId,
      date: detail.date,
      time: detail.time,
      location: detail.location,
      description: detail.description,
      pointNumber,
      elevation,
      photos: detailPhotos,
      comments: detailComments,
      category: detailCategory || null,
    });
    setBusy(false);
    closeDetail();
    await fetchPoints();
  }

  async function handleDeleteSelected() {
    if (!selectedId) return;
    const label = detail.location ? `"${detail.location}"` : "this";
    if (!window.confirm(`Are you sure you want to delete the ${label} point?`)) return;
    setBusy(true);
    await Promise.all(detailPhotos.map((path) => remove({ path }).catch(() => {})));
    await client.models.Point.delete({ id: selectedId });
    setBusy(false);
    closeDetail();
    await fetchPoints();
  }

  function handlePhotosPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...files]);
    setUploadMsg(null);
  }

  function handleRemovePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (!selectedId || pendingFiles.length === 0) return;
    setBusy(true);
    setUploadMsg(null);
    try {
      const newKeys: string[] = [];
      for (let i = 0; i < pendingFiles.length; i++) {
        const file = pendingFiles[i];
        const key = `point-photos/${selectedId}/${Date.now()}-${i}-${file.name}`;
        await uploadData({ path: key, data: file }).result;
        newKeys.push(key);
      }
      const count = newKeys.length;
      setDetailPhotos((prev) => [...prev, ...newKeys]);
      setPendingFiles([]);
      setUploadMsg({
        ok: true,
        text: `${count} photo${count > 1 ? "s" : ""} uploaded successfully.`,
      });
    } catch (err) {
      console.error("Photo upload failed:", err);
      setUploadMsg({
        ok: false,
        text: `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePhoto(key: string) {
    setBusy(true);
    await remove({ path: key }).catch(() => {});
    setDetailPhotos((prev) => prev.filter((k) => k !== key));
    setBusy(false);
  }

  async function fetchPoints() {
    setLoading(true);
    const { data: items, errors } = await client.models.Point.list(
      selectedProject ? { filter: { projectId: { eq: selectedProject.id } } } : {}
    );
    if (!errors) setPoints(items);
    setLoading(false);
  }

  async function handleDelete(id: string, locationName?: string | null) {
    const label = locationName ? `"${locationName}"` : "this";
    if (!window.confirm(`Are you sure you want to delete the ${label} point?`)) return;
    await client.models.Point.delete({ id });
    await fetchPoints();
  }

  function zoomToPoint(p: { lat: number; lng: number }) {
    setFocusTarget({ lat: p.lat, lng: p.lng, nonce: Date.now() });
  }

  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "az" | "za">("newest");
  const [searchName, setSearchName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPointIds, setSelectedPointIds] = useState<Set<string>>(new Set());
  const [clearSelectionNonce, setClearSelectionNonce] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [coordinateSettingsOpen, setCoordinateSettingsOpen] = useState(false);

  const selectedExportPoints = useMemo(
    () =>
      points
        .filter((point) => selectedPointIds.has(point.id))
        .map((point) => ({
          id: point.id,
          date: point.date,
          location: point.location ?? null,
          description: point.description ?? null,
          lat: point.lat,
          lng: point.lng,
          pointNumber: point.pointNumber ?? null,
          elevation: point.elevation ?? null,
          photoKeys: (point.photos ?? []).filter((key): key is string => !!key),
        })),
    [points, selectedPointIds]
  );

  function togglePointSelection(id: string) {
    setSelectedPointIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearPointSelection() {
    setSelectedPointIds(new Set());
    setClearSelectionNonce((value) => value + 1);
  }

  async function saveCoordinateSettings(values: {
    coordinateSystemEpsg: string;
    coordinateSystemName: string;
    coordinateUnits: string;
    coordinateSystemConfirmed: boolean;
    verticalDatum?: string;
    elevationUnits: string;
  }) {
    if (!selectedProject) return;
    const { data, errors } = await client.models.Project.update({ id: selectedProject.id, ...values });
    if (errors?.length || !data) throw new Error("Could not save coordinate settings.");
    setSelectedProject({
      ...selectedProject,
      coordinateSystemEpsg: data.coordinateSystemEpsg ?? null,
      coordinateSystemName: data.coordinateSystemName ?? null,
      coordinateUnits: data.coordinateUnits ?? null,
      coordinateSystemConfirmed: data.coordinateSystemConfirmed ?? false,
      verticalDatum: data.verticalDatum ?? null,
      elevationUnits: data.elevationUnits ?? null,
    });
    setCoordinateSettingsOpen(false);
  }

  // Filtering only — the single source of truth for "which points pass."
  // Consumed by both the list (after sorting) and the main map.
  const filteredPoints = useMemo(() => {
    let copy = [...points];

    if (searchName.trim()) {
      const q = searchName.trim().toLowerCase();
      copy = copy.filter(
        (p) =>
          (p.location ?? "").toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q)
      );
    }

    if (dateFrom) copy = copy.filter((p) => p.date >= dateFrom);
    if (dateTo) copy = copy.filter((p) => p.date <= dateTo);

    if (activeCategories.size > 0) {
      copy = copy.filter((p) => activeCategories.has(p.category ?? "__none__"));
    }

    return copy;
  }, [points, searchName, dateFrom, dateTo, activeCategories]);

  // Sorting applied on top of the filtered set, for list display only.
  const sortedPoints = useMemo(() => {
    const copy = [...filteredPoints];
    if (sortOrder === "newest") copy.sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
    if (sortOrder === "oldest") copy.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
    if (sortOrder === "az") copy.sort((a, b) => (a.location ?? "").localeCompare(b.location ?? ""));
    if (sortOrder === "za") copy.sort((a, b) => (b.location ?? "").localeCompare(a.location ?? ""));
    return copy;
  }, [filteredPoints, sortOrder]);

  // Markers for the main map — respects the active filters (date + search).
  const pointMarkers: PointMarker[] = useMemo(
    () => filteredPoints.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, location: p.location, color: getCategoryColor(p.category) })),
    [filteredPoints]
  );

  // Markers for the create-modal map — always shows every point as reference.
  const allPointMarkers: PointMarker[] = useMemo(
    () => points.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, location: p.location, color: getCategoryColor(p.category) })),
    [points]
  );

  // The main map needs a no-op coord change handler since we removed the top form.
  const noopCoordChange = useCallback(() => {}, []);

  // ── Project selection gate ──
  // Until a project is chosen, show the role-aware project picker instead of the map.
  if (!selectedProject) {
    return (
      <ProjectPicker
        role={role}
        allowedProjectIds={allowedProjectIds}
        userEmail={user?.signInDetails?.loginId ?? ""}
        onSignOut={signOut}
        onChoose={setSelectedProject}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src="/bai-engineers-logo.png" alt="Bai Engineers" className="header-logo" />
          <h1>Bai Tracker</h1>
          {selectedProject && (
            <span className="header-project">{selectedProject.name}</span>
          )}
        </div>
        <div className="header-user">
          <button className="btn btn-secondary btn-small" onClick={() => setSelectedProject(null)}>
            Switch project
          </button>
          {role === "master" && (
            <button className="btn btn-secondary btn-small" onClick={() => setCoordinateSettingsOpen(true)}>
              Coordinate settings
            </button>
          )}
          <span className="header-email">{user?.signInDetails?.loginId}</span>
          <button className="btn btn-secondary btn-small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        <section className="map-section">
          <MapPicker
            lat=""
            lng=""
            points={pointMarkers}
            onCoordChange={noopCoordChange}
            onPointSelect={openDetail}
            focusTarget={focusTarget}
            center={{ lat: selectedProject.lat, lng: selectedProject.lng }}
            zoom={selectedProject.zoom ?? undefined}
            allowPointPlacement={false}
            selectionMode={selectionMode}
            selectedPointIds={selectedPointIds}
            onSelectionChange={(ids) => {
              setSelectedPointIds(new Set(ids));
              setSelectionMode(false);
            }}
            onPointToggle={togglePointSelection}
            onToggleSelectionMode={() => setSelectionMode((value) => !value)}
            clearSelectionNonce={clearSelectionNonce}
          />
          {selectedPointIds.size > 0 && (
            <div className="selection-panel">
              <div className="selection-panel-header">
                <span>{selectedPointIds.size} point{selectedPointIds.size === 1 ? "" : "s"} selected</span>
                <button
                  className="attr-close"
                  onClick={clearPointSelection}
                  aria-label="Clear selection"
                  title="Clear selection"
                >×</button>
              </div>
              <div className="selection-panel-list">
                {points
                  .filter((p) => selectedPointIds.has(p.id))
                  .map((p) => (
                    <div key={p.id} className="selection-panel-item">
                      <span
                        className="selection-panel-dot"
                        style={{ background: getCategoryColor(p.category) }}
                        title={p.category || "Uncategorized"}
                      />
                      <span className="selection-panel-name">{p.location || `Point ${p.pointNumber}`}</span>
                      <span className="selection-panel-date">{p.date}</span>
                    </div>
                  ))}
              </div>
              <div className="selection-panel-footer">
                <button
                  className="btn btn-primary"
                  onClick={() => setExportOpen(true)}
                  disabled={!selectedProject.coordinateSystemConfirmed}
                  title={!selectedProject.coordinateSystemConfirmed ? "Confirm the project coordinate system first" : "Export selected points"}
                >
                  Export
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="list-section">
          {!selectedProject.coordinateSystemConfirmed && (
            <div className="coordinate-warning">
              <span>Export requires a confirmed project coordinate system.</span>
              {role === "master" && (
                <button className="btn btn-secondary btn-small" onClick={() => setCoordinateSettingsOpen(true)}>
                  Configure now
                </button>
              )}
            </div>
          )}
          <div className="list-header">
            <h2>Points ({sortedPoints.length}{sortedPoints.length !== points.length ? ` of ${points.length}` : ""})</h2>
            <div className="list-header-right">
              <select
                className="sort-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="az">Location A–Z</option>
                <option value="za">Location Z–A</option>
              </select>
              <button className="btn btn-primary btn-create" onClick={openCreate}>
                + Create Point
              </button>
            </div>
          </div>

          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              placeholder="Search by name or description…"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />
            <div className="search-date-range">
              <input
                type="date"
                className="search-input search-date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="search-date-sep">to</span>
              <input
                type="date"
                className="search-input search-date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="category-filter">
              <button
                className="btn btn-secondary btn-small category-filter-btn"
                onClick={() => setCategoryFilterOpen((v) => !v)}
              >
                Filter Categories
                {activeCategories.size > 0 && (
                  <span className="category-filter-badge">{activeCategories.size}</span>
                )}
              </button>

              {categoryFilterOpen && (
                <>
                  <div className="category-filter-overlay" onClick={() => setCategoryFilterOpen(false)} />
                  <div className="category-filter-dropdown">
                    {CATEGORIES.map((c) => {
                      const checked = activeCategories.has(c.name);
                      return (
                        <label key={c.name} className="category-check" style={{ borderColor: checked ? c.color : undefined }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setActiveCategories((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.name)) next.delete(c.name);
                                else next.add(c.name);
                                return next;
                              });
                            }}
                          />
                          <span className="category-check-dot" style={{ background: c.color }} />
                          <span className="category-check-label">{c.name}</span>
                        </label>
                      );
                    })}
                    <label className="category-check" style={{ borderColor: activeCategories.has("__none__") ? DEFAULT_CATEGORY_COLOR : undefined }}>
                      <input
                        type="checkbox"
                        checked={activeCategories.has("__none__")}
                        onChange={() => {
                          setActiveCategories((prev) => {
                            const next = new Set(prev);
                            if (next.has("__none__")) next.delete("__none__");
                            else next.add("__none__");
                            return next;
                          });
                        }}
                      />
                      <span className="category-check-dot" style={{ background: DEFAULT_CATEGORY_COLOR }} />
                      <span className="category-check-label">Uncategorized</span>
                    </label>
                    {activeCategories.size > 0 && (
                      <button
                        className="category-filter-clear"
                        onClick={() => setActiveCategories(new Set())}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            {(searchName || dateFrom || dateTo || activeCategories.size > 0) && (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => { setSearchName(""); setDateFrom(""); setDateTo(""); setActiveCategories(new Set()); }}
              >
                Clear
              </button>
            )}
          </div>

          {loading ? (
            <p className="loading">Loading…</p>
          ) : sortedPoints.length === 0 ? (
            <p className="empty">{points.length === 0 ? "No points yet. Create one above." : "No points match your search."}</p>
          ) : (
            <div className="point-grid">
              {sortedPoints.map((p) => (
                <div key={p.id} className={selectedPointIds.has(p.id) ? "point-card point-card-selected" : "point-card"} style={{ borderLeft: `4px solid ${selectedPointIds.has(p.id) ? "#22c55e" : getCategoryColor(p.category)}` }}>
                  <div className="point-card-header">
                    <span className="point-number">{p.pointNumber == null ? "No point #" : `Point ${p.pointNumber}`}</span>
                    <span className="point-date">{p.date}</span>
                    <span className="point-time">{formatTimeDisplay(p.date, p.time ?? "", p.timezone)}</span>
                  </div>
                  <h3>{p.location}</h3>
                  <p className="point-desc">{p.description}</p>
                  <div className="point-card-actions">
                    <button className="btn btn-small btn-zoom" onClick={() => zoomToPoint(p)}>
                      Locate me
                    </button>
                    <button className="btn btn-small btn-edit" onClick={() => openDetail(p.id)}>
                      Edit
                    </button>
                    <button className="btn btn-small btn-delete" onClick={() => handleDelete(p.id, p.location)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Create Point modal ── */}
      {createOpen && (
        <div className="attr-overlay" onClick={closeCreate}>
          <div className="create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="attr-window-header">
              <h2>Create Point</h2>
              <button
                type="button"
                className="attr-close"
                title="Close"
                onClick={closeCreate}
                disabled={createBusy}
              >
                ×
              </button>
            </div>

            <div className="create-fields">
              <div className="create-row">
                <label>
                  Date
                  <input
                    name="date"
                    type="date"
                    value={createForm.date}
                    onChange={handleCreateChange}
                    required
                  />
                </label>
                <label>
                  Time
                  <input
                    name="time"
                    type="time"
                    value={createForm.time}
                    onChange={handleCreateChange}
                    required
                  />
                </label>
              </div>

              <div className="create-row">
                <label>
                  Point number
                  <input
                    name="pointNumber"
                    type="number"
                    min="1"
                    step="1"
                    value={createForm.pointNumber}
                    onChange={handleCreateChange}
                    required
                  />
                </label>
                <label>
                  Elevation (optional)
                  <input
                    name="elevation"
                    type="number"
                    step="any"
                    value={createForm.elevation}
                    onChange={handleCreateChange}
                    placeholder="Unknown"
                  />
                </label>
              </div>

              <label>
                Location
                <PlaceAutocompleteInput
                  name="location"
                  placeholder="e.g. Central Park, NYC"
                  value={createForm.location}
                  required
                  disabled={createBusy}
                  biasCenter={selectedProject ? { lat: selectedProject.lat, lng: selectedProject.lng } : null}
                  onChange={(text) => setCreateForm((prev) => ({ ...prev, location: text }))}
                  onPlaceSelect={handleCreatePlaceSelect}
                />
              </label>

              <label>
                Description
                <textarea
                  name="description"
                  placeholder="Describe this point…"
                  value={createForm.description}
                  onChange={handleCreateChange}
                  rows={2}
                />
              </label>
            </div>

            <div className="create-map-section">
              <div className="create-map-label">
                <span>
                  {createLat && createLng
                    ? `${parseFloat(createLat).toFixed(5)}, ${parseFloat(createLng).toFixed(5)}`
                    : "Click the map or use your location"}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={useMyLocation}
                  disabled={createBusy}
                >
                  Use My Location
                </button>
              </div>
              <div className="mini-map-wrap">
                <MapPicker
                  lat={createLat}
                  lng={createLng}
                  points={allPointMarkers}
                  onCoordChange={handleCreateCoordChange}
                  onMarkerCancel={() => { setCreateLat(""); setCreateLng(""); }}
                  focusTarget={createFocus}
                />
              </div>
            </div>

            {createFiles.length > 0 && (
              <div className="attr-pending">
                <p className="attr-pending-title">
                  {createFiles.length} file{createFiles.length > 1 ? "s" : ""} queued:
                </p>
                <ul>
                  {createFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className="attr-pending-remove"
                        onClick={() => handleCreateRemoveFile(i)}
                        disabled={createBusy}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <input
              ref={createFileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handleCreateFilesPicked}
            />

            <div className="attr-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => createFileRef.current?.click()}
                disabled={createBusy}
              >
                Photo/Video
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeCreate}
                disabled={createBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateSubmit}
                disabled={createBusy}
              >
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit / attribute modal ── */}
      {selectedPoint && (
        <div className="attr-overlay" onClick={closeDetail}>
          <div className="attr-window" onClick={(e) => e.stopPropagation()}>
            <div className="attr-window-header">
              <h2>Point Details</h2>
              <button
                type="button"
                className="attr-close"
                title="Close"
                onClick={closeDetail}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <label>
              Date
              <input name="date" type="date" value={detail.date} onChange={handleDetailChange} />
            </label>

            <label>
              Time
              <input name="time" type="time" value={detail.time} onChange={handleDetailChange} />
            </label>

            <div className="detail-survey-row">
              <label>
                Point number
                <input name="pointNumber" type="number" min="1" step="1" value={detail.pointNumber} onChange={handleDetailChange} />
              </label>
              <label>
                Elevation (optional)
                <input name="elevation" type="number" step="any" value={detail.elevation} onChange={handleDetailChange} placeholder="Unknown" />
              </label>
            </div>

            <label>
              Location
              <input name="location" type="text" value={detail.location} onChange={handleDetailChange} />
            </label>

            <label>
              Description
              <textarea name="description" value={detail.description} onChange={handleDetailChange} rows={3} />
            </label>

            <label>
              Category
              <select
                className="category-select"
                value={detailCategory}
                onChange={(e) => setDetailCategory(e.target.value)}
              >
                <option value="">— None —</option>
                {CATEGORIES.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>

            <div className="attr-photos">
              {detailPhotos.length === 0 ? (
                <p className="attr-photos-empty">No photos yet.</p>
              ) : (
                detailPhotos.map((key, index) => (
                  <div key={key} className="attr-photo">
                    {photoUrls[key] ? (
                      isVideoKey(key) ? (
                        <video
                          src={photoUrls[key]}
                          muted
                          onClick={() => setLightboxIndex(index)}
                          title="Click to enlarge"
                        />
                      ) : (
                        <img
                          src={photoUrls[key]}
                          alt="Point"
                          onClick={() => setLightboxIndex(index)}
                          title="Click to enlarge"
                        />
                      )
                    ) : (
                      <span className="attr-photo-loading">Loading…</span>
                    )}
                    <button
                      type="button"
                      className="attr-photo-remove"
                      title="Remove photo"
                      onClick={() => handleRemovePhoto(key)}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {pendingFiles.length > 0 && (
              <div className="attr-pending">
                <p className="attr-pending-title">
                  {pendingFiles.length} photo{pendingFiles.length > 1 ? "s" : ""} ready to upload:
                </p>
                <ul>
                  {pendingFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`}>
                      <span>{f.name}</span>
                      <button
                        type="button"
                        className="attr-pending-remove"
                        onClick={() => handleRemovePending(i)}
                        disabled={busy}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {uploadMsg && (
              <p className={uploadMsg.ok ? "attr-upload-msg" : "attr-upload-msg attr-upload-err"}>
                {uploadMsg.ok ? "✓ " : "⚠ "}
                {uploadMsg.text}
              </p>
            )}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={handlePhotosPicked}
            />

            <div className="attr-comments">
              <p className="attr-comments-title">Comments</p>
              {detailComments.length === 0 ? (
                <p className="attr-comments-empty">No comments yet.</p>
              ) : (
                <ul className="attr-comments-list">
                  {detailComments.map((c, i) => {
                    const [ts, author, ...msgParts] = c.split("|");
                    const msg = msgParts.join("|");
                    const date = new Date(ts).toLocaleString();
                    return (
                      <li key={i} className="attr-comment">
                        <div className="attr-comment-meta">{author} · {date}</div>
                        <div className="attr-comment-text">{msg}</div>
                        <button
                          className="attr-comment-delete"
                          title="Delete comment"
                          onClick={() => setDetailComments((prev) => prev.filter((_, j) => j !== i))}
                          disabled={busy}
                        >×</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="attr-comment-input-row">
                <input
                  type="text"
                  className="attr-comment-input"
                  placeholder="Add a comment…"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newComment.trim()) {
                      const entry = `${new Date().toISOString()}|${user?.signInDetails?.loginId ?? "unknown"}|${newComment.trim()}`;
                      setDetailComments((prev) => [...prev, entry]);
                      setNewComment("");
                    }
                  }}
                  disabled={busy}
                />
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => {
                    if (!newComment.trim()) return;
                    const entry = `${new Date().toISOString()}|${user?.signInDetails?.loginId ?? "unknown"}|${newComment.trim()}`;
                    setDetailComments((prev) => [...prev, entry]);
                    setNewComment("");
                  }}
                  disabled={busy}
                >
                  Post
                </button>
              </div>
            </div>

            <div className="attr-actions">
              <button className="btn btn-primary" onClick={handleApply} disabled={busy}>
                Apply
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => photoInputRef.current?.click()}
                disabled={busy}
              >
                Photo/Video
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={busy || pendingFiles.length === 0}
              >
                {busy && pendingFiles.length > 0 ? "Uploading…" : "Upload"}
              </button>
              <button className="btn btn-delete" onClick={handleDeleteSelected} disabled={busy}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {coordinateSettingsOpen && (
        <CoordinateSettingsModal
          project={selectedProject}
          onClose={() => setCoordinateSettingsOpen(false)}
          onSave={saveCoordinateSettings}
        />
      )}

      {exportOpen && (
        <ExportPointsModal
          project={selectedProject}
          points={selectedExportPoints}
          onClose={() => setExportOpen(false)}
        />
      )}

      {selectedPoint && lightboxIndex !== null && detailPhotos[lightboxIndex] && (
        <div className="lightbox-overlay" onClick={() => setLightboxIndex(null)}>
          <button className="lightbox-close" title="Close" onClick={() => setLightboxIndex(null)}>
            ×
          </button>

          {detailPhotos.length > 1 && (
            <button
              className="lightbox-nav lightbox-prev"
              title="Previous"
              onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
            >
              ‹
            </button>
          )}

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            {isVideoKey(detailPhotos[lightboxIndex]) ? (
              <video src={photoUrls[detailPhotos[lightboxIndex]]} controls autoPlay />
            ) : (
              <img src={photoUrls[detailPhotos[lightboxIndex]]} alt={`Photo ${lightboxIndex + 1}`} />
            )}
            <div className="lightbox-bar">
              <span className="lightbox-counter">
                {lightboxIndex + 1} / {detailPhotos.length}
              </span>
              <button className="btn btn-secondary" onClick={handleDownload} disabled={busy}>
                Download
              </button>
              <button className="btn btn-delete" onClick={handleLightboxDelete} disabled={busy}>
                Delete
              </button>
            </div>
          </div>

          {detailPhotos.length > 1 && (
            <button
              className="lightbox-nav lightbox-next"
              title="Next"
              onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
            >
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
