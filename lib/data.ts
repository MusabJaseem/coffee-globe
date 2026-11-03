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

export function shipsTo(roaster: Roaster, country: string): boolean {
  return roaster.shipsTo.includes(country);
}

export function formatPrice(c: Coffee): string | null {
  if (c.priceCents == null || !c.currency) return null;
  const price = new Intl.NumberFormat("en-CA", { style: "currency", currency: c.currency }).format(c.priceCents / 100);
  return c.weightGrams ? `${price} for ${c.weightGrams} g` : price;
}

export const COUNTRIES: { code: string; name: string }[] = [
  { code: "CA", name: "Canada" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "JP", name: "Japan" },
  { code: "NO", name: "Norway" },
];
