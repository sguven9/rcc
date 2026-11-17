/** Labels describe what activation will do, including terminal/replay states. */
export interface FlightSessionState {
  running: boolean;
  started: boolean;
  status: string;
  replay: boolean;
  replayComplete: boolean;
  inputReady?: boolean;
}

/** A solved release is not evidence of realistic handling away from that point. */
export function flightModelNote(state: {
  handLaunch: boolean;
  converged: boolean;
  pitchTrim: number;
  trimSpeedMps?: number;
}) {
  if (!state.converged)
    return {
      limited: true,
      text: `Trim failed at ${state.trimSpeedMps ?? (state.handLaunch ? 8.5 : 12)} m/s. Review mass, CG and control authority.`,
    };
  if (Math.abs(state.pitchTrim) >= 0.65)
    return {
      limited: true,
      text: `High pitch trim (${state.pitchTrim >= 0 ? "+" : ""}${Math.round(state.pitchTrim * 100)}%). Power changes need pitch correction. Aircraft coefficients are estimates.`,
    };
  return {
    limited: false,
    text: "Unstabilized controls. Aircraft coefficients are estimates.",
  };
}
export function flightAction(state: FlightSessionState) {
  if (state.running) return "Pause flight";
  if (state.replay)
    return state.replayComplete || ["crashed", "landed"].includes(state.status)
      ? "Replay again"
      : state.started
        ? "Resume replay"
        : "Play replay";
  if (state.inputReady === false) return "Set up controller";
  if (["crashed", "landed"].includes(state.status)) return "Restart flight";
  return state.started ? "Resume flight" : "Start flight";
}

/** One source for flight feedback; a stopped replay is never described as a live crash. */
export function flightFeedback(
  state: FlightSessionState & {
    mode: "ground" | "hand" | "airborne";
    keyboard: boolean;
    pauseReason?: string;
  },
) {
  const power = state.keyboard
    ? "hold Space to raise power"
    : "raise your throttle";
  if (state.replay)
    return {
      title: state.replayComplete
        ? "Replay complete"
        : state.running
          ? "Playing recording"
          : "Recording paused",
      detail: state.replayComplete
        ? "Replay again, or reset for a new flight."
        : "Recorded controls · flight input is disabled.",
      tone: "replay",
    };
  if (state.inputReady === false)
    return {
      title: "Transmitter not connected",
      detail: "Connect your RC transmitter by USB, then move a stick.",
      tone: "input",
    };
  if (state.status === "crashed")
    return {
      title: "Airframe impact",
      detail: "Restart flight to try again from your launch position.",
      tone: "impact",
    };
  if (state.status === "landed")
    return {
      title: "Landing complete",
      detail: "Restart flight when you are ready for another attempt.",
      tone: "landed",
    };
  if (!state.running && state.started)
    return {
      title: "Flight paused",
      detail:
        state.pauseReason || "Your aircraft will stay here until you resume.",
      tone: "paused",
    };
  if (!state.running)
    return {
      title:
        state.mode === "ground"
          ? "Ready on the ground"
          : state.mode === "hand"
            ? "Ready to hand launch"
            : "Ready in flight",
      detail:
        state.mode === "ground"
          ? `Start flight, then ${power}.`
          : "Start flight when your controls are ready.",
      tone: "ready",
    };
  if (state.status === "grounded")
    return {
      title: "On the ground",
      detail: `Build airspeed, then gently pull back${state.keyboard ? " (↓)" : ""}.`,
      tone: "ground",
    };
  return { title: "In flight", detail: "", tone: "flying" };
}
