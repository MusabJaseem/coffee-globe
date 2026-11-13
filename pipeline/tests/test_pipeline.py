import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_data  # noqa: E402
import extract  # noqa: E402
import scrape  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "products.json").read_text())["products"]
BASE = "https://roaster.example"


def kept():
    return [n for p in FIXTURE if scrape.looks_like_coffee(p) and (n := scrape.normalise(p, BASE))]


@pytest.mark.parametrize("text,grams", [
    ("340g", 340), ("12 oz", 340), ("1kg", 1000), ("2 lb", 907), ("1.5 KG bag", 1500), ("Whole bean", None), (None, None),
])
def test_parse_grams(text, grams):
    assert scrape.parse_grams(text) == grams


def test_filters_merch_gift_cards_and_sold_out():
    assert [p["title"] for p in kept()] == ["Ethiopia Guji Natural", "House Espresso"]


NOTES = "<p>Tasting notes: stone fruit, honey and black tea. Washed, 1,900 masl.</p>"


@pytest.mark.parametrize("title,ptype,body,expected", [
    ("Ethiopia Guji Natural", "Coffee", NOTES, True),
    ("Burundi Kayanza - Washed", "", NOTES, True),            # untyped, but the description reads like coffee
    ("Ethiopia Sedka", "SOF", NOTES, True),                    # store-specific coffee codes
    ("Signature Espresso Gift Set", "Bundle", NOTES, False),  # multi-coffee sets
    ("Honduras Duo", "Bundle", NOTES, False),
    ("24 Days Of Coffee Advent Calendar", "", NOTES, False),
    ("Imperial Jasmine", "Tea", NOTES, False),                 # type is trusted over a coffee-ish description
    ("Fellow Atmos Vacuum Canister", "Coffee brewers & tools", NOTES, False),
    ("Espresso Brewing", "Workshop", NOTES, False),
    ("Menu Cupping — November 28th", "", NOTES, False),
    ("The Physics of Filter Coffee — by Jonathan Gangé", "", NOTES, False),
    ("Karat Chocolate - Le Cafe Noir", "", NOTES, False),
    ("Nitro Cold Brew Coffee", "Cold Brew Coffee", NOTES, False),
    ("This is a Test (Roast)", "Coffee", NOTES, False),
    ("Kenya - Maganjo | Washed - Archived", "Coffee", NOTES, False),
    ("Finca Deborah Enigma", "", "", False),                   # nothing for extraction to read
])
def test_looks_like_coffee(title, ptype, body, expected):
    assert scrape.looks_like_coffee({"title": title, "product_type": ptype, "body_html": body, "tags": []}) is expected


def test_normalise_picks_smallest_bag_and_cleans_html():
    guji = kept()[0]
    assert guji["priceCents"] == 2400
    assert guji["weightGrams"] == 340
    assert guji["url"] == "https://roaster.example/products/ethiopia-guji-natural"
    assert "strawberry jam & cocoa" in guji["description"]
    assert "<" not in guji["description"]


def test_comma_string_tags_are_split():
    espresso = kept()[1]
    assert espresso["tags"] == ["espresso", "blend"]
    assert espresso["weightGrams"] == 340


def test_parse_response_clamps_and_validates():
    text = json.dumps({
        "is_coffee": True, "is_blend": False, "origin_country": "Ethiopia", "process": "carbonic",
        "notes": ["Blueberry", " ", "Cocoa"], "acidity": 1.4, "sweetness": "0.8", "body": -1,
        "fruitiness": 0.9, "confidence": 0.9})
    r = extract.parse_response(text, "end_turn")
    assert r["process"] is None          # not in the allowed list
    assert r["notes"] == ["blueberry", "cocoa"]
    assert (r["acidity"], r["sweetness"], r["body"], r["roast"]) == (1.0, 0.8, 0.0, 0.5)


@pytest.mark.parametrize("text,stop_reason", [
    (None, "end_turn"),                 # no text block
    ("not json", "end_turn"),
    ('{"is_coffee": true', "max_tokens"),  # cut off mid-answer
    (None, "refusal"),
])
def test_parse_response_without_usable_answer_raises(text, stop_reason):
    with pytest.raises(ValueError):
        extract.parse_response(text, stop_reason)


def test_schema_is_valid_for_structured_outputs():
    # Structured outputs reject numeric/array constraints and need additionalProperties: false.
    dumped = json.dumps(extract.SCHEMA)
    for unsupported in ('"minimum"', '"maximum"', '"maxItems"'):
        assert unsupported not in dumped
    assert extract.SCHEMA["additionalProperties"] is False
    assert set(extract.SCHEMA["required"]) == set(extract.SCHEMA["properties"])


def test_cache_key_changes_with_description():
    p = kept()[0]
    assert extract.product_key("r", p) != extract.product_key("r", {**p, "description": "new"})


def test_build_merges_and_resolves_origins(tmp_path):
    (tmp_path / "r1.json").write_text(json.dumps(kept()))
    cfg = [{"id": "r1", "name": "R1", "city": "Toronto", "country": "CA", "lat": 1, "lng": 2,
            "url": BASE, "currency": "CAD", "shipsTo": ["CA"]},
           {"id": "r2", "name": "No data", "city": "X", "country": "CA", "lat": 0, "lng": 0,
            "url": BASE, "currency": "CAD", "shipsTo": ["CA"]}]
    base = {"is_blend": False, "process": "natural", "notes": [], "acidity": .6, "sweetness": .8,
            "body": .5, "fruitiness": .9, "roast": .2, "confidence": .9}
    extracted = {
        ("r1", "101"): {**base, "is_coffee": True, "origin_country": "ethiopia"},
        ("r1", "103"): {**base, "is_coffee": True, "origin_country": "Sumatra", "confidence": 0.1},
    }
    origins = [{"id": "ethiopia", "name": "Ethiopia", "lat": 0, "lng": 0},
               {"id": "indonesia", "name": "Indonesia (Sumatra)", "lat": 0, "lng": 0}]
    roasters, coffees, unknown = build_data.build(cfg, tmp_path, extracted, origins, min_confidence=0.3)
    assert [r["id"] for r in roasters] == ["r1"]           # r2 has no coffees
    assert [c["name"] for c in coffees] == ["Ethiopia Guji Natural"]  # low confidence dropped
    assert coffees[0]["originId"] == "ethiopia"
    assert coffees[0]["currency"] == "CAD"
    assert unknown == []


def test_origin_aliases():
    table = build_data.origin_lookup([{"id": "indonesia", "name": "Indonesia (Sumatra)"},
                                      {"id": "costa-rica", "name": "Costa Rica"}])
    assert build_data.resolve_origin("Sumatra", table) == "indonesia"
    assert build_data.resolve_origin("Costa Rica", table) == "costa-rica"
    assert build_data.resolve_origin("Atlantis", table) is None
