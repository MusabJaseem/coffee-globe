import coffeesJson from "@/data/coffees.json";
import originsJson from "@/data/origins.json";
import roastersJson from "@/data/roasters.json";
import countryNamesJson from "./country-names.json";
import type { Coffee, Origin, Roaster } from "./types";

export const roasters = roastersJson as Roaster[];
export const coffees = coffeesJson as Coffee[];
export const origins = originsJson as Origin[];

export const roasterById = new Map(roasters.map((r) => [r.id, r]));
export const originById = new Map(origins.map((o) => [o.id, o]));

export const isSampleData = roasters.some((r) => r.sample);

export function shipsTo(roaster: Roaster, country: string): boolean {
  return roaster.shipsTo.includes(country);
}

export function formatPrice(c: Coffee): string | null {
  if (c.priceCents == null || !c.currency) return null;
  const price = new Intl.NumberFormat("en-CA", { style: "currency", currency: c.currency }).format(c.priceCents / 100);
  return c.weightGrams ? `${price} for ${c.weightGrams} g` : price;
}

export type CountryOption = { code: string; name: string; roasterCount: number; featured: boolean };

// Shown at the top of the "Ships to" menu, in this order, when at least one roaster ships there.
const FEATURED = ["CA", "US", "GB", "AU", "NZ", "IE", "DE", "FR", "NL", "JP", "KR", "SG", "HK"];
export const DEFAULT_COUNTRY = "CA";

// A fixed table rather than Intl.DisplayNames at runtime: browsers and Node word some
// names differently, which breaks hydration of the prerendered menu. Generated once from
// Node's Intl.DisplayNames, with "Hong Kong" and "Macao" shortened.
const NAMES = countryNamesJson as Record<string, string>;
export function countryName(code: string): string {
  return NAMES[code] ?? code;
}

/**
 * Every country at least one roaster ships to: the featured markets first, then the rest
 * alphabetically. Built from the data, so new roasters add their countries automatically.
 */
function buildCountries(): CountryOption[] {
  const counts = new Map<string, number>();
  for (const r of roasters) {
    for (const code of new Set(r.shipsTo)) {
      if (/^[A-Z]{2}$/.test(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const option = (code: string): CountryOption => ({
    code,
    name: countryName(code),
    roasterCount: counts.get(code) ?? 0,
    featured: FEATURED.includes(code),
  });
  const featured = FEATURED.filter((c) => counts.has(c)).map(option);
  const rest = [...counts.keys()]
    .filter((c) => !FEATURED.includes(c))
    .map(option)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return [...featured, ...rest];
}

export const COUNTRIES: CountryOption[] = buildCountries();
