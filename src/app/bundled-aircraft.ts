/** Deliberate public catalog. Keep original designer credits in each definition.
 * FT designs: Flite Test (Peter Sripol / Josh Bixler; drawings include Dan Sponholz).
 * Simple Trainer: Vortex RC. Apprentice STS and Night Radian: E-flite / Horizon Hobby.
 * Generated presets (scripts/generate-catalog-aircraft.ts) use published specifications only.
 * Plan identities and local cache: references/manifest.json.
 * These are independent engineering approximations; source artwork is not bundled.
 */
import broncoVtol from "../../aircraft/bronco-tri-vtol.json";
import bronco from "../../aircraft/ft-bronco.json";
import conventional from "../../aircraft/ft-bronco-conventional.json";
import tiny from "../../aircraft/ft-tiny-trainer.json";
import raptor from "../../aircraft/ft-22-raptor.json";
import vortex from "../../aircraft/vt-simple-trainer.json";
import quad from "../../aircraft/quad-x-5inch.json";
import detailedQuad from "../../aircraft/quad-x-6s.json";
import largeQuad from "../../aircraft/quad-x-450.json";
import simpleCub from "../../aircraft/ft-simple-cub.json";
import explorer from "../../aircraft/ft-explorer.json";
import spitfire from "../../aircraft/ft-spitfire.json";
import arrow from "../../aircraft/ft-mighty-mini-arrow.json";
import radian from "../../aircraft/ef-night-radian.json";
import apprentice from "../../aircraft/ef-apprentice-sts.json";
import { parseAircraft } from "../core/schema";

export const bundledAircraft = [
  bronco,
  conventional,
  broncoVtol,
  tiny,
  raptor,
  vortex,
  simpleCub,
  explorer,
  spitfire,
  arrow,
  radian,
  apprentice,
  quad,
  detailedQuad,
  largeQuad,
].map(parseAircraft);
