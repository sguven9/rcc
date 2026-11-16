/** Compatibility identifiers shared by schemas, simulation, CLI and documentation. */
export const SIM_VERSION = "0.13.0";
/**
 * Earlier simulation versions whose recordings replay bit-for-bit under the
 * current engine. 0.11.0 (propeller parameters, discrete gusts) and 0.12.0
 * (dynamic shaft speed) only add opt-in effects, so older recordings are
 * upgraded on import.
 */
export const REPLAY_COMPATIBLE_SIM_VERSIONS = [
  "0.10.0",
  "0.11.0",
  "0.12.0",
] as const;
export const AIRCRAFT_FORMAT_VERSION = 1;
