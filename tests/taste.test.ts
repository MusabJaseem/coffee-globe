import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUIZ,
  applyFeedback,
  diversify,
  bestScoreByRoaster,
  matchScore,
  profileFromAnswers,
  rankCoffees,
  vector,
} from "../lib/taste";
import type { Coffee } from "../lib/types";

const coffee = (id: string, roasterId: string, taste: Partial<Coffee["taste"]>): Coffee => ({
  id,
  roasterId,
  name: id,
  originId: null,
  process: null,
  notes: [],
  priceCents: null,
  currency: null,
  weightGrams: null,
  url: "https://example.com",
  taste: vector(taste),
});

const brightFruity = coffee("bright", "r1", { acidity: 0.9, fruitiness: 0.9, roast: 0.15, body: 0.3 });
const darkChocolatey = coffee("dark", "r2", { acidity: 0.15, fruitiness: 0.2, roast: 0.8, body: 0.85 });

test("every quiz option only uses known axes and values in 0–1", () => {
  for (const q of QUIZ) {
    assert.ok(q.options.length >= 2, q.id);
    for (const o of q.options) {
      for (const [k, v] of Object.entries(o.sets)) {
        assert.ok(["acidity", "sweetness", "body", "fruitiness", "roast"].includes(k), `${q.id}: ${k}`);
        assert.ok(v! >= 0 && v! <= 1, `${q.id}: ${k}=${v}`);
      }
    }
  }
});

test("an identical coffee scores 100 and the opposite corner scores 0", () => {
  const p = profileFromAnswers({});
  p.taste = vector({}, 0);
  assert.equal(matchScore(p, { taste: vector({}, 0) }), 100);
  assert.equal(matchScore(p, { taste: vector({}, 1) }), 0);
});

test("a bright, fruity quiz taker prefers the bright coffee", () => {
  const p = profileFromAnswers({ chocolate: 3, milk: 0, juice: 1, brightness: 0, adventure: 0 });
  const ranked = rankCoffees(p, [darkChocolatey, brightFruity]);
  assert.equal(ranked[0].coffee.id, "bright");
  assert.ok(ranked[0].score - ranked[1].score > 30, JSON.stringify(ranked.map((r) => r.score)));
});

test("a latte-drinking dark-chocolate fan prefers the dark coffee", () => {
  const p = profileFromAnswers({ chocolate: 0, milk: 2, texture: 2, drink: 2, brightness: 2, adventure: 1 });
  assert.equal(rankCoffees(p, [brightFruity, darkChocolatey])[0].coffee.id, "dark");
});

test("unanswered axes stay neutral with low weight", () => {
  const p = profileFromAnswers({ texture: 0 });
  assert.equal(p.taste.acidity, 0.5);
  assert.equal(p.weights.acidity, 0.4);
  assert.equal(p.taste.body, 0.2);
  assert.ok(p.weights.body > p.weights.acidity);
});

test("a like pulls the profile toward the coffee and raises its score", () => {
  const p = profileFromAnswers({});
  const before = matchScore(p, brightFruity);
  const after = applyFeedback(p, brightFruity, true);
  assert.ok(matchScore(after, brightFruity) > before);
  assert.deepEqual(after.liked, ["bright"]);
});

test("a dislike removes the coffee from rankings and pushes away", () => {
  const p = applyFeedback(profileFromAnswers({}), darkChocolatey, false);
  assert.ok(matchScore(p, darkChocolatey) < matchScore(profileFromAnswers({}), darkChocolatey));
  assert.deepEqual(rankCoffees(p, [darkChocolatey, brightFruity]).map((r) => r.coffee.id), ["bright"]);
  // changing your mind moves it back to liked
  const p2 = applyFeedback(p, darkChocolatey, true);
  assert.deepEqual(p2.disliked, []);
  assert.deepEqual(p2.liked, ["dark"]);
});

test("best score per roaster keeps the maximum", () => {
  const p = profileFromAnswers({ brightness: 0 });
  const extra = coffee("bright2", "r1", { acidity: 0.2 });
  const best = bestScoreByRoaster(rankCoffees(p, [brightFruity, extra, darkChocolatey]));
  assert.equal(best.get("r1"), Math.max(matchScore(p, brightFruity), matchScore(p, extra)));
  assert.equal(best.size, 2);
});

test("diversify keeps one per roaster and origin, then backfills", () => {
  const mk = (id: string, roasterId: string, originId: string, score: number) => ({
    coffee: { ...coffee(id, roasterId, {}), originId },
    score,
  });
  const ranked = [mk("a", "r1", "burundi", 95), mk("b", "r2", "burundi", 94), mk("c", "r1", "kenya", 93), mk("d", "r3", "kenya", 90)];
  assert.deepEqual(diversify(ranked, 2).map((r) => r.coffee.id), ["a", "d"]);
  assert.deepEqual(diversify(ranked, 3).map((r) => r.coffee.id), ["a", "d", "b"]);
});
