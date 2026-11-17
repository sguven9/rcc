/**
 * Graphics backend selection. The flight scene renders with WebGL2 today;
 * WebGPU support is detected and reported, and the decision function is the
 * single place to switch once the custom shaders are ported (see
 * docs/rendering.md). Without WebGL2 the app shows a clear message instead
 * of crashing.
 */
export type Backend = "webgpu" | "webgl2" | "none";

export interface BackendCapabilities {
  /** `navigator.gpu` exists and an adapter was granted. */
  webgpu: boolean;
  /** A WebGL2 context could be created. */
  webgl2: boolean;
}

/** WebGPU rendering is not wired yet; flip this once the port is complete. */
export const WEBGPU_RENDERING_READY = false;

/** The backend to use for given capabilities (pure; unit-tested). */
export function chooseBackend(
  caps: BackendCapabilities,
  webgpuReady = WEBGPU_RENDERING_READY,
): Backend {
  if (caps.webgpu && webgpuReady) return "webgpu";
  if (caps.webgl2) return "webgl2";
  return "none";
}

/** A human-readable reason when no backend can render. */
export function backendMessage(caps: BackendCapabilities) {
  return caps.webgl2 || caps.webgpu
    ? ""
    : "This browser cannot create a WebGL2 context. Enable hardware acceleration or use a current Chrome, Edge, Firefox or Safari to fly.";
}

/** Probe the browser (WebGL2 synchronously, WebGPU via an adapter request). */
export async function probeBackends(): Promise<BackendCapabilities> {
  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    webgl2 = !!canvas.getContext("webgl2");
  } catch {
    webgl2 = false;
  }
  let webgpu = false;
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter(): Promise<unknown> };
      }
    ).gpu;
    webgpu = !!(gpu && (await gpu.requestAdapter()));
  } catch {
    webgpu = false;
  }
  return { webgpu, webgl2 };
}
