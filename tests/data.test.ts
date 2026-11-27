import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, DEFAULT_COUNTRY, ELSEWHERE, restoreCountry, roasters, shipsTo } from "../lib/data";

test("the ships-to menu is Canada, the US and Elsewhere, default first", () => {
  assert.deepEqual(COUNTRIES.map((c) => c.code), ["CA", "US", ELSEWHERE]);
  assert.equal(COUNTRIES[0].code, DEFAULT_COUNTRY);
});

test("counts match the roasters each option shows", () => {
  for (const c of COUNTRIES) {
    assert.equal(c.roasterCount, roasters.filter((r) => shipsTo(r, c.code)).length, c.code);
    assert.ok(c.roasterCount > 0, c.code);
  }
  assert.equal(COUNTRIES.find((c) => c.code === ELSEWHERE)!.roasterCount, roasters.length);
});

test("every roaster ships to Canada or the US", () => {
  for (const r of roasters) assert.ok(shipsTo(r, "CA") || shipsTo(r, "US"), r.id);
});

test("saved choices from the old menu are restored sensibly", () => {
  assert.equal(restoreCountry("US"), "US");
  assert.equal(restoreCountry("DE"), ELSEWHERE);
  assert.equal(restoreCountry(null), DEFAULT_COUNTRY);
  assert.equal(restoreCountry("nonsense"), DEFAULT_COUNTRY);
});
