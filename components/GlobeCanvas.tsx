"use client";

// Imported only on the client (see GlobeView). Kept separate so the ref can be
// passed as a normal prop: next/dynamic does not forward refs.
import Globe, { type GlobeMethods } from "react-globe.gl";
import type { ComponentProps, MutableRefObject } from "react";

type Props = ComponentProps<typeof Globe> & {
  globeRef: MutableRefObject<GlobeMethods | undefined>;
};

export default function GlobeCanvas({ globeRef, ...props }: Props) {
  return <Globe ref={globeRef} {...props} />;
}
