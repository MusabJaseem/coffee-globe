import { ImageResponse } from "next/og";

// Home-screen icon for iOS, which doesn't use SVG icons. Same design as app/icon.svg.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1b130e" }}>
        <div style={{ width: 124, height: 124, borderRadius: 62, background: "#2e5d8a", display: "flex", position: "relative" }}>
          <div style={{ position: "absolute", left: 18, top: 50, width: 88, height: 12, borderRadius: 6, background: "#7e9b48" }} />
          <div style={{ position: "absolute", left: 10, top: 78, width: 100, height: 12, borderRadius: 6, background: "#7e9b48" }} />
          <div style={{ position: "absolute", left: 66, top: 14, width: 36, height: 36, borderRadius: 18, background: "#d23a3f" }} />
        </div>
      </div>
    ),
    size,
  );
}
