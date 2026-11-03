import { AXES, type Axis, type Coffee, type TasteVector, type UserProfile } from "./types";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function vector(partial: Partial<TasteVector> = {}, fill = 0.5): TasteVector {
  const v = {} as TasteVector;
  for (const a of AXES) v[a] = clamp(partial[a] ?? fill);
  return v;
}

/* ------------------------------------------------------------------ */
/* Quiz                                                               */
/* ------------------------------------------------------------------ */

export interface QuizOption {
  label: string;
  /** Target values this answer implies. Axes it doesn't mention are left alone. */
  sets: Partial<TasteVector>;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}

export const QUIZ: QuizQuestion[] = [
  {
    id: "chocolate",
    prompt: "Pick a dessert",
    options: [
      { label: "85% dark chocolate", sets: { roast: 0.7, body: 0.7, sweetness: 0.4, fruitiness: 0.2, acidity: 0.2 } },
      { label: "Salted caramel", sets: { sweetness: 0.85, body: 0.6, roast: 0.5, acidity: 0.3 } },
      { label: "Chocolate with raspberries", sets: { fruitiness: 0.8, acidity: 0.6, roast: 0.3, sweetness: 0.6 } },
      { label: "Lemon tart", sets: { acidity: 0.9, fruitiness: 0.6, roast: 0.2, body: 0.3 } },
    ],
  },
  {
    id: "milk",
    prompt: "How do you usually take your coffee?",
    options: [
      { label: "Black, always", sets: { roast: 0.35 } },
      { label: "A splash of milk", sets: { roast: 0.55, body: 0.6 } },
      { label: "Latte or cappuccino", sets: { roast: 0.7, body: 0.8, acidity: 0.25 } },
    ],
  },
  {
    id: "juice",
    prompt: "Which juice sounds best?",
    options: [
      { label: "Orange", sets: { acidity: 0.7, fruitiness: 0.6 } },
      { label: "Blueberry or grape", sets: { fruitiness: 0.9, sweetness: 0.7, acidity: 0.4 } },
      { label: "Apple", sets: { acidity: 0.5, sweetness: 0.6, fruitiness: 0.5 } },
      { label: "Not a juice person", sets: { fruitiness: 0.2, acidity: 0.3 } },
    ],
  },
  {
    id: "texture",
    prompt: "How should a coffee feel in your mouth?",
    options: [
      { label: "Light, almost like tea", sets: { body: 0.2 } },
      { label: "Smooth and silky", sets: { body: 0.5 } },
      { label: "Thick and syrupy", sets: { body: 0.9 } },
    ],
  },
  {
    id: "drink",
    prompt: "Pick an evening drink",
    options: [
      { label: "Crisp white wine", sets: { acidity: 0.8, body: 0.3 } },
      { label: "Fruity red", sets: { fruitiness: 0.8, body: 0.6 } },
      { label: "Bold red or a stout", sets: { body: 0.9, roast: 0.8 } },
      { label: "None of these", sets: {} },
    ],
  },
  {
    id: "brightness",
    prompt: "A coffee tastes a little tangy. You think…",
    options: [
      { label: "Yes, I love bright coffee", sets: { acidity: 0.9 } },
      { label: "Fine in small doses", sets: { acidity: 0.5 } },
      { label: "Too sour for me", sets: { acidity: 0.1, roast: 0.65 } },
    ],
  },
  {
    id: "adventure",
    prompt: "What are you in the mood to try?",
    options: [
      { label: "Funky and wild", sets: { fruitiness: 0.95, acidity: 0.7, roast: 0.2 } },
      { label: "Classic and comforting", sets: { fruitiness: 0.25, roast: 0.6, sweetness: 0.6 } },
      { label: "Surprise me", sets: {} },
    ],
  },
];

/**
 * Turn quiz answers into a profile. Each axis is the average of every answer
 * that mentioned it; axes nobody mentioned stay at 0.5. Weight grows with how
 * many answers touched the axis, so the user's clearest signals count most.
 */
export function profileFromAnswers(answers: Record<string, number>): UserProfile {
  const sums = vector({}, 0);
  const counts = vector({}, 0);
  for (const q of QUIZ) {
    const idx = answers[q.id];
    const opt = idx === undefined ? undefined : q.options[idx];
    if (!opt) continue;
    for (const a of AXES) {
      const val = opt.sets[a];
      if (val === undefined) continue;
      sums[a] += val;
      counts[a] += 1;
    }
  }
  const taste = {} as TasteVector;
  const weights = {} as TasteVector;
  for (const a of AXES) {
    taste[a] = counts[a] ? sums[a] / counts[a] : 0.5;
    weights[a] = Math.min(1, 0.4 + 0.2 * counts[a]);
  }
  return { taste, weights, liked: [], disliked: [] };
}

/* ------------------------------------------------------------------ */
/* Matching                                                           */
/* ------------------------------------------------------------------ */

/** Match score 0–100 between a profile and a coffee. */
export function matchScore(profile: UserProfile, coffee: Pick<Coffee, "taste">): number {
  let dist = 0;
  let maxDist = 0;
  for (const a of AXES) {
    const w = profile.weights[a];
    const d = profile.taste[a] - coffee.taste[a];
    dist += w * d * d;
    maxDist += w; // each axis can differ by at most 1
  }
  if (maxDist === 0) return 50;
  return Math.round(100 * (1 - Math.sqrt(dist / maxDist)));
}

export interface RankedCoffee {
  coffee: Coffee;
  score: number;
}

export function rankCoffees(profile: UserProfile, coffees: Coffee[]): RankedCoffee[] {
  const disliked = new Set(profile.disliked);
  return coffees
    .filter((c) => !disliked.has(c.id))
    .map((coffee) => ({ coffee, score: matchScore(profile, coffee) }))
    .sort((a, b) => b.score - a.score || a.coffee.name.localeCompare(b.coffee.name));
}

/**
 * Pick the top n while keeping the list varied: at most one coffee per roaster
 * and per origin, falling back to plain ranking if that leaves too few.
 */
export function diversify(ranked: RankedCoffee[], n: number): RankedCoffee[] {
  const picked: RankedCoffee[] = [];
  const roastersSeen = new Set<string>();
  const originsSeen = new Set<string>();
  for (const r of ranked) {
    if (picked.length >= n) break;
    const origin = r.coffee.originId;
    if (roastersSeen.has(r.coffee.roasterId) || (origin && originsSeen.has(origin))) continue;
    picked.push(r);
    roastersSeen.add(r.coffee.roasterId);
    if (origin) originsSeen.add(origin);
  }
  for (const r of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

/** Best score per roaster, used to size and colour globe pins. */
export function bestScoreByRoaster(ranked: RankedCoffee[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const { coffee, score } of ranked) {
    if (score > (best.get(coffee.roasterId) ?? -1)) best.set(coffee.roasterId, score);
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Feedback                                                           */
/* ------------------------------------------------------------------ */

const LIKE_PULL = 0.2;
const DISLIKE_PUSH = 0.1;

export function applyFeedback(profile: UserProfile, coffee: Coffee, liked: boolean): UserProfile {
  const taste = { ...profile.taste };
  for (const a of AXES as readonly Axis[]) {
    const delta = coffee.taste[a] - taste[a];
    taste[a] = clamp(liked ? taste[a] + LIKE_PULL * delta : taste[a] - DISLIKE_PUSH * delta);
  }
  const without = (ids: string[]) => ids.filter((id) => id !== coffee.id);
  return {
    ...profile,
    taste,
    liked: liked ? [...without(profile.liked), coffee.id] : without(profile.liked),
    disliked: liked ? without(profile.disliked) : [...without(profile.disliked), coffee.id],
  };
}
