import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  MapControl,
  ControlPosition,
  useMap,
  MapMouseEvent,
} from "@vis.gl/react-google-maps";
import "./MapPicker.css";

export interface FocusTarget {
  lat: number;
  lng: number;
  nonce: number; // changes each request so repeated clicks re-trigger
}

/** Pans/zooms the map whenever `target` changes. Must render inside <Map>. */
function MapFocuser({ target }: { target: FocusTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    map.setZoom(20);
  }, [map, target]);
  return null;
}

function LocateButton({ onLocate }: { onLocate: (pos: google.maps.LatLngLiteral, accuracy: number) => void }) {
  const map = useMap();
  const [busy, setBusy] = useState(false);

  function handleLocate() {
    if (!map) return;
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 0;
        map.panTo(loc);
        map.setZoom(18);
        onLocate(loc, accuracy);
        setBusy(false);
      },
      () => {
        alert("Could not get your location.");
        setBusy(false);
      }
    );
  }

  return (
    <MapControl position={ControlPosition.RIGHT_BOTTOM}>
      <button className="map-locate-btn" onClick={handleLocate} disabled={busy} title="My location">
        {busy ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8"><circle cx="12" cy="12" r="4"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
          </svg>
        )}
      </button>
    </MapControl>
  );
}

function SelectAreaButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <MapControl position={ControlPosition.RIGHT_TOP}>
      <button
        className={active ? "map-select-btn active" : "map-select-btn"}
        onClick={onToggle}
        title={active ? "Finish area selection" : "Select points by area"}
        aria-label="Select points by area"
        aria-pressed={active}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill={active ? "#fff" : "#1a73e8"} xmlns="http://www.w3.org/2000/svg">
          <rect x="5" y="5" width="14" height="14" rx="2" />
        </svg>
      </button>
    </MapControl>
  );
}

const BENT_NM = { lat: 33.1581, lng: -105.8572 };
const DEFAULT_ZOOM = 14;
/** Default geographic radius (meters) for circle markers when none is supplied. */
const DEFAULT_RADIUS_M = 1;

export interface PointMarker {
  id: string;
  lat: number;
  lng: number;
  location: string | null | undefined;
  color?: string;
  /** Geographic radius in meters for the rendered circle. Defaults to DEFAULT_RADIUS_M. */
  radius?: number;
}

interface MapPickerProps {
  lat: string;
  lng: string;
  points: PointMarker[];
  onCoordChange: (lat: string, lng: string) => void;
  onMarkerCancel?: () => void;
  onPointSelect?: (id: string) => void;
  focusTarget?: FocusTarget | null;
  /** Optional map center (e.g. the selected project's location). Falls back to lat/lng or BENT_NM. */
  center?: google.maps.LatLngLiteral;
  /** Optional default zoom. Falls back to DEFAULT_ZOOM. */
  zoom?: number;
  /** Enables two-corner rectangle selection instead of point placement. */
  selectionMode?: boolean;
  selectedPointIds?: Set<string>;
  onSelectionChange?: (ids: string[]) => void;
  onPointToggle?: (id: string) => void;
  onToggleSelectionMode?: () => void;
  clearSelectionNonce?: number;
  allowPointPlacement?: boolean;
}

/**
 * Renders a true geographic-radius circle via the native `google.maps.Circle`
 * overlay. Unlike CSS-sized markers, the circle's geometry is correct in world
 * space at every zoom level — so the anchor never appears to drift when zooming.
 *
 * Note: `google.maps.Circle` does NOT support dashed strokes. The draft state is
 * conveyed via color/fill-opacity/weight instead.
 */
function CircleMarker({
  center,
  radius,
  fillColor,
  strokeColor,
  fillOpacity = 0.5,
  strokeWeight = 2,
  clickable = true,
  onClick,
}: {
  center: google.maps.LatLngLiteral;
  radius: number;
  fillColor: string;
  strokeColor: string;
  fillOpacity?: number;
  strokeWeight?: number;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const map = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);
  const clickRef = useRef<google.maps.MapsEventListener | null>(null);

  // Create / destroy the underlying circle overlay when the map mounts/unmounts.
  useEffect(() => {
    if (!map) return;
    const c = new google.maps.Circle({ map, center, radius });
    circleRef.current = c;
    return () => { c.setMap(null); clickRef.current?.remove(); clickRef.current = null; };
  }, [map]);

  // Apply option changes when props update.
  useEffect(() => {
    const c = circleRef.current;
    if (!c) return;
    c.setCenter(center);
    c.setRadius(radius);
    c.setOptions({
      fillColor,
      fillOpacity,
      strokeColor,
      strokeWeight,
      strokeOpacity: 0.9,
      clickable,
    });
  }, [center, radius, fillColor, strokeColor, fillOpacity, strokeWeight, clickable]);

  // (Re)bind click handler when it changes.
  useEffect(() => {
    const c = circleRef.current;
    if (!c || !onClick) return;
    clickRef.current = c.addListener("click", onClick);
    return () => { clickRef.current?.remove(); clickRef.current = null; };
  }, [onClick]);

  return null;
}

/**
 * The user's current location, drawn in the Google Maps "blue dot" style:
 * a translucent accuracy halo (`CircleMarker`) plus a crisp centered dot
 * with a white ring and an animated "ping" pulse.
 */
function UserLocationMarker({
  position,
  accuracy,
  onClose,
}: {
  position: google.maps.LatLngLiteral;
  accuracy: number;
  onClose?: () => void;
}) {
  return (
    <>
      {accuracy > 0 && (
        <CircleMarker
          center={position}
          radius={accuracy}
          fillColor="#1a73e8"
          strokeColor="#1a73e8"
          fillOpacity={0.12}
          strokeWeight={0}
          clickable={false}
        />
      )}
      <AdvancedMarker position={position}>
        <div className="map-user-location">
          {onClose && (
            <button
              className="map-user-location-close"
              title="Clear"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
            >×</button>
          )}
          <span className="map-user-location-dot" />
          <span className="map-user-location-ping" />
        </div>
      </AdvancedMarker>
    </>
  );
}

function SelectionRectangle({ bounds }: { bounds: google.maps.LatLngBoundsLiteral | null }) {
  const map = useMap();
  const rectangleRef = useRef<google.maps.Rectangle | null>(null);

  useEffect(() => {
    if (!map) return;
    const rectangle = new google.maps.Rectangle({
      map,
      clickable: false,
      fillColor: "#1a73e8",
      fillOpacity: 0.12,
      strokeColor: "#1a73e8",
      strokeOpacity: 0.95,
      strokeWeight: 2,
    });
    rectangleRef.current = rectangle;
    return () => rectangle.setMap(null);
  }, [map]);

  useEffect(() => {
    const rectangle = rectangleRef.current;
    if (!rectangle) return;
    rectangle.setBounds(bounds);
    rectangle.setVisible(!!bounds);
  }, [bounds]);

  return null;
}

function SelectionHint() {
  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      <div className="map-selection-hint">
        Drag on the map to draw a selection rectangle
      </div>
    </MapControl>
  );
}

function DragAreaSelector({
  points,
  onSelectionChange,
  onBoundsChange,
}: {
  points: PointMarker[];
  onSelectionChange?: (ids: string[]) => void;
  onBoundsChange: (bounds: google.maps.LatLngBoundsLiteral) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const projectionOverlay = new google.maps.OverlayView();
    projectionOverlay.onAdd = () => {};
    projectionOverlay.draw = () => {};
    projectionOverlay.onRemove = () => {};
    projectionOverlay.setMap(map);

    const capture = document.createElement("div");
    capture.className = "map-selection-capture";
    capture.setAttribute("aria-label", "Drag to select points on the map");
    const box = document.createElement("div");
    box.className = "map-selection-drag-box";
    capture.appendChild(box);
    map.getDiv().appendChild(capture);

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;

    const localPoint = (event: PointerEvent) => {
      const rect = capture.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
        y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      };
    };

    const drawBox = (x: number, y: number) => {
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      box.style.display = "block";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${Math.abs(x - startX)}px`;
      box.style.height = `${Math.abs(y - startY)}px`;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      event.preventDefault();
      event.stopPropagation();
      const point = localPoint(event);
      pointerId = event.pointerId;
      startX = point.x;
      startY = point.y;
      capture.setPointerCapture(event.pointerId);
      drawBox(point.x, point.y);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      const point = localPoint(event);
      drawBox(point.x, point.y);
    };

    const finishSelection = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const point = localPoint(event);
      const left = Math.min(startX, point.x);
      const right = Math.max(startX, point.x);
      const top = Math.min(startY, point.y);
      const bottom = Math.max(startY, point.y);
      box.style.display = "none";
      pointerId = null;

      if (right - left < 5 || bottom - top < 5) return;
      const projection = projectionOverlay.getProjection();
      if (!projection) return;
      const northWest = projection.fromContainerPixelToLatLng(new google.maps.Point(left, top));
      const southEast = projection.fromContainerPixelToLatLng(new google.maps.Point(right, bottom));
      if (!northWest || !southEast) return;
      const bounds = {
        north: northWest.lat(),
        west: northWest.lng(),
        south: southEast.lat(),
        east: southEast.lng(),
      };
      onBoundsChange(bounds);
      onSelectionChange?.(
        points.filter((pointMarker) =>
          pointMarker.lat >= bounds.south && pointMarker.lat <= bounds.north &&
          pointMarker.lng >= bounds.west && pointMarker.lng <= bounds.east
        ).map((pointMarker) => pointMarker.id)
      );
    };

    const cancelSelection = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      box.style.display = "none";
      pointerId = null;
    };

    capture.addEventListener("pointerdown", onPointerDown);
    capture.addEventListener("pointermove", onPointerMove);
    capture.addEventListener("pointerup", finishSelection);
    capture.addEventListener("pointercancel", cancelSelection);

    return () => {
      capture.removeEventListener("pointerdown", onPointerDown);
      capture.removeEventListener("pointermove", onPointerMove);
      capture.removeEventListener("pointerup", finishSelection);
      capture.removeEventListener("pointercancel", cancelSelection);
      capture.remove();
      projectionOverlay.setMap(null);
    };
  }, [map, points, onSelectionChange, onBoundsChange]);

  return null;
}


export default function MapPicker({
  lat,
  lng,
  points,
  onCoordChange,
  onMarkerCancel,
  onPointSelect,
  focusTarget,
  center,
  zoom,
  selectionMode = false,
  selectedPointIds = new Set<string>(),
  onSelectionChange,
  onPointToggle,
  onToggleSelectionMode,
  clearSelectionNonce = 0,
  allowPointPlacement = true,
}: MapPickerProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

  const hasExisting = lat !== "" && lng !== "";
  const initialCenter = hasExisting
    ? { lat: parseFloat(lat), lng: parseFloat(lng) }
    : center ?? BENT_NM;
  const initialZoom = zoom ?? DEFAULT_ZOOM;

  const [geoMarker, setGeoMarker] = useState<{ position: google.maps.LatLngLiteral; accuracy: number } | null>(null);

  const [marker, setMarker] = useState<google.maps.LatLngLiteral | null>(
    hasExisting ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null
  );
  const [selectionBounds, setSelectionBounds] = useState<google.maps.LatLngBoundsLiteral | null>(null);

  useEffect(() => {
    if (!selectionMode) setSelectionBounds(null);
  }, [selectionMode]);

  useEffect(() => {
    setSelectionBounds(null);
  }, [clearSelectionNonce]);

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      const clicked = ev.detail.latLng;
      if (!clicked) return;
      const newLat = clicked.lat;
      const newLng = clicked.lng;
      if (selectionMode) return;
      if (!allowPointPlacement) return;
      setMarker({ lat: newLat, lng: newLng });
      onCoordChange(newLat.toFixed(6), newLng.toFixed(6));
    },
    [selectionMode, allowPointPlacement, onCoordChange]
  );

  const draftVisible = useMemo(
    () =>
      marker && !points.some((p) => p.lat === marker.lat && p.lng === marker.lng),
    [marker, points]
  );

  if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY") {
    return (
      <div className="map-picker">
        <div className="map-placeholder">
          <p>🗺️ Google Maps API key not set.</p>
          <p>
            Create a <code>.env</code> file in the project root with:
          </p>
          <pre>VITE_GOOGLE_MAPS_API_KEY=your-actual-key</pre>
          <p>
            Get a key at{" "}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map-picker">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId="point-tracker-map"
          defaultCenter={initialCenter}
          defaultZoom={initialZoom}
          mapTypeId="satellite"
          gestureHandling="greedy"
          disableDefaultUI={false}
          onClick={handleMapClick}
        >
          <MapFocuser target={focusTarget ?? null} />
          <LocateButton onLocate={(pos, accuracy) => setGeoMarker({ position: pos, accuracy })} />
          {onToggleSelectionMode && (
            <SelectAreaButton active={selectionMode} onToggle={onToggleSelectionMode} />
          )}
          {selectionMode && (
            <>
              <SelectionHint />
              <DragAreaSelector
                points={points}
                onSelectionChange={onSelectionChange}
                onBoundsChange={setSelectionBounds}
              />
            </>
          )}
          <SelectionRectangle bounds={selectionBounds} />

          {geoMarker && (
            <UserLocationMarker
              position={geoMarker.position}
              accuracy={geoMarker.accuracy}
              onClose={() => setGeoMarker(null)}
            />
          )}

          {points.map((p) => (
            <CircleMarker
              key={p.id}
              center={{ lat: p.lat, lng: p.lng }}
              radius={p.radius ?? DEFAULT_RADIUS_M}
              fillColor={selectedPointIds.has(p.id) ? "#22c55e" : (p.color ?? "#e11d48")}
              strokeColor={selectedPointIds.has(p.id) ? "#14532d" : (p.color ?? "#b91c1c")}
              fillOpacity={selectedPointIds.has(p.id) ? 0.8 : 0.5}
              strokeWeight={selectedPointIds.has(p.id) ? 4 : 2}
              onClick={() => selectionMode ? onPointToggle?.(p.id) : onPointSelect?.(p.id)}
            />
          ))}

          {draftVisible && (
            <CircleMarker
              center={marker!}
              radius={DEFAULT_RADIUS_M}
              fillColor="#3b82f6"
              strokeColor="#1d4ed8"
              fillOpacity={0.25}
              strokeWeight={3}
              onClick={() => {
                setMarker(null);
                onMarkerCancel?.();
              }}
            />
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
