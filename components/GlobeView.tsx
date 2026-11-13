"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
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
      {size.w > 0 && (
        <GlobeCanvas
          globeRef={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/textures/earth-blue-marble.jpg"
          bumpImageUrl="/textures/earth-topology.png"
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
        />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
