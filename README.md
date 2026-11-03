# Coffee Globe

A satellite globe of specialty roasters that ship to you. Take a seven-question taste quiz and the roasters whose coffees suit you light up in coffee-cherry red. Tap a green origin pin to see arcs to every roaster selling coffee from there.

The checked-in data is **fictional sample roasters** so the app works on day one. The pipeline replaces it with real catalogues.

## Run the app

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # taste-matching tests
```

## Load real roasters

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt

cp pipeline/roasters.example.json pipeline/roasters.json
# add roasters: id, name, city, country, lat, lng, Shopify store URL, currency, countries they ship to

python pipeline/scrape.py --only <roaster-id>       # try one store first
export ANTHROPIC_API_KEY=...
python pipeline/extract.py --limit 20                # extract 20, then spot-check pipeline/out/extracted.jsonl
python pipeline/extract.py                           # the rest (cached, so re-runs only pay for new products)
python pipeline/build_data.py                        # writes data/roasters.json and data/coffees.json
python -m pytest pipeline/tests                      # pipeline tests, no network needed
```

Check a store has a feed by opening `https://<store>/products.json` in a browser. Shipping countries come from each roaster's shipping page; they aren't in the feed.

## How matching works

Every coffee and every user is a point on five axes: acidity, sweetness, body, fruitiness and roast. Quiz answers set the user's point and how much each axis matters; match % is a weighted distance. Thumbs up pulls your profile toward a coffee, thumbs down pushes it away. See `lib/taste.ts`.

Click-throughs, quiz completions and ratings are logged to `localStorage` under `cg.events.v1` until real analytics are added.

See `CLAUDE.md` for scope and project rules, and `NOTES.md` for background, decisions and next steps.
