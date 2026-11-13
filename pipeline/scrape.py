"""Scrape coffee products from Shopify roaster sites.

Most specialty roasters run on Shopify, which publishes a public catalogue at
/products.json. This script reads pipeline/roasters.json, fetches each store's
catalogue politely, keeps only things that look like coffee, and writes one
normalised file per roaster to pipeline/out/raw/<roaster-id>.json.

Usage: python pipeline/scrape.py [--only roaster-id] [--delay 1.0]
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urljoin

import requests

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out" / "raw"
USER_AGENT = "CoffeeGlobeBot/0.1 (catalogue indexer; one request per second)"

# Products whose title, type or tags contain any of these are not beans.
NON_COFFEE = re.compile(
    r"\b(mug|cup|tumbler|grinder|kettle|dripper|filter papers?|scale|gift ?card|"
    r"t-?shirt|hoodie|tote|hat|merch|subscription|sample ?pack|capsules?|pods?|"
    r"cold brew can|instant|equipment|brewer|aeropress|chemex|v60|loose leaf|matcha)\b",
    re.IGNORECASE,
)
# Titles that aren't a single bag of beans: multi-coffee sets (one taste profile can't
# describe them), events and classes, coffee-flavoured goods, and store housekeeping.
NOT_A_SINGLE_COFFEE = re.compile(
    r"\b(gift (set|box|class)|stocking stuffer|advent|bundle|duo|trio|sampler|tasting set|"
    r"favourites pack|holiday .*\bset|candle|sticker|canister|cold brew|nitro|cascara|"
    r"cupping|class|course|workshop|tasting with|event|ticket|refractometer|"
    r"test|wholesale only|with your logo|appointment|payment method|shipping carrier|archived)\b"
    r"|chocolate( bar| -)| — by ",
    re.IGNORECASE,
)
# When a store sets product_type, trust it: coffee types pass, anything else (tea, books,
# water, classes, bundles...) doesn't, however much its description talks about coffee.
COFFEE_TYPE = re.compile(r"\b(coffee|espresso|filter|decaf|whole bean|beans?|soe|sof|single origin|blend)\b", re.IGNORECASE)
NON_COFFEE_TYPE = re.compile(
    r"\b(tea|matcha|bundle|cold brew|instant|capsules?|subscription|gift|brewers?|tools|"
    r"storage|merch(andise)?|equipment|accessor(y|ies))\b",
    re.IGNORECASE,
)
COFFEE_HINT = re.compile(r"\b(coffee|espresso|beans?|single origin|blend|roast)\b", re.IGNORECASE)
# Extraction works from the description; with less than this there is nothing to read.
MIN_DESCRIPTION_CHARS = 20

OZ_TO_G = 28.3495


def strip_html(raw: str | None) -> str:
    text = re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", raw or "", flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def parse_grams(text: str | None) -> int | None:
    """'340g', '12 oz', '1 kg', '2lb' -> grams. Returns None if no weight found."""
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|grams?|oz|ounces?|lbs?|pounds?)\b", text, re.IGNORECASE)
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2).lower()
    if unit == "kg":
        return round(n * 1000)
    if unit.startswith("g"):
        return round(n)
    if unit.startswith(("oz", "ounce")):
        return round(n * OZ_TO_G)
    return round(n * 453.592)


def looks_like_coffee(product: dict) -> bool:
    tags = product.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    title = product.get("title", "")
    ptype = (product.get("product_type") or "").strip()
    haystack = " ".join([title, ptype, " ".join(tags)])
    if NON_COFFEE.search(haystack) or NOT_A_SINGLE_COFFEE.search(title):
        return False
    body = strip_html(product.get("body_html"))
    if len(body) < MIN_DESCRIPTION_CHARS:
        return False
    if ptype:
        return bool(COFFEE_TYPE.search(ptype)) and not NON_COFFEE_TYPE.search(ptype)
    if COFFEE_HINT.search(haystack):
        return True
    # Untyped products: fall back to the description mentioning tasting notes or origin.
    return bool(re.search(r"tasting notes|notes of|origin|process|altitude|masl|varietal", body, re.IGNORECASE))


def normalise(product: dict, base_url: str) -> dict | None:
    """Reduce a Shopify product to what extraction needs. None if nothing is in stock."""
    variants = [v for v in product.get("variants", []) if v.get("available", True)]
    if not variants:
        return None
    # Pick the smallest bag as the headline price: that's what a first-time buyer orders.
    def weight_of(v: dict) -> int | None:
        if v.get("grams"):
            return int(v["grams"])
        return parse_grams(" ".join(str(v.get(k) or "") for k in ("title", "option1", "option2", "option3")))

    priced = sorted(variants, key=lambda v: (weight_of(v) or 10**9, float(v.get("price") or 0)))
    v = priced[0]
    tags = product.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    return {
        "productId": str(product["id"]),
        "title": product.get("title", "").strip(),
        "productType": product.get("product_type") or "",
        "tags": tags,
        "description": strip_html(product.get("body_html"))[:4000],
        "url": urljoin(base_url.rstrip("/") + "/", f"products/{product.get('handle', '')}"),
        "priceCents": round(float(v["price"]) * 100) if v.get("price") else None,
        "weightGrams": weight_of(v),
    }


def allowed_by_robots(base_url: str, session: requests.Session) -> bool:
    rp = urllib.robotparser.RobotFileParser()
    try:
        resp = session.get(urljoin(base_url, "/robots.txt"), timeout=15)
    except requests.RequestException:
        return True  # no robots.txt reachable: treat as allowed
    if resp.status_code >= 400:
        return True
    rp.parse(resp.text.splitlines())
    return rp.can_fetch(USER_AGENT, urljoin(base_url, "/products.json"))


def fetch_products(base_url: str, session: requests.Session, delay: float, max_pages: int = 10) -> list[dict]:
    products: list[dict] = []
    for page in range(1, max_pages + 1):
        resp = session.get(urljoin(base_url, "/products.json"), params={"limit": 250, "page": page}, timeout=30)
        resp.raise_for_status()
        batch = resp.json().get("products", [])
        products.extend(batch)
        if len(batch) < 250:
            break
        time.sleep(delay)
    return products


def scrape_roaster(roaster: dict, session: requests.Session, delay: float) -> list[dict]:
    base = roaster["url"]
    if not allowed_by_robots(base, session):
        print(f"  skip {roaster['id']}: robots.txt disallows /products.json", file=sys.stderr)
        return []
    raw = fetch_products(base, session, delay)
    kept = [n for p in raw if looks_like_coffee(p) and (n := normalise(p, base))]
    print(f"  {roaster['id']}: {len(raw)} products, {len(kept)} coffees in stock")
    return kept


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roasters", default=str(HERE / "roasters.json"))
    ap.add_argument("--only", help="scrape a single roaster id")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between requests")
    args = ap.parse_args()

    roasters = json.loads(Path(args.roasters).read_text())
    if args.only:
        roasters = [r for r in roasters if r["id"] == args.only]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    for r in roasters:
        try:
            coffees = scrape_roaster(r, session, args.delay)
        except (requests.RequestException, ValueError) as e:
            print(f"  FAILED {r['id']}: {e}", file=sys.stderr)
            continue
        (OUT_DIR / f"{r['id']}.json").write_text(json.dumps(coffees, indent=2, ensure_ascii=False))
        time.sleep(args.delay)


if __name__ == "__main__":
    main()
