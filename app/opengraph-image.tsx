import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { coffees, roasters } from "@/lib/data";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// The share card for links to the site, rendered once at build time.
export const alt = `${SITE_NAME}: ${SITE_DESCRIPTION}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fontDir = join(process.cwd(), "node_modules/@fontsource");

export default async function OpenGraphImage() {
  // ImageResponse reads woff but not woff2.
  const [display, body] = await Promise.all([
    readFile(join(fontDir, "bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff")),
    readFile(join(fontDir, "figtree/files/figtree-latin-500-normal.woff")),
  ]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#1b130e", color: "#f4ead9", fontFamily: "Figtree" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 0 0 80px", width: 700 }}>
          <div style={{ fontFamily: "Bricolage", fontSize: 92, lineHeight: 1 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 38, lineHeight: 1.3, marginTop: 28, color: "#efe2cc" }}>
            Find coffee you’ll love from roasters that ship to you.
          </div>
          <div style={{ fontSize: 28, marginTop: 36, color: "#9c8670" }}>
            {`${roasters.length} roasters · ${coffees.length} coffees · a 60-second taste quiz`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
          <div
            style={{
              width: 380, height: 380, borderRadius: 190, display: "flex", position: "relative",
              background: "radial-gradient(circle at 35% 30%, #3f78ad, #1d3d5e 70%)",
              boxShadow: "0 0 90px 10px rgba(210, 120, 60, 0.35)",
            }}
          >
            {[[120, 95], [175, 130], [90, 200], [250, 230], [210, 300]].map(([x, y], i) => (
              <div key={i} style={{ position: "absolute", left: x, top: y, width: 26, height: 26, borderRadius: 13, background: i < 3 ? "#d23a3f" : "#7e9b48" }} />
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: display, weight: 800, style: "normal" },
        { name: "Figtree", data: body, weight: 500, style: "normal" },
      ],
    },
  );
}
