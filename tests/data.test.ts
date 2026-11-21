import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, DEFAULT_COUNTRY, countryName, roasters } from "../lib/data";

test("the ships-to menu starts with the default country and has no duplicates", () => {
  assert.equal(COUNTRIES[0].code, DEFAULT_COUNTRY);
  assert.equal(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length);
});

test("every country in the menu has at least one roaster that ships there", () => {
  for (const c of COUNTRIES) {
    const actual = roasters.filter((r) => r.shipsTo.includes(c.code)).length;
    assert.ok(actual > 0, c.code);
    assert.equal(c.roasterCount, actual, c.code);
  }
});

test("featured markets come first, then the rest alphabetically", () => {
  const firstOther = COUNTRIES.findIndex((c) => !c.featured);
  assert.ok(COUNTRIES.slice(firstOther).every((c) => !c.featured));
  const rest = COUNTRIES.slice(firstOther).map((c) => c.name);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, "en")));
});

test("country names are readable", () => {
  assert.equal(countryName("DE"), "Germany");
  assert.equal(countryName("GB"), "United Kingdom");
  assert.equal(countryName("??"), "??");
});
