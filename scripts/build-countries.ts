/**
 * Builds the globe's country labels and the outlines behind "Looking at …".
 *
 * Source: Natural Earth 1:110m country shapes from the world-atlas package (public domain).
 * Writes:
 *   lib/geo/country-labels.json – name, position and text size for each labelled country
 *   public/geo/countries.json  – compact outlines (0.1° precision), fetched by the client
 *
 * Run after changing the rules below: npx tsx scripts/build-countries.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { geoArea, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

const ROOT = join(import.meta.dirname, "..");
const topo = JSON.parse(readFileSync(join(ROOT, "node_modules/world-atlas/countries-110m.json"), "utf8")) as Topology;
const origins = JSON.parse(readFileSync(join(ROOT, "data/origins.json"), "utf8")) as { name: string; lat: number; lng: number }[];

// Natural Earth abbreviates some names; use the everyday ones.
const RENAME: Record<string, string> = {
  "United States of America": "United States",
  "Dem. Rep. Congo": "DR Congo",
  "Central African Rep.": "Central African Rep.",
  "S. Sudan": "South Sudan",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "W. Sahara": "Western Sahara",
  "Falkland Is.": "Falkland Islands",
  "Solomon Is.": "Solomon Islands",
  "Fr. S. Antarctic Lands": "French Southern Lands",
  "N. Cyprus": "Northern Cyprus",
  "eSwatini": "Eswatini",
};

// A country gets a label if its main landmass is at least this big (steradians; Earth = 4π).
// About 0.012 is Spain or Thailand: big enough to hold its name without crowding neighbours.
const MIN_LABEL_AREA = 0.012;
// Coffee origins are labelled down to this smaller size (Uganda, Ecuador), since people look
// for them on purpose. Smaller ones (Guatemala, Rwanda...) would be unreadable specks on top
// of their origin pin, which already shows the name, as does the "Looking at" line.
const MIN_ORIGIN_LABEL_AREA = 0.004;
const ORIGIN_NAMES = new Set(origins.map((o) => o.name.replace(/ \(.*\)$/, "")));
const SKIP = new Set(["Antarctica", "Fr. S. Antarctic Lands", "Falkland Is."]);

type Country = Feature<Polygon | MultiPolygon, { name: string }>;
const countries = (feature(topo, topo.objects.countries as GeometryCollection) as unknown as { features: Country[] }).features;

const round = (n: number) => Math.round(n * 10) / 10;

function polygonsOf(f: Country): Position[][][] {
  return f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
}

const labels: { name: string; lat: number; lng: number; size: number; origin: boolean }[] = [];
const outlines: { n: string; b: [number, number, number, number]; r: [number, number][][] }[] = [];

for (const f of countries) {
  const raw = f.properties.name;
  const name = RENAME[raw] ?? raw;
  const polys = polygonsOf(f);

  // Outlines: every ring, rounded, with a bounding box for a quick first test.
  // Rings that cross the date line (Russia, Fiji) jump between +180 and -180. Shift their western
  // points east by 360 so each ring is continuous; countryAt also tries longitude + 360.
  const rings = polys.flatMap((p) =>
    p.map((ring) => {
      const crosses = ring.some(([x], i) => i > 0 && Math.abs(x - ring[i - 1][0]) > 180);
      return ring.map(([x, y]) => [round(crosses && x < 0 ? x + 360 : x), round(y)] as [number, number]);
    }),
  );
  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  outlines.push({ n: name, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], r: rings });

  if (SKIP.has(raw)) continue;
  // Label at the centre of the largest landmass, so e.g. the US label isn't pulled toward Alaska.
  const main = polys
    .map((coordinates) => ({ type: "Polygon" as const, coordinates }))
    .reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  const area = geoArea(main);
  const origin = ORIGIN_NAMES.has(name) || ORIGIN_NAMES.has(raw);
  if (area < (origin ? MIN_ORIGIN_LABEL_AREA : MIN_LABEL_AREA)) continue;
  const [lng, lat] = geoCentroid(main);
  // Text height in degrees: grows with the square root of area, kept within a readable range.
  const size = Math.min(2.6, Math.max(0.75, Math.sqrt(area) * 9));
  labels.push({ name, lat: round(lat), lng: round(lng), size: Math.round(size * 100) / 100, origin });
}

labels.sort((a, b) => b.size - a.size);
mkdirSync(join(ROOT, "lib/geo"), { recursive: true });
mkdirSync(join(ROOT, "public/geo"), { recursive: true });
writeFileSync(join(ROOT, "lib/geo/country-labels.json"), JSON.stringify(labels, null, 1) + "\n");
writeFileSync(join(ROOT, "public/geo/countries.json"), JSON.stringify(outlines));
console.log(`${labels.length} labels (${labels.filter((l) => l.origin).length} coffee origins), ${outlines.length} outlines`);
