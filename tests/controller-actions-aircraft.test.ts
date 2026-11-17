import { afterEach, expect, it, vi } from "vitest";
import { ControllerActions } from "../src/app/controller-actions";
import { defaultProfile, type InputManager } from "../src/input/controls";

afterEach(() => vi.unstubAllGlobals());
it("drops saved bindings of removed VTOL actions silently and keeps edge-triggered shortcuts", () => {
  const elements = new Map<string, any>();
  const el = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "flight-input-type" ? "transmitter" : "",
        innerHTML: "",
        textContent: "",
        hidden: false,
        dataset: {},
        classList: { toggle: vi.fn() },
        toggleAttribute: vi.fn(),
      });
    return elements.get(id);
  };
  vi.stubGlobal("document", {
    getElementById: el,
    querySelector: el,
    querySelectorAll: () => [],
    addEventListener: () => {},
  });
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key.startsWith("rcsim.actions.")
        ? JSON.stringify({
            reset: "b0",
            vtolMode: "b1",
            vtolHover: "a4-",
            vtolCruise: "a4+",
          })
        : null,
    setItem: vi.fn(),
  });
  const device = {
    id: "test-radio",
    axes: [0, 0, 0, 0, 0],
    buttons: [{ value: 0 }, { value: 0 }],
    mapping: "",
  };
  const input = {
    selected: () => device,
    profile: defaultProfile(device.id),
    source: "controller",
  } as unknown as InputManager;
  const perform = vi.fn();
  const actions = new ControllerActions(input, perform);
  actions.update(true, {});
  // The stored VTOL switch bindings are ignored; the valid reset binding stays.
  expect(actions.bindings).toEqual({ reset: "b0" });
  expect(el("controller-actions").innerHTML).not.toContain("vtol");
  expect(el("flight-shortcut-legend").innerHTML).not.toContain("VTOL");
  // Button 1 was the old VTOL switch: it now triggers nothing.
  device.buttons[1].value = 1;
  actions.update(true, {});
  expect(perform).not.toHaveBeenCalled();
  device.buttons[0].value = 1;
  actions.update(true, {});
  expect(perform).toHaveBeenLastCalledWith("reset");
  // Held buttons never repeat.
  actions.update(true, {});
  expect(perform).toHaveBeenCalledTimes(1);
  device.buttons[0].value = 0;
  actions.update(true, {});
  device.buttons[0].value = 1;
  actions.update(true, {});
  expect(perform).toHaveBeenCalledTimes(2);
});
