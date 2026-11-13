# Project notes

Background and status for anyone (or any Claude session) picking this up. `CLAUDE.md` has the spec and rules; this file covers why things are the way they are and what's next.

## Why this idea

Started from brainstorming coffee software businesses. Two ideas were shortlisted:
- **Green-coffee forecasting for small roasters** (B2B, clearer revenue). Parked for now.
- **Palate matching for consumers.** Chosen, with a twist: a satellite globe of roasters you can order from online, inspired by Tenet Fintech's globe-with-pins website.

## Competitive landscape (researched Nov 2026)

- **Roasters.app** maps 23,000+ cafés and roasters, but it's for visiting in person, with no taste matching.
- **Sprudge Maps** and Vereda are similar in-person café maps.
- **Siip** is the closest competitor: scan bags, see your match %, buy from roasters worldwide, plus a taste-picked monthly subscription.
- **Coffeefe** (5,500+ coffees from 320+ roasters, filter by flavour), **Coffi** (taste profile on its roadmap), plus Brew Compass, BeanLog and tāst all do taste profiles from logged cups.
- **Gesha** has an origins heat map, but only of beans you've logged yourself.

**The gap:** nobody combines a globe of roasters that ship to you, origin-to-roaster arcs, and match scores shown geographically. The globe is the differentiator; matching alone isn't. Lead with the globe and target Canada ("ships to Ontario") first.

## Decisions so far

- **Stack:** Next.js + react-globe.gl, static JSON data (no Supabase yet), Python pipeline, Claude for extraction. Profile in localStorage, no accounts.
- **Taste model:** five axes with a weighted distance. Simple on purpose; add embeddings on tasting notes only if matching feels off.
- **Top-match lists are varied:** at most one coffee per roaster and per origin first, so the home sheet doesn't show three near-identical coffees.
- **Sample data uses fictional roasters only,** so nothing is ever attributed to a real business by mistake.
- **Monetisation later:** affiliate links first (clicks already carry `utm_source=coffeeglobe`), then featured pins or "who matches your coffee" analytics for roasters.
- **Biggest risk:** extraction quality, not the globe.

## Status

Done:
- Globe, quiz, matching, roaster and origin sheets, list view, thumbs up/down, ships-to filter
- Scraper, extraction and build pipeline
- Tests: 9 for the taste model, 15 for the pipeline, all passing

Verified (Nov 2026):
- `npm install`, `npm run build`, typecheck and both test suites pass (Next 15.5, React 19, react-globe.gl 2.38)
- The globe renders and the quiz works end to end in headless Chromium at phone (iPhone 13) and desktop (1440×900) sizes, with no console errors
- Globe textures are served from `public/textures/` rather than unpkg

Not yet verified:
- Tapping a pin on a real phone (pin taps can't be driven reliably in a headless WebGL test)
- The scraper has only run against a fixture, never a live Shopify store
- `extract.py` has never called the real API
- `npm audit` flags PostCSS bundled inside Next 15 (build-time only); the fix is the Next 16 upgrade, so do it deliberately rather than via `npm audit fix --force`

## Next steps

1. ~~Get the app building and check the globe on phone and desktop.~~ Done; still worth tapping pins on a real phone.
2. ~~Add 5–10 real roasters to `pipeline/roasters.json`.~~ Done: 9 Canadian roasters (Pilot, Subtext, Detour, Bridgehead, Phil & Sebastian, Monogram, Rogue Wave, 49th Parallel, Pallet). All allow `/products.json` in robots.txt and serve a feed.
   - `shipsTo` comes from each store's `/meta.json` (`ships_to_countries`, the countries its checkout accepts), which is more reliable than shipping-policy prose. A `*` there means "rest of world"; it's left out, so Phil & Sebastian is recorded as CA + US only.
   - `lat`/`lng` are city centres (from `/meta.json`'s city), with same-city roasters nudged about 1 km apart so their pins don't overlap.
   - Scraping these sites needs network access: sessions use the personal `coffee-globe` cloud environment, which allows exactly these hosts. Add new hosts there when adding roasters.
   - The coffee filter has since been tightened (see step 3).
3. Run `scrape.py`, then `extract.py --limit 20`. Spot-check all 20 by hand and tune the prompt. In progress on branch `feat/scrape-catalogue`:
   - Done: the coffee filter trusts a store's product type when it has one and drops multi-coffee sets, events, classes, books, chocolate, archived listings and products with no description. Scraping the 9 stores gives 179 in-stock coffees.
   - Done: `extract.py` uses the anthropic SDK with structured outputs (forced tool calls skip thinking on Haiku 5.5 and are rejected on Sonnet 5.5 / Opus 5.5), leaves room for thinking, and reports token usage.
   - Next: in a session on the `coffee-globe` cloud environment (its `EXTRACT_API_KEY` variable and setup script load at session start; cloud sessions strip `ANTHROPIC_API_KEY`, so don't use that name), check out `feat/scrape-catalogue`, run `.venv/bin/python pipeline/scrape.py` (`pipeline/out/` is not committed), then `.venv/bin/python pipeline/extract.py --limit 20` and spot-check all 20.
   - Some listings have only shipping text as a description (e.g. one Subtext lot); expect low confidence there.
   - First 20 (all 49th Parallel) spot-checked: scores and origins sound, but the prompt guessed "washed" when no process was stated and copied acidity/texture phrases as notes. Prompt tightened for both; the cache key now includes a prompt hash so prompt changes re-extract. `--per-roaster 3` sample (27 coffees) spot-checked after the change: both fixed.
   - Open: Detour and Subtext keep tasting notes outside `body_html` (Subtext's description is only shipping text), so their coffees come out with no notes and confidence 0.2-0.4, and the 0.3 cutoff in `build_data.py` drops some. Needs those notes scraped from somewhere else before scaling up.
4. Scale up to ~100 roasters, then `build_data.py`.
5. Before deploying, upgrade Next 15 to 16 and re-test on phone and desktop: `npm audit` flags PostCSS bundled in Next 15 (build-time only), and `npm audit fix --force` would do the major upgrade blind. Then deploy to Vercel and launch on r/Coffee and r/espresso, plus a short video of the globe lighting up.
6. Measure quiz completion, buy clicks (`cg.events.v1` in localStorage for now) and return visits, then add real analytics.
