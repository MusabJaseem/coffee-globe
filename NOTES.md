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
- **Real data comes only from the pipeline,** so nothing is attributed to a real business unless their own listing says it. The fictional sample roasters used before the first real build are in git history; hand-made test data stays fictional.
- **Monetisation later:** affiliate links first (clicks already carry `utm_source=coffeeglobe`), then featured pins or "who matches your coffee" analytics for roasters.
- **Biggest risk:** extraction quality, not the globe.

## Status

Done:
- Globe, quiz, matching, roaster and origin sheets, list view, thumbs up/down, ships-to filter
- Scraper, extraction and build pipeline
- Tests: 9 for the taste model, 45 for the pipeline, all passing. GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, both suites and the build on every push.

Verified (Nov 2026):
- The scraper and `extract.py` against the 9 live stores and the real API; the quiz on the real catalogue lights up roasters and the buy links open roasters' own product pages
- `npm install`, `npm run build`, typecheck and both test suites pass (Next 16.4, React 19, react-globe.gl 2.38); `npm audit` is clean
- The globe renders and the quiz works end to end in headless Chromium at phone (iPhone 13) and desktop (1440×900) sizes, with no console errors
- Globe textures are served from `public/textures/` rather than unpkg

Not yet verified:
- Tapping a pin on a real phone (pin taps can't be driven reliably in a headless WebGL test)

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
   - Correction: 49th Parallel's process is in its tags ("Processing Method_Washed Process"), so the three "guessed washed" results in the first spot-check were right. The prompt change still stands.
   - Detour and Subtext keep tasting notes in the product page's meta description, not in `/products.json`. `"pageSummary": true` in `roasters.json` makes `scrape.py` fetch each kept product page (robots.txt checked, 1 req/s) and add that summary. Their coffees went from no notes and confidence 0.2-0.4 to notes and 0.5-0.8.
   - Full run done: 160 extractions, 0 failures, about 334k input and 57k output tokens on Haiku 5.5. `build_data.py` gives 9 roasters and 161 coffees. Tasting packs, sample boxes and espresso tools are now filtered out at scrape time.
   - Repeat listings: `build_data.py` keeps one coffee per roaster and title-without-roast-date, preferring the undated listing (Subtext's dated San Antonio Ozolotepec lots). Espresso and filter versions stay separate. 159 coffees after this.
   - The real build (9 roasters, 161 coffees) replaced the fictional sample in `data/`.
4. Scale up to ~100 roasters. First round done: 48 roasters in `pipeline/roasters.json` (29 Canadian, 19 US); 47 have coffees in stock, giving 749 coffees from 908 scraped.
   - 72 candidates (from memory) were allowed and checked with `add_roasters.py`. 39 passed. 33 failed: 15 not on Shopify (Hatch, Matchstick, Timbertrain, Prototype, Moja, Dispatch, Myriade, Laughing Whale, Crankhouse, Oso Negro, Little Victories, Structure, Ritual, Coava, Brandywine), 7 don't ship to Canada (Kicking Horse, Elm, Temple, Partners, Methodical, Ruby, Ceremony), 11 unreachable or wrong domain (Smile Tiger, Reunion Island, Kittel, Zab, Traffic, Paquebot, Anchored, Ethica, Luna, Olympia, Flowerchild). Their hosts were removed from the allowlist.
   - The environment's allowlist seems to cap at about 128 hosts (two per roaster). To go past ~60 roasters, ask for broader network access or drop the `www.` twin where a store doesn't redirect.
   - Filter fixes along the way: typed products are judged by type and title, not tags (Heart and Passenger tag coffees with paired gear or subscriptions); "Coffees" and "Café" count as coffee types; per-roaster `coffeeTypes` (Black & White's "Retail SO/YR"); machines, servers, packs, kits, sets, clubs, calendars and "we choose" picks are filtered; `<style>`/`<script>` contents are stripped (Sam James).
   - Page summaries on for Detour, Subtext, Sam James, Rogue Wave, Pallet, Pilot, Stumptown, Balzac's and Muskoka. Not helpful for Phil & Sebastian, Heart, Thom Bargen, Sightglass, Onyx or Verve (story-style descriptions, no notes on the page either), so some of their coffees fall under the 0.3 confidence cutoff.
   - September has 5 coffees with descriptions in stock and none is a drinkable coffee (brew water, recipes), so it isn't on the globe until it restocks.
   - Spot-check of 24 new coffees, one per roaster: origins, processes and notes match the listings. One loose call: a four-origin blend (Fratello Godfather) got its first-listed origin.
   - Full extraction: 672 new, 0 failures, 1.39M input / 228k output tokens on Haiku 5.5. The globe has at most 69 points; the data adds about 55 KB gzipped to the page.
   - Rule changed (Nov 2026): a roaster qualifies if it ships to Canada **or** the US (`add_roasters.py --ships-to CA,US`). Added the 7 that had failed only for not shipping to Canada: Kicking Horse (its .com store ships to the US only), Elm, Temple, Partners, Methodical, Ruby, Ceremony. Now 54 roasters (29 in Canada, 25 in the US) and 853 coffees; 47 ship to Canada, 46 to the US. 173 extractions, about 352k input / 56k output tokens.
   - Titles with "wholesale" (Ruby lists most coffees three times) or "private label" (Temple) are filtered out.
   - Known store data issue: Methodical's "Honduras, Walter Bautista" page carries an Ethiopian coffee's description, so it's extracted as Ethiopian. Left as the store has it.
   - Kicking Horse descriptions have almost no tasting notes, so only 2 of its 9 coffees pass the confidence cutoff.
   - Next: more roasters (the allowlist cap is the constraint) and a weekly refresh, since stock changes fast.
5. ~~Upgrade Next 15 to 16.~~ Done (16.4.5): audit clean, and the quiz flow re-tested in headless Chromium at phone and desktop sizes with no errors. Next 16 rewrote `tsconfig.json` (`jsx: react-jsx`) and `next-env.d.ts` on first build. Still worth tapping pins on a real phone before launch. Then deploy to Vercel (checklist below) and launch on r/Coffee and r/espresso, plus a short video of the globe lighting up.
- **Ships-to menu (Nov 2026):** Canada, United States, Elsewhere. "Elsewhere" shows every roaster with a just-browsing note, for visitors outside North America who want to explore origins or take the quiz; shipping there isn't checked. A legend under "Looking at" reads "Roasters" and "Coffee origins" ("Roasters (glowing = best matches)" after the quiz). After the quiz every roaster pin is the same red and the same height (shades of red and heights were hard to read); the 5 best-matched roasters glow. With "reduce motion" on there are no rings, so those 5 stand a little taller instead.
6. Measure quiz completion, buy clicks (`cg.events.v1` in localStorage for now) and return visits, then add real analytics.
   - Vercel Web Analytics is wired in (`<Analytics />` in `app/layout.tsx`); enable it in the Vercel project's Analytics tab. Page views work on the free plan. `track()` in `app/page.tsx` also sends `quiz_complete`, `buy_click` (coffee, roaster, score) and `feedback_click`; custom events may need a paid Vercel plan. Quiz answers are never sent. The About panel's "Your data" paragraph says this; update it if what's sent changes, and update "Independent" once affiliate links start.
   - Feedback goes to GitHub issue forms (`.github/ISSUE_TEMPLATE/`): wrong match, suggest a roaster, roaster requests (fix or remove a listing). Reporters need a GitHub account; set `NEXT_PUBLIC_FEEDBACK_URL` to switch to a form service.

## Deploying to Vercel

Ready in the repo: page metadata and share cards (`app/layout.tsx`, `app/opengraph-image.tsx`), icons (`app/icon.svg`, `app/apple-icon.tsx`), `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, and `engines.node >=20.9` in `package.json`. Every route is static, and the build needs no network.

1. On vercel.com: Add New → Project → import `MusabJaseem/coffee-globe`. The defaults are right (Next.js preset, `npm run build`, root directory `/`). No environment variables are needed to build.
2. After the first deploy, open the site on a phone: take the quiz, tap red roaster pins and green origin pins, and try a buy link.
3. Share cards use the Vercel production domain automatically. With a custom domain, set `NEXT_PUBLIC_SITE_URL` (e.g. `https://coffeeglobe.ca`) in the project's environment variables and redeploy.
4. Check the share card with a link-preview tool or by pasting the URL into a chat app.
5. `pipeline/` isn't part of the deployed app. Data changes ship by committing a new `data/` build.

