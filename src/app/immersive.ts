/**
 * Immersive flight mode: full screen plus a body class that hides every panel
 * (see view/osd.css). Full screen needs a user gesture; without one the page
 * stays windowed but the interface is still hidden.
 */
export interface ImmersiveDocument {
  body: { classList: { toggle(name: string, on: boolean): unknown } };
  documentElement: { requestFullscreen?: () => Promise<void> };
  fullscreenElement: unknown;
  exitFullscreen?: () => Promise<void>;
}
export const IMMERSIVE_CLASS = "flight-immersive";

export function setImmersive(doc: ImmersiveDocument, on: boolean) {
  doc.body.classList.toggle(IMMERSIVE_CLASS, on);
  if (on && !doc.fullscreenElement)
    void doc.documentElement.requestFullscreen?.().catch(() => {});
  if (!on && doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => {});
}

/** The OSD is the FPV goggles' overlay: shown only in the FPV camera. */
export function osdShown(enabled: boolean, camera: "fpv" | "ground") {
  return enabled && camera === "fpv";
}
