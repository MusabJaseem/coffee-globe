"""Add Shopify roasters to pipeline/roasters.json from their store URLs.

For each URL this checks robots.txt allows /products.json, confirms the feed answers,
reads the store's public /meta.json (name, city, currency, ships_to_countries) and
builds a roasters.json entry. Pins go at the city centre from pipeline/cities.json,
nudged about 1 km for each roaster already in that city so pins don't overlap.

Stores that ship to neither Canada nor the US (--ships-to) are skipped, as are cities
missing from cities.json (add them and re-run). Prints the entries; --write appends
them. Each site's host must be on the environment's network allowlist.

Usage: python pipeline/add_roasters.py https://example.com [...] [--write] [--ships-to CA,US]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

from scrape import USER_AGENT, load_robots

HERE = Path(__file__).resolve().parent
ROASTERS = HERE / "roasters.json"
CITIES = HERE / "cities.json"
NUDGE_DEG = 0.009  # about 1 km of latitude

# Words that don't help tell roasters apart in an id: "Pilot Coffee Roasters" -> "pilot".
FILLER = re.compile(r"\b(the|coffee|roasters?|roastery|roasting|roast|co|company|cafe|café|inc|ltd)\b", re.IGNORECASE)


# Misspellings seen in stores' meta.json, mapped to the real city name.
CITY_FIXES = {"miinneapolis": "Minneapolis"}


def clean_city(city: str) -> str:
    city = city.strip()
    city = CITY_FIXES.get(city.lower(), city)
    return city.title() if city.isupper() else city


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def roaster_id(name: str, host: str) -> str:
    """Short id from the store name, falling back to the domain if nothing is left."""
    rid = slug(FILLER.sub(" ", name.replace("&", " ").replace("'", "").replace("’", "")))
    return rid or slug(host.removeprefix("www.").split(".")[0])


def city_coords(cities: dict, city: str, province: str, country: str) -> tuple[float, float] | None:
    c = city.strip().lower()
    for key in (f"{c}|{province.strip().lower()}|{country}", f"{c}|{country}"):
        if key in cities:
            lat, lng = cities[key]
            return lat, lng
    return None


def entry_from_meta(meta: dict, base_url: str, cities: dict, existing: list[dict]) -> tuple[dict | None, str]:
    """A roasters.json entry from a store's meta.json, or None and the reason it was skipped."""
    host = urlparse(base_url).netloc
    city, country = clean_city(meta.get("city") or ""), (meta.get("country") or "").strip()
    coords = city_coords(cities, city, meta.get("province") or "", country)
    if not coords:
        return None, f"city '{city}, {meta.get('province')}, {country}' not in cities.json"
    rid = roaster_id(meta.get("name") or "", host)
    if any(r["id"] == rid or urlparse(r["url"]).netloc == host for r in existing):
        return None, f"already in roasters.json as '{rid}'"
    lat, lng = coords
    # Nudge by the number of pins already at this spot (not by city name: Portland, Oregon
    # and Portland, Maine share one).
    same_city = sum(1 for r in existing if abs(r.get("lat", 0) - lat) < 0.1 and abs(r.get("lng", 0) - lng) < 0.1)
    return {
        "id": rid,
        "name": (meta.get("name") or "").strip() or rid,
        "city": city,
        "country": country,
        "lat": round(lat + NUDGE_DEG * same_city, 3),
        "lng": round(lng, 3),
        "url": base_url.rstrip("/"),
        "currency": meta.get("currency"),
        # "*" means "rest of the world"; leave it out rather than guess which countries that covers.
        "shipsTo": [c for c in (meta.get("ships_to_countries") or []) if c != "*"],
    }, ""


def check_store(url: str, session: requests.Session, delay: float) -> tuple[dict | None, str, str]:
    """Return (meta, base_url, problem). Follows the store's own redirect, e.g. to www."""
    robots = load_robots(url, session)
    if not robots.can_fetch(USER_AGENT, urljoin(url, "/products.json")):
        return None, url, "robots.txt disallows /products.json"
    time.sleep(delay)
    resp = session.get(urljoin(url, "/meta.json"), timeout=20)
    if resp.status_code != 200 or "json" not in resp.headers.get("content-type", ""):
        return None, url, f"no Shopify meta.json (HTTP {resp.status_code})"
    base = f"{urlparse(resp.url).scheme}://{urlparse(resp.url).netloc}"
    time.sleep(delay)
    feed = session.get(urljoin(base, "/products.json"), params={"limit": 1}, timeout=20)
    if feed.status_code != 200 or "products" not in feed.text[:200]:
        return None, base, f"/products.json not available (HTTP {feed.status_code})"
    return resp.json(), base, ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="+")
    ap.add_argument("--write", action="store_true", help="append the new entries to roasters.json")
    ap.add_argument("--ships-to", default="CA,US", help="skip stores that ship to none of these (comma-separated)")
    ap.add_argument("--delay", type=float, default=1.0)
    args = ap.parse_args()

    existing = json.loads(ROASTERS.read_text())
    cities = json.loads(CITIES.read_text())
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    added = []
    for url in args.urls:
        url = url if url.startswith("http") else f"https://{url}"
        try:
            meta, base, problem = check_store(url, session, args.delay)
        except (requests.RequestException, ValueError) as e:
            meta, base, problem = None, url, f"request failed: {e}"
        wanted = {c.strip() for c in args.ships_to.split(",") if c.strip()}
        if meta and not wanted & set(meta.get("ships_to_countries") or []):
            meta, problem = None, f"doesn't ship to {' or '.join(sorted(wanted))}"
        if meta:
            entry, problem = entry_from_meta(meta, base, cities, existing + added)
            if entry:
                added.append(entry)
                print(f"  add  {entry['id']}: {entry['name']}, {entry['city']} {entry['country']}, ships to {len(entry['shipsTo'])} countries")
        if problem:
            print(f"  skip {url}: {problem}", file=sys.stderr)
        time.sleep(args.delay)

    if args.write and added:
        ROASTERS.write_text(json.dumps(existing + added, indent=2, ensure_ascii=False) + "\n")
        print(f"Wrote {len(added)} new roasters to {ROASTERS.name}.")
    elif added:
        print(json.dumps(added, indent=2, ensure_ascii=False))
        print("Dry run: pass --write to append these.")


if __name__ == "__main__":
    main()
