"""Turn scraped product pages into structured taste data with Claude.

Reads pipeline/out/raw/*.json, asks Claude to fill a fixed schema for each
coffee (origin, process, notes, five taste axes), and appends results to
pipeline/out/extracted.jsonl. Results are cached by a hash of the product
text, so re-running only pays for new or changed products.

Needs ANTHROPIC_API_KEY in the environment.
Usage: python pipeline/extract.py [--model claude-haiku-5-5] [--limit 20]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "out" / "raw"
OUT_FILE = HERE / "out" / "extracted.jsonl"
API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-haiku-5-5"

AXES = ["acidity", "sweetness", "body", "fruitiness", "roast"]
PROCESSES = ["washed", "natural", "honey", "anaerobic", "other"]

SYSTEM = """You turn specialty coffee product listings into structured data for a taste-matching app.

Score each taste axis from 0 to 1 as an experienced cupper would expect the coffee to taste, using the roaster's tasting notes, process, origin and roast level. Anchors:
- acidity: 0.1 = flat, low-acid Sumatra or Brazil; 0.5 = balanced Central American; 0.9 = sparkling washed Kenya.
- sweetness: 0.2 = dry or bitter; 0.5 = moderate; 0.9 = caramel, honey, jammy.
- body: 0.2 = tea-like; 0.5 = medium, silky; 0.9 = heavy, syrupy.
- fruitiness: 0.1 = nutty, chocolate, spice only; 0.5 = some stone fruit or citrus; 0.95 = boozy, berry-bomb natural or anaerobic.
- roast: 0.1 = very light Nordic; 0.4 = medium-light; 0.7 = medium-dark espresso; 0.9 = dark, smoky.

"Bright", "juicy", "tart" and "citric" mean higher acidity. "Jammy", "winey", "boozy", "fermented" mean high fruitiness. Espresso blends with chocolate and nut notes are usually roast 0.6-0.75 and body 0.7+.

Only use what the listing supports. If the listing is not a bag of roasted coffee beans (merchandise, equipment, gift cards, subscriptions, instant coffee, tea), set is_coffee to false. Copy tasting notes in the roaster's words, lower case, at most five."""

TOOL = {
    "name": "record_coffee",
    "description": "Record the structured details of one coffee listing.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_coffee": {"type": "boolean"},
            "is_blend": {"type": "boolean"},
            "origin_country": {
                "type": ["string", "null"],
                "description": "Main producing country in English, e.g. 'Ethiopia'. For blends, the largest component if stated, else null.",
            },
            "process": {"type": ["string", "null"], "enum": PROCESSES + [None]},
            "notes": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
            **{a: {"type": "number", "minimum": 0, "maximum": 1} for a in AXES},
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "description": "How well the listing supports these scores. Low when there are no tasting notes.",
            },
        },
        "required": ["is_coffee", "is_blend", "origin_country", "process", "notes", *AXES, "confidence"],
    },
}


def product_key(roaster_id: str, product: dict) -> str:
    text = json.dumps([roaster_id, product["title"], product["description"], product["tags"]], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def build_prompt(roaster_name: str, product: dict) -> str:
    return (
        f"Roaster: {roaster_name}\n"
        f"Product: {product['title']}\n"
        f"Type: {product.get('productType') or 'n/a'}\n"
        f"Tags: {', '.join(product.get('tags') or []) or 'n/a'}\n\n"
        f"Description:\n{product.get('description') or 'n/a'}"
    )


def clean_result(raw: dict) -> dict:
    """Validate and clamp a tool result so a sloppy answer can't break the app."""
    out = {
        "is_coffee": bool(raw.get("is_coffee")),
        "is_blend": bool(raw.get("is_blend")),
        "origin_country": (raw.get("origin_country") or None),
        "process": raw.get("process") if raw.get("process") in PROCESSES else None,
        "notes": [str(n).strip().lower() for n in (raw.get("notes") or []) if str(n).strip()][:5],
        "confidence": min(1.0, max(0.0, float(raw.get("confidence", 0.5)))),
    }
    for a in AXES:
        try:
            out[a] = round(min(1.0, max(0.0, float(raw[a]))), 2)
        except (KeyError, TypeError, ValueError):
            out[a] = 0.5
    return out


def parse_response(body: dict) -> dict:
    for block in body.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == TOOL["name"]:
            return clean_result(block["input"])
    raise ValueError(f"no {TOOL['name']} call in response (stop_reason={body.get('stop_reason')})")


def call_claude(session: requests.Session, api_key: str, model: str, prompt: str, retries: int = 4) -> dict:
    payload = {
        "model": model,
        "max_tokens": 600,
        "system": SYSTEM,
        "tools": [TOOL],
        "tool_choice": {"type": "tool", "name": TOOL["name"]},
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    for attempt in range(retries):
        resp = session.post(API_URL, json=payload, headers=headers, timeout=60)
        if resp.status_code in (429, 500, 502, 503, 529) and attempt < retries - 1:
            time.sleep(2**attempt * 2)
            continue
        resp.raise_for_status()
        return parse_response(resp.json())
    raise RuntimeError("unreachable")


def load_cache() -> dict[str, dict]:
    if not OUT_FILE.exists():
        return {}
    return {row["key"]: row for line in OUT_FILE.read_text().splitlines() if line.strip() for row in [json.loads(line)]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roasters", default=str(HERE / "roasters.json"))
    ap.add_argument("--model", default=os.environ.get("EXTRACT_MODEL", DEFAULT_MODEL))
    ap.add_argument("--limit", type=int, default=0, help="stop after this many new extractions (0 = no limit)")
    args = ap.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("Set ANTHROPIC_API_KEY first.")
    names = {r["id"]: r["name"] for r in json.loads(Path(args.roasters).read_text())}
    cache = load_cache()
    session = requests.Session()
    done = 0

    with OUT_FILE.open("a") as out:
        for raw_file in sorted(RAW_DIR.glob("*.json")):
            roaster_id = raw_file.stem
            for product in json.loads(raw_file.read_text()):
                key = product_key(roaster_id, product)
                if key in cache:
                    continue
                if args.limit and done >= args.limit:
                    print(f"Stopped after {done} new extractions (--limit).")
                    return
                try:
                    result = call_claude(session, api_key, args.model, build_prompt(names.get(roaster_id, roaster_id), product))
                except (requests.RequestException, ValueError) as e:
                    print(f"  FAILED {roaster_id}/{product['title']}: {e}", file=sys.stderr)
                    continue
                row = {"key": key, "roasterId": roaster_id, "productId": product["productId"], **result}
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                done += 1
                flag = "" if result["is_coffee"] else "  (not coffee)"
                print(f"  {roaster_id}: {product['title']} -> {result['origin_country']}, {result['process']}{flag}")
    print(f"Done: {done} new extractions.")


if __name__ == "__main__":
    main()
