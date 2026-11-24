/**
 * The site's public origin, used for absolute URLs in share cards, the sitemap and robots.txt.
 * Set NEXT_PUBLIC_SITE_URL once there's a custom domain. On Vercel, the production domain
 * (VERCEL_PROJECT_PRODUCTION_URL) and then the deployment URL (VERCEL_URL) are used until then.
 */
function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_URL = siteOrigin();
export const SITE_NAME = "Coffee Globe";
export const SITE_DESCRIPTION =
  "A globe of specialty roasters that ship to you, lit up by how well their coffee matches your taste.";
export const THEME_COLOR = "#1B130E";

/**
 * Where "Send feedback" goes. GitHub issue forms on the public repo for now (wrong match,
 * suggest a roaster, roaster requests). Set NEXT_PUBLIC_FEEDBACK_URL to use a form service
 * instead, e.g. if people without a GitHub account need a way in.
 */
export const FEEDBACK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL || "https://github.com/MusabJaseem/coffee-globe/issues/new/choose";
