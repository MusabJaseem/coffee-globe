import coffeesJson from "@/data/coffees.json";
import originsJson from "@/data/origins.json";
import roastersJson from "@/data/roasters.json";
import type { Coffee, Origin, Roaster } from "./types";

export const roasters = roastersJson as Roaster[];
export const coffees = coffeesJson as Coffee[];
export const origins = originsJson as Origin[];

export const roasterById = new Map(roasters.map((r) => [r.id, r]));
export const originById = new Map(origins.map((o) => [o.id, o]));

export const isSampleData = roasters.some((r) => r.sample);


export function formatPrice(c: Coffee): string | null {
  if (c.priceCents == null || !c.currency) return null;
  const price = new Intl.NumberFormat("en-CA", { style: "currency", currency: c.currency }).format(c.priceCents / 100);
  return c.weightGrams ? `${price} for ${c.weightGrams} g` : price;
}

/**
 * The "Ships to" menu: Canada and the US, where every roaster on the globe ships to at least
 * one of them, plus "Elsewhere" for people just browsing, which shows every roaster with no
 * shipping filter (see the note in app/page.tsx).
 */
export const ELSEWHERE = "ELSEWHERE";
export const DEFAULT_COUNTRY = "CA";
export type CountryOption = { code: string; name: string; roasterCount: number };

export function shipsTo(roaster: Roaster, country: string): boolean {
  return country === ELSEWHERE || roaster.shipsTo.includes(country);
}

export const COUNTRIES: CountryOption[] = [
  { code: "CA", name: "Canada" },
  { code: "US", name: "United States" },
  { code: ELSEWHERE, name: "Elsewhere" },
].map((c) => ({ ...c, roasterCount: roasters.filter((r) => shipsTo(r, c.code)).length }));

export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/** A saved choice from an older menu (any ISO code) becomes "Elsewhere"; junk becomes the default. */
export function restoreCountry(saved: string | null): string {
  if (saved && COUNTRIES.some((c) => c.code === saved)) return saved;
  if (saved && /^[A-Z]{2}$/.test(saved)) return ELSEWHERE;
  return DEFAULT_COUNTRY;
}
