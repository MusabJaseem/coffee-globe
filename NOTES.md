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
2. Add 5–10 real roasters to `pipeline/roasters.json` (copy `roasters.example.json`). Check each store's `/products.json` in a browser and its shipping page for `shipsTo`.
3. Run `scrape.py`, then `extract.py --limit 20`. Spot-check all 20 by hand and tune the prompt.
4. Scale up to ~100 roasters, then `build_data.py`.
5. Deploy to Vercel and launch on r/Coffee and r/espresso, plus a short video of the globe lighting up.
6. Measure quiz completion, buy clicks (`cg.events.v1` in localStorage for now) and return visits, then add real analytics.
