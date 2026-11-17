import type { Aircraft } from "../core/schema";
import { escape } from "./dom";

/**
 * Small, explicit attribution; never infer authorship from a physics citation.
 * Plain text: the app shows no outbound links (the URL stays in the JSON).
 */
export function aircraftCredit(aircraft: Aircraft): string {
  const credit = aircraft.credit;
  if (!credit) return "";
  return `Design by ${escape(credit.name)}`;
}
