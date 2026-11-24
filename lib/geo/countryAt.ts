/**
 * Which country is at a given point, for the globe's "Looking at …" line.
 * Outlines are Natural Earth 1:110m shapes at 0.1° precision (public/geo/countries.json,
 * built by scripts/build-countries.ts), fetched once after the globe appears.
 */
type Outline = { n: string; b: [number, number, number, number]; r: [number, number][][] };

let outlines: Outline[] = [];
let loading: Promise<void> | null = null;

export function loadCountryOutlines(): Promise<void> {
  loading ??= fetch("/geo/countries.json")
    .then((res) => (res.ok ? res.json() : []))
    .then((data: Outline[]) => {
      outlines = data;
    })
    .catch(() => {
      loading = null; // try again next time
    });
  return loading;
}

/** Even-odd ray casting; rings are [lng, lat]. Good enough away from the poles. */
function inRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The country containing the point, or null over the ocean (or before outlines load). */
export function countryAt(lat: number, lng: number): string | null {
  const x = ((((lng + 180) % 360) + 360) % 360) - 180;
  // Rings crossing the date line are stored with longitudes up to 360 (see the build script),
  // so western-hemisphere points are also tried shifted by 360.
  const candidates = x < 0 ? [x, x + 360] : [x];
  for (const o of outlines) {
    const [minX, minY, maxX, maxY] = o.b;
    if (lat < minY || lat > maxY) continue;
    for (const cx of candidates) {
      if (cx < minX || cx > maxX) continue;
      // Rings alternate between outer edges and holes; even-odd over all rings handles both.
      let inside = false;
      for (const ring of o.r) if (inRing(cx, lat, ring)) inside = !inside;
      if (inside) return o.n;
    }
  }
  return null;
}

/** For tests: use these outlines instead of fetching. */
export function setCountryOutlinesForTest(data: Outline[]) {
  outlines = data;
  loading = Promise.resolve();
}
