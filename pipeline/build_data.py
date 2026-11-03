"""Merge roaster config, scraped products and extractions into the app's data files.

Writes data/roasters.json and data/coffees.json (replacing the sample data).
data/origins.json is the fixed list of producing regions the globe shows.

Usage: python pipeline/build_data.py [--min-confidence 0.3]
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data"
RAW_DIR = HERE / "out" / "raw"
EXTRACTED = HERE / "out" / "extracted.jsonl"

ORIGIN_ALIASES = {
    "sumatra": "indonesia",
    "java": "indonesia",
    "sulawesi": "indonesia",
    "png": "papua-new-guinea",
    "costa rica": "costa-rica",
    "el salvador": "el-salvador",
    "papua new guinea": "papua-new-guinea",
}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def origin_lookup(origins: list[dict]) -> dict[str, str]:
    table = {o["name"].lower().split(" (")[0]: o["id"] for o in origins}
    table.update({o["id"]: o["id"] for o in origins})
    table.update(ORIGIN_ALIASES)
    return table


def resolve_origin(country: str | None, table: dict[str, str]) -> str | None:
    if not country:
        return None
    key = country.strip().lower()
    return table.get(key) or table.get(slug(key))


def load_extractions(path: Path) -> dict[tuple[str, str], dict]:
    """Latest extraction per (roaster, product)."""
    rows: dict[tuple[str, str], dict] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                rows[(row["roasterId"], row["productId"])] = row
    return rows


def build(roasters_cfg: list[dict], raw_dir: Path, extracted: dict, origins: list[dict], min_confidence: float):
    table = origin_lookup(origins)
    coffees, unknown_origins = [], set()
    for r in roasters_cfg:
        raw_file = raw_dir / f"{r['id']}.json"
        if not raw_file.exists():
            continue
        for p in json.loads(raw_file.read_text()):
            ex = extracted.get((r["id"], p["productId"]))
            if not ex or not ex["is_coffee"] or ex["confidence"] < min_confidence:
                continue
            origin_id = resolve_origin(ex["origin_country"], table)
            if ex["origin_country"] and not origin_id:
                unknown_origins.add(ex["origin_country"])
            coffees.append({
                "id": f"{r['id']}--{slug(p['title'])}",
                "roasterId": r["id"],
                "name": p["title"],
                "originId": origin_id,
                "process": ex["process"],
                "notes": ex["notes"],
                "priceCents": p["priceCents"],
                "currency": r.get("currency"),
                "weightGrams": p["weightGrams"],
                "url": p["url"],
                "taste": {a: ex[a] for a in ("acidity", "sweetness", "body", "fruitiness", "roast")},
            })
    with_coffee = {c["roasterId"] for c in coffees}
    roasters = [
        {k: r[k] for k in ("id", "name", "city", "country", "lat", "lng", "url", "shipsTo")}
        for r in roasters_cfg
        if r["id"] in with_coffee
    ]
    return roasters, coffees, sorted(unknown_origins)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roasters", default=str(HERE / "roasters.json"))
    ap.add_argument("--min-confidence", type=float, default=0.3)
    args = ap.parse_args()

    origins = json.loads((DATA / "origins.json").read_text())
    roasters, coffees, unknown = build(
        json.loads(Path(args.roasters).read_text()), RAW_DIR, load_extractions(EXTRACTED), origins, args.min_confidence
    )
    if not coffees:
        raise SystemExit("No coffees to write. Run scrape.py and extract.py first; leaving the sample data in place.")
    (DATA / "roasters.json").write_text(json.dumps(roasters, indent=2, ensure_ascii=False))
    (DATA / "coffees.json").write_text(json.dumps(coffees, indent=2, ensure_ascii=False))
    print(f"Wrote {len(roasters)} roasters and {len(coffees)} coffees to data/.")
    if unknown:
        print("Origins not on the globe yet (add them to data/origins.json):", ", ".join(unknown))


if __name__ == "__main__":
    main()
