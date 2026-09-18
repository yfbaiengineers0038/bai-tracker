import { useState, useEffect, useRef, useCallback } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import "./PlaceAutocompleteInput.css";

/** A place the user picked from the suggestion list. */
export interface PlaceSelection {
  /** Short display name, e.g. "Central Park" or "123 Main St". */
  name: string;
  /** Full prediction text, e.g. "Central Park, New York, NY, USA". */
  fullText: string;
  lat: number;
  lng: number;
}

interface PlaceAutocompleteInputProps {
  name?: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Fires on every keystroke — keeps the input controlled by the parent. */
  onChange: (text: string) => void;
  /** Fires when the user picks a suggestion and its coordinates have been resolved. */
  onPlaceSelect?: (place: PlaceSelection) => void;
  /** Bias suggestions toward this point (e.g. the project location). */
  biasCenter?: google.maps.LatLngLiteral | null;
}

interface Suggestion {
  id: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
  /** Resolves the suggestion's coordinates. */
  resolve: () => Promise<google.maps.LatLngLiteral | null>;
}

const DEBOUNCE_MS = 250;
const BIAS_RADIUS_M = 50_000;

/**
 * Text input with a Google-Maps-style suggestion dropdown. Uses the Places
 * Autocomplete (New) API with a fallback to the legacy AutocompleteService for
 * keys that only have the classic Places API enabled. Falls back to a plain
 * input when no Maps API key is configured.
 */
export default function PlaceAutocompleteInput(props: PlaceAutocompleteInputProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
  if (!apiKey || apiKey === "YOUR_GOOGLE_MAPS_API_KEY") {
    return <PlainInput {...props} />;
  }
  return (
    <APIProvider apiKey={apiKey}>
      <AutocompleteInner {...props} />
    </APIProvider>
  );
}

function PlainInput({ name, value, placeholder, required, disabled, onChange }: PlaceAutocompleteInputProps) {
  return (
    <input
      name={name}
      type="text"
      placeholder={placeholder}
      value={value}
      required={required}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function AutocompleteInner({
  name,
  value,
  placeholder,
  required,
  disabled,
  onChange,
  onPlaceSelect,
  biasCenter,
}: PlaceAutocompleteInputProps) {
  const places = useMapsLibrary("places");
  const geocoding = useMapsLibrary("geocoding");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number>(0);
  const requestSeq = useRef(0);
  // A session token groups the keystrokes + final selection into one billable
  // session, as Google recommends. Reset after each selection.
  const sessionRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  // Set when the user picks a suggestion so the resulting value change doesn't
  // immediately trigger another fetch.
  const skipNextFetch = useRef(false);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!places) return;
      const seq = ++requestSeq.current;
      if (!sessionRef.current) sessionRef.current = new places.AutocompleteSessionToken();
      const session = sessionRef.current;
      const bias = biasCenter ? { center: biasCenter, radius: BIAS_RADIUS_M } : undefined;

      try {
        let next: Suggestion[];
        if (typeof places.AutocompleteSuggestion?.fetchAutocompleteSuggestions === "function") {
          const { suggestions: raw } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            sessionToken: session,
            locationBias: bias,
          });
          next = raw
            .map((s) => s.placePrediction)
            .filter((p): p is google.maps.places.PlacePrediction => !!p)
            .map((p) => ({
              id: p.placeId,
              mainText: p.mainText?.text ?? p.text.text,
              secondaryText: p.secondaryText?.text ?? "",
              fullText: p.text.text,
              resolve: async () => {
                const place = p.toPlace();
                await place.fetchFields({ fields: ["location"] });
                const loc = place.location;
                return loc ? { lat: loc.lat(), lng: loc.lng() } : null;
              },
            }));
        } else {
          // Legacy Places API (pre-2025 keys).
          const service = new places.AutocompleteService();
          const result = await service.getPlacePredictions({
            input,
            sessionToken: session,
            locationBias: bias,
          });
          next = result.predictions.map((p) => ({
            id: p.place_id,
            mainText: p.structured_formatting.main_text,
            secondaryText: p.structured_formatting.secondary_text ?? "",
            fullText: p.description,
            resolve: async () => {
              if (!geocoding) return null;
              const { results } = await new geocoding.Geocoder().geocode({ placeId: p.place_id });
              const loc = results[0]?.geometry.location;
              return loc ? { lat: loc.lat(), lng: loc.lng() } : null;
            },
          }));
        }
        if (seq !== requestSeq.current) return; // a newer request superseded this one
        setSuggestions(next);
        setError(null);
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        console.error("Place autocomplete failed", err);
        setSuggestions([]);
        setError("Suggestions unavailable — check that the Places API is enabled for this key.");
        setOpen(true);
      }
    },
    [places, geocoding, biasCenter]
  );

  // Debounced fetch on value change.
  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    window.clearTimeout(debounceRef.current);
    const query = value.trim();
    if (query.length < 2) {
      requestSeq.current++;
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    return () => window.clearTimeout(debounceRef.current);
  }, [value, fetchSuggestions]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function choose(s: Suggestion) {
    skipNextFetch.current = true;
    onChange(s.mainText);
    setOpen(false);
    setSuggestions([]);
    setResolving(true);
    try {
      const loc = await s.resolve();
      if (loc) onPlaceSelect?.({ name: s.mainText, fullText: s.fullText, lat: loc.lat, lng: loc.lng });
    } catch (err) {
      console.error("Could not resolve place location", err);
    } finally {
      setResolving(false);
      sessionRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        choose(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const listId = `${name ?? "place"}-suggestions`;

  return (
    <div className="place-autocomplete" ref={wrapRef}>
      <input
        name={name}
        type="text"
        placeholder={placeholder}
        value={value}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length > 0 || error) setOpen(true); }}
      />
      {resolving && <span className="place-autocomplete-status">Locating…</span>}
      {open && (suggestions.length > 0 || error) && (
        <ul className="place-autocomplete-list" id={listId} role="listbox">
          {error ? (
            <li className="place-autocomplete-error">{error}</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? "place-autocomplete-item active" : "place-autocomplete-item"}
                onMouseEnter={() => setActiveIndex(i)}
                // mousedown (not click) so the choice lands before the input blurs
                onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              >
                <span className="place-autocomplete-pin" aria-hidden="true">📍</span>
                <span className="place-autocomplete-text">
                  <span className="place-autocomplete-main">{s.mainText}</span>
                  {s.secondaryText && <span className="place-autocomplete-secondary">{s.secondaryText}</span>}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
