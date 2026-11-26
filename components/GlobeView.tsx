"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
import { countryAt, loadCountryOutlines } from "@/lib/geo/countryAt";
import countryLabels from "@/lib/geo/country-labels.json";
import type { Coffee, Origin, Roaster } from "@/lib/types";

const GlobeCanvas = dynamic(() => import("./GlobeCanvas"), {
  ssr: false,
  loading: () => <div className="globe-loading">Loading the globe</div>,
});

const CHERRY = "#D23A3F";
const LEAF = "#7E9B48";
const HUSK = "#C9B497";

type Pin =
  | { kind: "roaster"; id: string; lat: number; lng: number; name: string; sub: string; score: number | null }
  | { kind: "origin"; id: string; lat: number; lng: number; name: string; sub: string };

interface Props {
  roasters: Roaster[];
  coffees: Coffee[];
  origins: Origin[];
  bestScores: Map<string, number> | null;
  selectedRoasterId: string | null;
  selectedOriginId: string | null;
  focus: { lat: number; lng: number } | null;
  onSelectRoaster: (id: string) => void;
  onSelectOrigin: (id: string) => void;
}

/** Map a 0–100 match score to a warm ramp: husk (poor) → cherry (great). */
function matchColor(score: number | null): string {
  if (score == null) return HUSK;
  const t = Math.min(1, Math.max(0, (score - 50) / 45));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(201, 210)}, ${mix(180, 58)}, ${mix(151, 63)})`;
}

export default function GlobeView(props: Props) {
  const { roasters, coffees, origins, bestScores, selectedRoasterId, selectedOriginId, focus } = props;
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // onGlobeReady can fire before the ref is attached, so camera setup waits for this flag instead.
  const [ready, setReady] = useState(false);
  // "Looking at …" is written straight to the DOM, so camera movement never re-renders React.
  const lookingRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const g = globeRef.current;
    if (!ready || !g) return;
    let cancelled = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controls = g.controls();
    const update = () => {
      last = Date.now();
      const el = lookingRef.current;
      if (!el) return;
      const { lat, lng } = g.pointOfView();
      const name = countryAt(lat, lng);
      const text = name ?? "the ocean";
      if (el.dataset.place !== text) {
        el.dataset.place = text;
        el.textContent = text;
      }
    };
    // At most about three updates a second while the globe turns, plus one when it stops.
    const onChange = () => {
      clearTimeout(timer);
      if (Date.now() - last > 300) update();
      else timer = setTimeout(update, 300);
    };
    loadCountryOutlines().then(() => {
      if (cancelled) return;
      update();
      controls.addEventListener("change", onChange);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controls.removeEventListener("change", onChange);
    };
  }, [ready]);

  // Lay out country labels whenever the camera moves or the globe is resized. Checked every
  // animation frame but only does work after a change; writes straight to the DOM.
  useEffect(() => {
    const g = globeRef.current;
    if (!ready || !g) return;
    let raf = 0;
    let lastKey = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const c = g.camera().position;
      const key = `${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)},${wrap.clientWidth}x${wrap.clientHeight}`;
      if (key === lastKey) return;
      lastKey = key;
      layoutCountryLabels(g, wrap, lookingRef.current?.closest(".globe-hud") ?? null);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Origins that at least one visible roaster sells.
  const sellingOrigins = useMemo(() => {
    const ids = new Set(coffees.map((c) => c.originId).filter(Boolean));
    return origins.filter((o) => ids.has(o.id));
  }, [coffees, origins]);

  const pins = useMemo<Pin[]>(() => {
    const roasterPins: Pin[] = roasters.map((r) => ({
      kind: "roaster",
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      name: r.name,
      sub: r.city,
      score: bestScores?.get(r.id) ?? null,
    }));
    const originPins: Pin[] = sellingOrigins.map((o) => ({
      kind: "origin",
      id: o.id,
      lat: o.lat,
      lng: o.lng,
      name: o.name,
      sub: "Coffee origin",
    }));
    return [...originPins, ...roasterPins];
  }, [roasters, sellingOrigins, bestScores]);

  // Glowing rings on the five best-matched roasters.
  const rings = useMemo(() => {
    if (!bestScores) return [];
    return roasters
      .map((r) => ({ lat: r.lat, lng: r.lng, score: bestScores.get(r.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [roasters, bestScores]);

  // Arcs from the selected origin to every visible roaster selling it.
  const arcs = useMemo(() => {
    const origin = origins.find((o) => o.id === selectedOriginId);
    if (!origin) return [];
    const sellers = new Set(coffees.filter((c) => c.originId === origin.id).map((c) => c.roasterId));
    return roasters
      .filter((r) => sellers.has(r.id))
      .map((r) => ({ startLat: origin.lat, startLng: origin.lng, endLat: r.lat, endLng: r.lng }));
  }, [selectedOriginId, origins, coffees, roasters]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const controls = g.controls();
    controls.autoRotate = !focus && !selectedRoasterId && !selectedOriginId;
    controls.autoRotateSpeed = 0.35;
  }, [ready, focus, selectedRoasterId, selectedOriginId, size.w]);

  // Open on North America, where the roasters are.
  useEffect(() => {
    if (ready) globeRef.current?.pointOfView({ lat: 45, lng: -85, altitude: 2.3 }, 0);
  }, [ready]);

  useEffect(() => {
    if (ready && focus) globeRef.current?.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 1.6 }, 900);
  }, [ready, focus]);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div ref={wrapRef} className="globe-wrap">
      <div className="globe-hud">
        <p className="looking-at" aria-live="polite">
          Looking at <span ref={lookingRef}>…</span>
        </p>
        <p className="legend">
          <span>
            <i style={{ background: bestScores ? CHERRY : HUSK }} />
            {bestScores ? "Roasters · redder is a better match" : "Roasters"}
          </span>
          <span>
            <i style={{ background: LEAF }} />
            Where the coffee is grown
          </span>
        </p>
      </div>
      {size.w > 0 && (
        <GlobeCanvas
          globeRef={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/textures/earth-blue-marble.webp"
          bumpImageUrl="/textures/earth-topology.webp"
          atmosphereColor="#E9B98A"
          atmosphereAltitude={0.16}
          onGlobeReady={() => setReady(true)}
          pointsData={pins}
          pointLat="lat"
          pointLng="lng"
          pointColor={(d: object) => {
            const p = d as Pin;
            if (p.kind === "origin") return p.id === selectedOriginId ? "#B7D07A" : LEAF;
            return p.id === selectedRoasterId ? "#FFF3E0" : matchColor(p.score);
          }}
          pointAltitude={(d: object) => {
            const p = d as Pin;
            if (p.kind === "origin") return 0.02;
            return p.score == null ? 0.03 : 0.02 + (p.score / 100) ** 3 * 0.22;
          }}
          pointRadius={(d: object) => ((d as Pin).kind === "origin" ? 0.55 : 0.4)}
          pointResolution={8}
          pointsMerge={false}
          pointLabel={(d: object) => {
            const p = d as Pin;
            const score = p.kind === "roaster" && p.score != null ? `<b>${p.score}% match</b><br/>` : "";
            return `<div class="globe-tip">${score}${escapeHtml(p.name)}<br/><span>${escapeHtml(p.sub)}</span></div>`;
          }}
          onPointClick={(d: object) => {
            const p = d as Pin;
            if (p.kind === "roaster") props.onSelectRoaster(p.id);
            else props.onSelectOrigin(p.id);
          }}
          ringsData={reduceMotion ? [] : rings}
          ringLat="lat"
          ringLng="lng"
          ringColor={() => (t: number) => `rgba(210, 58, 63, ${1 - t})`}
          ringMaxRadius={3.2}
          ringPropagationSpeed={1.6}
          ringRepeatPeriod={1400}
          arcsData={arcs}
          arcColor={() => [LEAF, CHERRY]}
          arcStroke={0.5}
          arcAltitudeAutoScale={0.4}
          arcDashLength={0.5}
          arcDashGap={0.2}
          arcDashAnimateTime={reduceMotion ? 0 : 2200}
          // Country names as plain HTML positioned by the globe, not 3D text: 3D text added
          // ~400k triangles a frame, this adds none.
          htmlElementsData={countryLabels}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.005}
          htmlElement={countryLabelElement}
          // Visibility is handled by layoutCountryLabels (fade near the rim, no overlaps).
          htmlElementVisibilityModifier={() => {}}
          htmlTransitionDuration={0}
        />
      )}
    </div>
  );
}

type CountryLabel = (typeof countryLabels)[number];
const labelElements = new Map<string, { el: HTMLElement; w: number; h: number }>();

/** Text size follows country size: 10px for the smallest labelled countries, 14px for the largest. */
function countryLabelElement(d: object): HTMLElement {
  const label = d as CountryLabel;
  const el = document.createElement("div");
  el.className = "country-label";
  el.textContent = label.name;
  el.style.fontSize = `${Math.round(10 + ((label.size - 0.75) / (2.6 - 0.75)) * 4)}px`;
  el.style.opacity = "0";
  labelElements.set(label.name, { el, w: 0, h: 0 });
  return el;
}

/** Angle between two points on the globe, in degrees. */
function angleBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const cos =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / r;
}

/**
 * Shows the labels facing the viewer, fading them out toward the rim where flat text would
 * pile up, and skips any that would overlap a bigger country's label or the "Looking at" line.
 * Labels are pre-sorted biggest first, so big countries win.
 */
function layoutCountryLabels(g: GlobeMethods, wrap: HTMLElement, avoid: HTMLElement | null) {
  const { lat, lng } = g.pointOfView();
  const placed: [number, number, number, number][] = [];
  // Read layout first, then write, so the browser lays out once.
  if (avoid) {
    const a = avoid.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    placed.push([a.left - w.left, a.top - w.top, a.right - w.left, a.bottom - w.top]);
  }
  for (const item of labelElements.values()) {
    if (!item.w) {
      item.w = item.el.offsetWidth;
      item.h = item.el.offsetHeight;
    }
  }
  for (const label of countryLabels) {
    const item = labelElements.get(label.name);
    if (!item) continue;
    const angle = angleBetween(lat, lng, label.lat, label.lng);
    const opacity = angle < 45 ? 1 : angle > 68 ? 0 : 1 - (angle - 45) / 23;
    let show = opacity > 0 && item.w > 0;
    if (show) {
      const { x, y } = g.getScreenCoords(label.lat, label.lng, 0.005);
      const box: [number, number, number, number] = [x - item.w / 2 - 4, y - item.h / 2 - 2, x + item.w / 2 + 4, y + item.h / 2 + 2];
      show = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      if (show) placed.push(box);
    }
    item.el.style.opacity = show ? opacity.toFixed(2) : "0";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
