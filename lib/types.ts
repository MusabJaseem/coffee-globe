export const AXES = ["acidity", "sweetness", "body", "fruitiness", "roast"] as const;
export type Axis = (typeof AXES)[number];

/** A point in taste space. Every axis is 0–1. `roast` 0 = very light, 1 = very dark. */
export type TasteVector = Record<Axis, number>;

export type Process = "washed" | "natural" | "honey" | "anaerobic" | "other";

export interface Roaster {
  id: string;
  name: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lng: number;
  url: string;
  /** ISO country codes this roaster ships to. */
  shipsTo: string[];
  /** True for the fictional seed roasters checked into the repo. */
  sample?: boolean;
}

export interface Coffee {
  id: string;
  roasterId: string;
  name: string;
  /** Key into origins.json, e.g. "ethiopia". */
  originId: string | null;
  process: Process | null;
  notes: string[];
  priceCents: number | null;
  currency: string | null;
  weightGrams: number | null;
  url: string;
  taste: TasteVector;
}

export interface Origin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface UserProfile {
  taste: TasteVector;
  /** How much each axis matters to this user, 0–1. */
  weights: TasteVector;
  /** Coffee ids the user has rated. */
  liked: string[];
  disliked: string[];
}
