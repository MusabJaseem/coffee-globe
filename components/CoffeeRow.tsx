"use client";

import { formatPrice, originById, roasterById } from "@/lib/data";
import type { Coffee } from "@/lib/types";

interface Props {
  coffee: Coffee;
  score: number | null;
  showRoaster?: boolean;
  rating: "liked" | "disliked" | null;
  onRate: (coffee: Coffee, liked: boolean) => void;
  onBuy: (coffee: Coffee) => void;
}

export function buyUrl(c: Coffee): string {
  try {
    const u = new URL(c.url);
    u.searchParams.set("utm_source", "coffeeglobe");
    return u.toString();
  } catch {
    return c.url;
  }
}

export default function CoffeeRow({ coffee, score, showRoaster, rating, onRate, onBuy }: Props) {
  const origin = coffee.originId ? originById.get(coffee.originId)?.name : null;
  const detail = [origin, coffee.process].filter(Boolean).join(", ");
  const price = formatPrice(coffee);
  return (
    <li className="coffee">
      {score != null && (
        <div className="coffee-score" aria-label={`${score} percent match`}>
          {score}
          <small>%</small>
        </div>
      )}
      <div className="coffee-body">
        <h4>{coffee.name}</h4>
        {showRoaster && <p className="coffee-roaster">{roasterById.get(coffee.roasterId)?.name}</p>}
        {detail && <p className="coffee-detail">{detail}</p>}
        {coffee.notes.length > 0 && <p className="coffee-notes">{coffee.notes.join(", ")}</p>}
        {price && <p className="coffee-price">{price}</p>}
        <div className="coffee-actions">
          <a className="buy" href={buyUrl(coffee)} target="_blank" rel="noopener noreferrer" onClick={() => onBuy(coffee)}>
            Buy from roaster
          </a>
          <button
            className={`rate${rating === "liked" ? " on" : ""}`}
            aria-pressed={rating === "liked"}
            aria-label="More like this"
            onClick={() => onRate(coffee, true)}
          >
            👍
          </button>
          <button
            className={`rate${rating === "disliked" ? " on" : ""}`}
            aria-pressed={rating === "disliked"}
            aria-label="Not for me"
            onClick={() => onRate(coffee, false)}
          >
            👎
          </button>
        </div>
      </div>
    </li>
  );
}
