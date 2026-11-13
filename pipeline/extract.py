"""Turn scraped product pages into structured taste data with Claude.

Reads pipeline/out/raw/*.json, asks Claude to fill a fixed schema for each
coffee (origin, process, notes, five taste axes), and appends results to
pipeline/out/extracted.jsonl. Results are cached by a hash of the product
text, so re-running only pays for new or changed products.

Needs an Anthropic API key: EXTRACT_API_KEY, else ANTHROPIC_API_KEY or any credential
the anthropic SDK finds. Use EXTRACT_API_KEY in Claude Code cloud sessions, which strip
ANTHROPIC_API_KEY and set ANTHROPIC_BASE_URL for their own use.
Usage: python pipeline/extract.py [--model claude-haiku-5-5] [--limit 20]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import anthropic

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "out" / "raw"
OUT_FILE = HERE / "out" / "extracted.jsonl"
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

# Structured-output schema. Ranges (0-1) and the five-note cap aren't expressible in
# structured outputs, so the prompt states them and clean_result() enforces them.
SCHEMA = {
    "type": "object",
    "properties": {
        "is_coffee": {"type": "boolean"},
        "is_blend": {"type": "boolean"},
        "origin_country": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "Main producing country in English, e.g. 'Ethiopia'. For blends, the largest component if stated, else null.",
        },
        "process": {"anyOf": [{"type": "string", "enum": PROCESSES}, {"type": "null"}]},
        "notes": {"type": "array", "items": {"type": "string"}, "description": "At most five, in the roaster's words."},
        **{a: {"type": "number", "description": "0 to 1"} for a in AXES},
        "confidence": {
            "type": "number",
            "description": "0 to 1: how well the listing supports these scores. Low when there are no tasting notes.",
        },
    },
    "required": ["is_coffee", "is_blend", "origin_country", "process", "notes", *AXES, "confidence"],
    "additionalProperties": False,
}
# Thinking counts toward max_tokens, so leave room for it as well as the JSON answer.
MAX_TOKENS = 4000
EFFORT = "medium"


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


def parse_response(text: str | None, stop_reason: str | None = None) -> dict:
    """Turn the model's JSON answer into a clean result. Raises ValueError if there isn't one."""
    if stop_reason in ("refusal", "max_tokens") or not text:
        raise ValueError(f"no usable answer (stop_reason={stop_reason})")
    try:
        return clean_result(json.loads(text))
    except json.JSONDecodeError as e:
        raise ValueError(f"answer is not valid JSON: {e}") from e


def call_claude(client: anthropic.Anthropic, model: str, prompt: str) -> tuple[dict, anthropic.types.Usage]:
    # The SDK retries rate limits, overloads and connection errors with backoff.
    message = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    # Content can start with thinking blocks; the answer is the text block.
    text = next((b.text for b in message.content if b.type == "text"), None)
    return parse_response(text, message.stop_reason), message.usage


def load_cache() -> dict[str, dict]:
    if not OUT_FILE.exists():
        return {}
    return {row["key"]: row for line in OUT_FILE.read_text().splitlines() if line.strip() for row in [json.loads(line)]}


def make_client() -> anthropic.Anthropic:
    """Prefer EXTRACT_API_KEY, pinned to the public API so an inherited ANTHROPIC_BASE_URL can't redirect it."""
    key = os.environ.get("EXTRACT_API_KEY")
    if key:
        return anthropic.Anthropic(api_key=key, base_url="https://api.anthropic.com", max_retries=4)
    return anthropic.Anthropic(max_retries=4)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roasters", default=str(HERE / "roasters.json"))
    ap.add_argument("--model", default=os.environ.get("EXTRACT_MODEL", DEFAULT_MODEL))
    ap.add_argument("--limit", type=int, default=0, help="stop after this many new extractions (0 = no limit)")
    args = ap.parse_args()

    try:
        client = make_client()
    except anthropic.AnthropicError as e:
        sys.exit(f"No Anthropic credentials found ({e}). Set EXTRACT_API_KEY or ANTHROPIC_API_KEY first.")
    names = {r["id"]: r["name"] for r in json.loads(Path(args.roasters).read_text())}
    cache = load_cache()
    done = 0
    tokens_in = tokens_out = 0

    with OUT_FILE.open("a") as out:
        for raw_file in sorted(RAW_DIR.glob("*.json")):
            roaster_id = raw_file.stem
            for product in json.loads(raw_file.read_text()):
                key = product_key(roaster_id, product)
                if key in cache:
                    continue
                if args.limit and done >= args.limit:
                    print(f"Stopped after {done} new extractions (--limit). Tokens: {tokens_in:,} in, {tokens_out:,} out.")
                    return
                prompt = build_prompt(names.get(roaster_id, roaster_id), product)
                try:
                    result, usage = call_claude(client, args.model, prompt)
                except (anthropic.AuthenticationError, anthropic.PermissionDeniedError,
                        anthropic.NotFoundError, anthropic.BadRequestError, anthropic.RateLimitError) as e:
                    # Every later request would fail the same way: stop instead of burning through the list.
                    sys.exit(f"Stopping: {type(e).__name__}: {e}")
                except (anthropic.APIStatusError, anthropic.APIConnectionError, ValueError) as e:
                    print(f"  FAILED {roaster_id}/{product['title']}: {e}", file=sys.stderr)
                    continue
                tokens_in += usage.input_tokens
                tokens_out += usage.output_tokens
                row = {"key": key, "roasterId": roaster_id, "productId": product["productId"], **result}
                out.write(json.dumps(row, ensure_ascii=False) + "\n")
                out.flush()
                done += 1
                flag = "" if result["is_coffee"] else "  (not coffee)"
                print(f"  {roaster_id}: {product['title']} -> {result['origin_country']}, {result['process']}{flag}")
    print(f"Done: {done} new extractions. Tokens: {tokens_in:,} in, {tokens_out:,} out.")


if __name__ == "__main__":
    main()
