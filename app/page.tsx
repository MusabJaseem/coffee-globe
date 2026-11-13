"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import CoffeeRow from "@/components/CoffeeRow";
import GlobeView from "@/components/GlobeView";
import Quiz from "@/components/Quiz";
import { COUNTRIES, coffees, isSampleData, originById, origins, roasterById, roasters, shipsTo } from "@/lib/data";
import { applyFeedback, bestScoreByRoaster, diversify, profileFromAnswers, rankCoffees, type RankedCoffee } from "@/lib/taste";
import type { Coffee, UserProfile } from "@/lib/types";

const PROFILE_KEY = "cg.profile.v1";
const COUNTRY_KEY = "cg.country.v1";
const EVENTS_KEY = "cg.events.v1";

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the session still works, it just won't be remembered */
  }
}
/** Minimal event log until real analytics exist. Read it with localStorage in devtools. */
function track(event: string, data: Record<string, unknown> = {}) {
  const log = load<unknown[]>(EVENTS_KEY) ?? [];
  log.push({ event, at: new Date().toISOString(), ...data });
  save(EVENTS_KEY, log.slice(-500));
}

type Panel = "home" | "roaster" | "origin" | "list";

export default function Home() {
  const [country, setCountry] = useState("CA");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("home");
  const [roasterId, setRoasterId] = useState<string | null>(null);
  const [originId, setOriginId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setProfile(load<UserProfile>(PROFILE_KEY));
    setCountry(load<string>(COUNTRY_KEY) ?? "CA");
    track("open");
  }, []);

  const visibleRoasters = useMemo(() => roasters.filter((r) => shipsTo(r, country)), [country]);
  const visibleCoffees = useMemo(() => {
    const ids = new Set(visibleRoasters.map((r) => r.id));
    return coffees.filter((c) => ids.has(c.roasterId));
  }, [visibleRoasters]);

  const ranked = useMemo(() => (profile ? rankCoffees(profile, visibleCoffees) : null), [profile, visibleCoffees]);
  const bestScores = useMemo(() => (ranked ? bestScoreByRoaster(ranked) : null), [ranked]);
  const scoreOf = useMemo(() => new Map(ranked?.map((r) => [r.coffee.id, r.score]) ?? []), [ranked]);

  const roaster = roasterId ? roasterById.get(roasterId) : undefined;
  const origin = originId ? originById.get(originId) : undefined;

  const focus = roaster ?? origin ?? null;

  function rowsFor(list: Coffee[]): RankedCoffee[] {
    if (!ranked) return list.map((coffee) => ({ coffee, score: -1 }));
    const ids = new Set(list.map((c) => c.id));
    return ranked.filter((r) => ids.has(r.coffee.id));
  }

  function updateProfile(p: UserProfile) {
    setProfile(p);
    save(PROFILE_KEY, p);
  }

  function finishQuiz(answers: Record<string, number>) {
    updateProfile(profileFromAnswers(answers));
    setQuizOpen(false);
    setPanel("home");
    setRoasterId(null);
    setOriginId(null);
    track("quiz_complete", { answers });
  }

  function rate(c: Coffee, liked: boolean) {
    if (!profile) return;
    updateProfile(applyFeedback(profile, c, liked));
    track(liked ? "like" : "dislike", { coffee: c.id });
  }

  function selectRoaster(id: string) {
    setRoasterId(id);
    setOriginId(null);
    setShowAll(false);
    setPanel("roaster");
    track("roaster_open", { roaster: id });
  }

  function selectOrigin(id: string) {
    setOriginId(id);
    setRoasterId(null);
    setShowAll(false);
    setPanel("origin");
    track("origin_open", { origin: id });
  }

  function goHome() {
    setPanel("home");
    setRoasterId(null);
    setOriginId(null);
  }

  function changeCountry(code: string) {
    setCountry(code);
    save(COUNTRY_KEY, code);
    goHome();
  }

  const ratingOf = (id: string) =>
    profile?.liked.includes(id) ? "liked" : profile?.disliked.includes(id) ? "disliked" : null;

  const renderRows = (rows: RankedCoffee[], showRoaster: boolean) => (
    <ul className="coffees">
      {rows.map(({ coffee, score }) => (
        <CoffeeRow
          key={coffee.id}
          coffee={coffee}
          score={score >= 0 ? score : null}
          showRoaster={showRoaster}
          rating={ratingOf(coffee.id)}
          onRate={rate}
          onBuy={(c) => track("buy_click", { coffee: c.id, roaster: c.roasterId, score: scoreOf.get(c.id) })}
        />
      ))}
    </ul>
  );

  let sheet: ReactNode;
  if (panel === "roaster" && roaster) {
    const rows = rowsFor(visibleCoffees.filter((c) => c.roasterId === roaster.id));
    const shown = showAll ? rows : rows.slice(0, 3);
    sheet = (
      <>
        <header className="sheet-head">
          <div>
            <h2>{roaster.name}</h2>
            <p className="sheet-sub">
              {roaster.city}. Ships to {roaster.shipsTo.length > 3 ? `${roaster.shipsTo.length} countries` : roaster.shipsTo.join(", ")}.
            </p>
          </div>
          <button className="text-btn" onClick={goHome}>
            Close
          </button>
        </header>
        {profile ? <p className="sheet-lead">Your best matches here</p> : null}
        {renderRows(shown, false)}
        {rows.length > 3 && !showAll && (
          <button className="text-btn more" onClick={() => setShowAll(true)}>
            Show all {rows.length} coffees
          </button>
        )}
        {!profile && <QuizPrompt onStart={() => setQuizOpen(true)} compact />}
      </>
    );
  } else if (panel === "origin" && origin) {
    const rows = rowsFor(visibleCoffees.filter((c) => c.originId === origin.id));
    const sellerCount = new Set(rows.map((r) => r.coffee.roasterId)).size;
    sheet = (
      <>
        <header className="sheet-head">
          <div>
            <h2>{origin.name}</h2>
            <p className="sheet-sub">
              {sellerCount} {sellerCount === 1 ? "roaster ships" : "roasters ship"} coffee from here to you.
            </p>
          </div>
          <button className="text-btn" onClick={goHome}>
            Close
          </button>
        </header>
        {renderRows(showAll ? rows : rows.slice(0, 3), true)}
        {rows.length > 3 && !showAll && (
          <button className="text-btn more" onClick={() => setShowAll(true)}>
            Show all {rows.length} coffees
          </button>
        )}
      </>
    );
  } else if (panel === "list" && ranked) {
    sheet = (
      <>
        <header className="sheet-head">
          <div>
            <h2>Your top matches</h2>
            <p className="sheet-sub">From roasters that ship to {COUNTRIES.find((c) => c.code === country)?.name}.</p>
          </div>
          <button className="text-btn" onClick={goHome}>
            Back to globe
          </button>
        </header>
        {renderRows(diversify(ranked, 20), true)}
      </>
    );
  } else if (ranked) {
    sheet = (
      <>
        <header className="sheet-head">
          <div>
            <h2>Matched to your taste</h2>
            <p className="sheet-sub">Red pins are your closest matches. Tap one, or a green origin.</p>
          </div>
          <button className="text-btn" onClick={() => setQuizOpen(true)}>
            Retake quiz
          </button>
        </header>
        {renderRows(diversify(ranked, 3), true)}
        <button className="primary" onClick={() => setPanel("list")}>
          See all your matches
        </button>
      </>
    );
  } else {
    sheet = <QuizPrompt onStart={() => setQuizOpen(true)} roasterCount={visibleRoasters.length} />;
  }

  return (
    <main className="app">
      <GlobeView
        roasters={visibleRoasters}
        coffees={visibleCoffees}
        origins={origins}
        bestScores={bestScores}
        selectedRoasterId={roasterId}
        selectedOriginId={originId}
        focus={focus ? { lat: focus.lat, lng: focus.lng } : null}
        onSelectRoaster={selectRoaster}
        onSelectOrigin={selectOrigin}
      />

      <nav className="topbar">
        <span className="wordmark">Coffee Globe</span>
        <label className="ship">
          <span>Ships to</span>
          <select value={country} onChange={(e) => changeCountry(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {isSampleData && (
          <p className="sample-note">Sample roasters for testing. Run the data pipeline to load real ones.</p>
        )}
      </nav>

      <section className={`sheet${panel === "list" ? " tall" : ""}`} aria-live="polite">
        {sheet}
      </section>

      {quizOpen && <Quiz onDone={finishQuiz} onClose={() => setQuizOpen(false)} />}
    </main>
  );
}

function QuizPrompt({ onStart, roasterCount, compact }: { onStart: () => void; roasterCount?: number; compact?: boolean }) {
  if (compact) {
    return (
      <button className="primary" onClick={onStart}>
        Take the taste quiz to see your matches
      </button>
    );
  }
  return (
    <>
      <h2 className="intro">Find coffee you’ll love from roasters that ship to you.</h2>
      <p className="sheet-sub">
        {roasterCount} roasters on the globe. Answer seven quick questions and the ones that suit your taste light up.
      </p>
      <button className="primary" onClick={onStart}>
        Take the taste quiz
      </button>
    </>
  );
}
