/**
 * Product identity: the one place that names the app. The browser UI, page
 * metadata, loading screen and documentation site read these values; change
 * the name here and rebuild.
 *
 * `storagePrefix` is deliberately independent of the name, so renaming the
 * product never wipes a pilot's saved settings.
 */
export const BRAND = {
  /** Display name (placeholder until the final name is chosen). */
  name: "SkyManisa",
  /** Short line under the name on the loading screen and in metadata. */
  tagline: "Fixed-wing RC flight simulator",
  description:
    "Fly fixed-wing RC aircraft over the Manisa field in your browser, with your own RC transmitter.",
  /** Deployed origin without a trailing slash; empty = no canonical URLs or sitemap. */
  siteUrl: "",
  /** Browser chrome colour (matches the theme background). */
  themeColor: "#14110f",
  /** Prefix of every localStorage key the app writes. */
  storagePrefix: "rcsim.",
} as const;

/** A namespaced localStorage key, e.g. storageKey("expo"). */
export const storageKey = (key: string) => BRAND.storagePrefix + key;
