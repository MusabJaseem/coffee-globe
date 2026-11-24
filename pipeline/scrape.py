"""Scrape coffee products from Shopify roaster sites.

Most specialty roasters run on Shopify, which publishes a public catalogue at
/products.json. This script reads pipeline/roasters.json, fetches each store's
catalogue politely, keeps only things that look like coffee, and writes one
normalised file per roaster to pipeline/out/raw/<roaster-id>.json.

Some stores keep their tasting notes out of body_html and only show them in the product
page's meta description. For roasters with "pageSummary": true in roasters.json, the
scraper also fetches each kept product's page (one request per second, if robots.txt
allows it) and adds that summary to the description.

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
    r"cold brew can|instant|equipment|brewer|aeropress|chemex|v60|loose leaf|matcha|tools?|dosing ring|wdt|"
    r"server|pour splitter|stirring stick|coffee maker|espresso machine|steeped|ready to brew|drip bags?)\b",
    re.IGNORECASE,
)
# Titles that aren't a single bag of beans: multi-coffee sets (one taste profile can't
# describe them), events and classes, coffee-flavoured goods, and store housekeeping.
NOT_A_SINGLE_COFFEE = re.compile(
    r"\b(gift (set|box|class)|stocking stuffer|advent|bundle|duo|trio|sampler|tasting (set|pack)|sample box|"
    r"favourites pack|holiday .*\bset|candle|sticker|canister|cold brew|nitro|cascara|"
    r"cupping|class|course|workshop|tasting with|event|ticket|refractometer|"
    r"test|wholesale only|with your logo|appointment|payment method|shipping carrier|archived|"
    # Several coffees, or a different one each order: no single taste profile fits.
    r"packs?|club|calendar|surprise|we choose|shuffle|roaster'?s (pick|choice)|kits?|sets?)\b"
    r"|chocolate( bar| -)| — by ",
    re.IGNORECASE,
)
# When a store sets product_type, trust it: coffee types pass, anything else (tea, books,
# water, classes, bundles...) doesn't, however much its description talks about coffee.
COFFEE_TYPE = re.compile(r"\b(coffees?|caf[eé]s?|espresso|filter|decaf|whole bean|beans?|soe|sof|single origin|blends?)\b", re.IGNORECASE)
NON_COFFEE_TYPE = re.compile(
    r"\b(tea|matcha|bundle|cold brew|instant|capsules?|subscription|gift|brewers?|tools|"
    r"storage|merch(andise)?|equipment|accessor(y|ies)|machines?|makers?)\b",
    re.IGNORECASE,
)
COFFEE_HINT = re.compile(r"\b(coffee|espresso|beans?|single origin|blend|roast)\b", re.IGNORECASE)
# Extraction works from the description; with less than this there is nothing to read.
MIN_DESCRIPTION_CHARS = 20

OZ_TO_G = 28.3495


def strip_html(raw: str | None) -> str:
    # Drop <style> and <script> blocks first: their contents are code, not description.
    raw = re.sub(r"<(style|script)\b[^>]*>.*?</\1\s*>", " ", raw or "", flags=re.IGNORECASE | re.DOTALL)
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


def looks_like_coffee(product: dict, coffee_types: list[str] | None = None) -> bool:
    """coffee_types: a store's own product types for coffee (roasters.json "coffeeTypes"),
    for stores that use codes like "Retail SO" instead of a word the regexes know."""
    tags = product.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",")]
    title = product.get("title", "")
    ptype = (product.get("product_type") or "").strip()
    if NOT_A_SINGLE_COFFEE.search(title):
        return False
    body = strip_html(product.get("body_html"))
    if len(body) < MIN_DESCRIPTION_CHARS:
        return False
    if ptype:
        # Trust the store's type, and check only the title for non-coffee words: tags often
        # name related products ("__with:hario-v60") or offers ("Reserve Subscription").
        if NON_COFFEE.search(f"{title} {ptype}") and not (coffee_types and ptype in coffee_types):
            return False
        if coffee_types and ptype in coffee_types:
            return True
        return bool(COFFEE_TYPE.search(ptype)) and not NON_COFFEE_TYPE.search(ptype)
    haystack = " ".join([title, " ".join(tags)])
    if NON_COFFEE.search(haystack):
        return False
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


def load_robots(base_url: str, session: requests.Session) -> urllib.robotparser.RobotFileParser:
    rp = urllib.robotparser.RobotFileParser()
    try:
        resp = session.get(urljoin(base_url, "/robots.txt"), timeout=15)
        text = resp.text if resp.status_code < 400 else ""
    except requests.RequestException:
        text = ""  # no robots.txt reachable: treat as allowed
    rp.parse(text.splitlines())
    return rp


def allowed_by_robots(base_url: str, session: requests.Session) -> bool:
    return load_robots(base_url, session).can_fetch(USER_AGENT, urljoin(base_url, "/products.json"))


META_DESCRIPTION = re.compile(
    r"<meta\s+(?:name|property)=[\"'](?:description|og:description)[\"']\s+content=[\"']([^\"']*)[\"']", re.IGNORECASE
)


def page_summary(page_html: str) -> str:
    """The product page's meta description, which some stores use for tasting notes."""
    m = META_DESCRIPTION.search(page_html)
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip() if m else ""


def add_summary(coffee: dict, summary: str) -> dict:
    """Put the page summary ahead of the description unless the description already has it."""
    desc = coffee["description"]
    # Meta descriptions are often the first ~160 characters of body_html, so compare a prefix.
    if len(summary) < MIN_DESCRIPTION_CHARS or summary[:80] in re.sub(r"\s+", " ", desc):
        return coffee
    return {**coffee, "description": f"Summary: {summary}\n{desc}"[:4000]}


def add_page_summaries(coffees: list[dict], robots, session: requests.Session, delay: float) -> list[dict]:
    out = []
    for c in coffees:
        if not robots.can_fetch(USER_AGENT, c["url"]):
            out.append(c)
            continue
        time.sleep(delay)
        try:
            resp = session.get(c["url"], timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"    no page summary for {c['title']}: {e}", file=sys.stderr)
            out.append(c)
            continue
        out.append(add_summary(c, page_summary(resp.text)))
    return out


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
    robots = load_robots(base, session)
    if not robots.can_fetch(USER_AGENT, urljoin(base, "/products.json")):
        print(f"  skip {roaster['id']}: robots.txt disallows /products.json", file=sys.stderr)
        return []
    raw = fetch_products(base, session, delay)
    kept = [n for p in raw if looks_like_coffee(p, roaster.get("coffeeTypes")) and (n := normalise(p, base))]
    print(f"  {roaster['id']}: {len(raw)} products, {len(kept)} coffees in stock")
    if roaster.get("pageSummary"):
        kept = add_page_summaries(kept, robots, session, delay)
        added = sum(c["description"].startswith("Summary: ") for c in kept)
        print(f"    page summaries added to {added} of {len(kept)}")
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
