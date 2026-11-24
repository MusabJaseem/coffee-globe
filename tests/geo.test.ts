import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countryAt, setCountryOutlinesForTest } from "../lib/geo/countryAt";
import labels from "../lib/geo/country-labels.json";
import origins from "../data/origins.json";

setCountryOutlinesForTest(JSON.parse(readFileSync(join(import.meta.dirname, "../public/geo/countries.json"), "utf8")));

test("countryAt finds the country for real places", () => {
  const places: [string, number, number, string][] = [
    ["Toronto", 43.65, -79.38, "Canada"],
    ["Vancouver", 49.28, -123.12, "Canada"],
    ["Denver", 39.74, -104.99, "United States"],
    ["Anchorage", 61.22, -149.9, "United States"],
    ["Bogotá", 4.71, -74.07, "Colombia"],
    ["Addis Ababa", 9.03, 38.74, "Ethiopia"],
    ["Nairobi", -1.29, 36.82, "Kenya"],
    ["Kigali", -1.95, 30.06, "Rwanda"],
    ["Guatemala City", 14.63, -90.51, "Guatemala"],
    ["Medan, Sumatra", 3.6, 98.67, "Indonesia"],
    ["Moscow", 55.76, 37.62, "Russia"],
    ["Chukotka, across the date line", 66, -172, "Russia"],
    ["Sydney", -33.87, 151.21, "Australia"],
    ["Fiji, Viti Levu", -17.8, 178.0, "Fiji"],
    ["Fiji, Vanua Levu east of the date line", -16.3, -179.95, "Fiji"],
  ];
  for (const [label, lat, lng, want] of places) assert.equal(countryAt(lat, lng), want, label);
});

test("countryAt returns null over open ocean", () => {
  assert.equal(countryAt(0, -30), null); // mid-Atlantic
  assert.equal(countryAt(-40, -120), null); // South Pacific
  assert.equal(countryAt(10, -170), null); // Pacific, west of the date line
});

test("countryAt handles longitudes outside -180..180", () => {
  assert.equal(countryAt(43.65, -79.38 + 360), "Canada");
});

test("labels sit inside their own country", () => {
  for (const l of labels) assert.equal(countryAt(l.lat, l.lng), l.name, l.name);
});

test("every coffee origin pin with a country label is in that country", () => {
  const labelled = new Set(labels.map((l) => l.name));
  for (const o of origins) {
    const name = o.name.replace(/ \(.*\)$/, "");
    if (labelled.has(name)) assert.equal(countryAt(o.lat, o.lng), name, o.name);
  }
});
