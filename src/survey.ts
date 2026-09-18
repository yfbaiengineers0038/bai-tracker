import proj4 from "proj4";

export type CoordinateUnits = "us-ft" | "ft" | "m";

export interface CoordinateSystemOption {
  epsg: string;
  name: string;
  /** Civil 3D / ESRI name of the same system, for matching against drawings. */
  civil3dName?: string;
  /** Dropdown group heading (state). */
  group: string;
  units: CoordinateUnits;
  definition: string;
  recommended?: boolean;
}

// NAD83(2011) datum: proj4 has no named "NAD83(2011)" datum, so use GRS80 with a
// null shift to WGS84. NAD83(2011) and WGS84 differ by ~1-2 m, well inside the
// accuracy of the phone GPS fixes this app collects.
const NAD83_2011 = "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs +type=crs";

/**
 * The State Plane systems the firm's Civil 3D drawings use. Definitions are
 * the EPSG registry proj4 strings (epsg.io/<code>.proj4).
 */
const STATE_PLANE_SYSTEMS: CoordinateSystemOption[] = [
  // Colorado — Lambert conformal conic, US survey feet
  {
    epsg: "6430", group: "Colorado", units: "us-ft",
    name: "NAD83(2011) / Colorado North (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Colorado_North_FIPS_0501_Ft_US",
    definition: `+proj=lcc +lat_0=39.3333333333333 +lon_0=-105.5 +lat_1=40.7833333333333 +lat_2=39.7166666666667 +x_0=914401.828803657 +y_0=304800.609601219 +units=us-ft ${NAD83_2011}`,
  },
  {
    epsg: "6428", group: "Colorado", units: "us-ft",
    name: "NAD83(2011) / Colorado Central (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Colorado_Central_FIPS_0502_Ft_US",
    definition: `+proj=lcc +lat_0=37.8333333333333 +lon_0=-105.5 +lat_1=39.75 +lat_2=38.45 +x_0=914401.828803657 +y_0=304800.609601219 +units=us-ft ${NAD83_2011}`,
  },
  {
    epsg: "6432", group: "Colorado", units: "us-ft",
    name: "NAD83(2011) / Colorado South (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Colorado_South_FIPS_0503_Ft_US",
    definition: `+proj=lcc +lat_0=36.6666666666667 +lon_0=-105.5 +lat_1=38.4333333333333 +lat_2=37.2333333333333 +x_0=914401.828803657 +y_0=304800.609601219 +units=us-ft ${NAD83_2011}`,
  },
  // New Mexico — transverse Mercator, US survey feet
  {
    epsg: "6531", group: "New Mexico", units: "us-ft",
    name: "NAD83(2011) / New Mexico East (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_New_Mexico_East_FIPS_3001_Ft_US",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-104.333333333333 +k=0.999909091 +x_0=165000 +y_0=0 +units=us-ft ${NAD83_2011}`,
  },
  {
    epsg: "6529", group: "New Mexico", units: "us-ft",
    name: "NAD83(2011) / New Mexico Central (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_New_Mexico_Central_FIPS_3002_Ft_US",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-106.25 +k=0.9999 +x_0=500000.0001016 +y_0=0 +units=us-ft ${NAD83_2011}`,
  },
  {
    epsg: "6533", group: "New Mexico", units: "us-ft",
    name: "NAD83(2011) / New Mexico West (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_New_Mexico_West_FIPS_3003_Ft_US",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-107.833333333333 +k=0.999916667 +x_0=830000.0001016 +y_0=0 +units=us-ft ${NAD83_2011}`,
  },
  // Oregon — Lambert conformal conic, international feet
  {
    epsg: "6559", group: "Oregon", units: "ft",
    name: "NAD83(2011) / Oregon North (international feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Oregon_North_FIPS_3601_Ft_Intl",
    definition: `+proj=lcc +lat_0=43.6666666666667 +lon_0=-120.5 +lat_1=46 +lat_2=44.3333333333333 +x_0=2500000.0001424 +y_0=0 +units=ft ${NAD83_2011}`,
  },
  {
    epsg: "6561", group: "Oregon", units: "ft",
    name: "NAD83(2011) / Oregon South (international feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Oregon_South_FIPS_3602_Ft_Intl",
    definition: `+proj=lcc +lat_0=41.6666666666667 +lon_0=-120.5 +lat_1=44 +lat_2=42.3333333333333 +x_0=1500000.0001464 +y_0=0 +units=ft ${NAD83_2011}`,
  },
  // Washington — Lambert conformal conic, US survey feet
  {
    epsg: "6597", group: "Washington", units: "us-ft",
    name: "NAD83(2011) / Washington North (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Washington_North_FIPS_4601_Ft_US",
    definition: `+proj=lcc +lat_0=47 +lon_0=-120.833333333333 +lat_1=48.7333333333333 +lat_2=47.5 +x_0=500000.0001016 +y_0=0 +units=us-ft ${NAD83_2011}`,
  },
  {
    epsg: "6599", group: "Washington", units: "us-ft",
    name: "NAD83(2011) / Washington South (US survey feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Washington_South_FIPS_4602_Ft_US",
    definition: `+proj=lcc +lat_0=45.3333333333333 +lon_0=-120.5 +lat_1=47.3333333333333 +lat_2=45.8333333333333 +x_0=500000.0001016 +y_0=0 +units=us-ft ${NAD83_2011}`,
  },
  // Arizona — transverse Mercator, international feet
  {
    epsg: "6407", group: "Arizona", units: "ft",
    name: "NAD83(2011) / Arizona East (international feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Arizona_East_FIPS_0201_Ft_Intl",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-110.166666666667 +k=0.9999 +x_0=213360 +y_0=0 +units=ft ${NAD83_2011}`,
  },
  {
    epsg: "6405", group: "Arizona", units: "ft",
    name: "NAD83(2011) / Arizona Central (international feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Arizona_Central_FIPS_0202_Ft_Intl",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-111.916666666667 +k=0.9999 +x_0=213360 +y_0=0 +units=ft ${NAD83_2011}`,
  },
  {
    epsg: "6409", group: "Arizona", units: "ft",
    name: "NAD83(2011) / Arizona West (international feet)",
    civil3dName: "NAD_1983_2011_StatePlane_Arizona_West_FIPS_0203_Ft_Intl",
    definition: `+proj=tmerc +lat_0=31 +lon_0=-113.75 +k=0.999933333 +x_0=213360 +y_0=0 +units=ft ${NAD83_2011}`,
  },
];

/**
 * Systems projects may have been saved with before the catalog above existed.
 * Not offered in the dropdown, but still resolvable so their exports keep working.
 */
const LEGACY_SYSTEMS: CoordinateSystemOption[] = [
  {
    epsg: "2257", group: "New Mexico", units: "us-ft",
    name: "NAD83 / New Mexico East (US survey feet)",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-104.333333333333 +k=0.999909091 +x_0=165000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
  {
    epsg: "2258", group: "New Mexico", units: "us-ft",
    name: "NAD83 / New Mexico Central (US survey feet)",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-106.25 +k=0.9999 +x_0=500000.0001016 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
  {
    epsg: "2259", group: "New Mexico", units: "us-ft",
    name: "NAD83 / New Mexico West (US survey feet)",
    definition: "+proj=tmerc +lat_0=31 +lon_0=-107.833333333333 +k=0.999916667 +x_0=830000.0001016 +y_0=0 +datum=NAD83 +units=us-ft +no_defs +type=crs",
  },
];

function utmOption(lat: number, lng: number): CoordinateSystemOption {
  const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  const north = lat >= 0;
  return {
    epsg: String((north ? 32600 : 32700) + zone),
    group: "UTM",
    name: `WGS 84 / UTM zone ${zone}${north ? "N" : "S"} (meters)`,
    units: "m",
    definition: `+proj=utm +zone=${zone} ${north ? "" : "+south "}+datum=WGS84 +units=m +no_defs +type=crs`,
  };
}

function inBox(lat: number, lng: number, south: number, north: number, west: number, east: number) {
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/**
 * Best-guess State Plane zone for a location, or null outside the states in the
 * catalog. Zone boundaries follow county lines, so the latitude/longitude splits
 * here are approximations near the edges — this is intentionally a
 * recommendation that someone who knows the drawing confirms.
 */
function recommendedStatePlaneEpsg(lat: number, lng: number): string | null {
  // Washington before Oregon: the two overlap along the Columbia River.
  if (inBox(lat, lng, 45.65, 49.0, -124.8, -116.9)) return lat >= 47.35 ? "6597" : "6599";
  if (inBox(lat, lng, 41.99, 46.3, -124.6, -116.45)) return lat >= 44.3 ? "6559" : "6561";
  if (inBox(lat, lng, 36.99, 41.0, -109.06, -102.04)) return lat >= 39.9 ? "6430" : lat >= 38.5 ? "6428" : "6432";
  if (inBox(lat, lng, 31.0, 37.1, -109.1, -103.0)) return lng < -107 ? "6533" : lng > -105.2 ? "6531" : "6529";
  if (inBox(lat, lng, 31.33, 37.0, -114.82, -109.04)) return lng < -113.3 ? "6409" : lng > -110.4 ? "6407" : "6405";
  return null;
}

/** Options grouped by state (in catalog order) for rendering as <optgroup>s. */
export function groupCoordinateOptions(options: CoordinateSystemOption[]): { group: string; options: CoordinateSystemOption[] }[] {
  const groups: { group: string; options: CoordinateSystemOption[] }[] = [];
  for (const option of options) {
    const existing = groups.find((g) => g.group === option.group);
    if (existing) existing.options.push(option);
    else groups.push({ group: option.group, options: [option] });
  }
  return groups;
}

/** Every selectable system, with the best match for the location flagged `recommended`. */
export function coordinateOptionsForLocation(lat: number, lng: number): CoordinateSystemOption[] {
  const utm = utmOption(lat, lng);
  const recommended = recommendedStatePlaneEpsg(lat, lng);
  return [
    ...STATE_PLANE_SYSTEMS.map((item) => ({ ...item, recommended: item.epsg === recommended })),
    { ...utm, recommended: recommended === null },
  ];
}

export function coordinateSystemByEpsg(epsg: string, lat: number, lng: number) {
  return coordinateOptionsForLocation(lat, lng).find((item) => item.epsg === epsg)
    ?? LEGACY_SYSTEMS.find((item) => item.epsg === epsg);
}

export function projectCoordinate(
  lat: number,
  lng: number,
  epsg: string,
): { easting: number; northing: number } {
  const system = coordinateSystemByEpsg(epsg, lat, lng);
  if (!system) throw new Error(`EPSG:${epsg} is not supported by this app.`);
  const [easting, northing] = proj4("EPSG:4326", system.definition, [lng, lat]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    throw new Error("Coordinate conversion returned an invalid result.");
  }
  return { easting, northing };
}

export function unitsLabel(units: string | null | undefined) {
  return units === "us-ft" ? "US survey feet"
    : units === "ft" ? "international feet"
    : units === "m" ? "meters"
    : "Unknown units";
}
