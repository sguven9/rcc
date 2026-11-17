# Your first flight

The simulator runs in your browser. You can fly, edit aircraft and save local versions
without signing in or connecting an AI service.

## Before you start

You need a modern desktop browser and an RC transmitter that connects by USB. For local development, install Node.js 24 first, then follow the commands below. If you already have the simulator open, skip to [Choose an aircraft](#choose-an-aircraft).

## Run locally

Use Node.js 24 and the included npm lockfile. Supported versions are declared in
`package.json`.

```sh
git clone YOUR_REPOSITORY_URL simulator
cd simulator
npm ci
npm run dev
```

Open the URL Vite prints. The simulator is at the root; documentation is at
`/docs/` on the same address. To use a particular port:

```sh
npm run dev -- --port 5180
```

## Choose an aircraft

Open **Fly → Flight setup → Aircraft → Browse aircraft**. The hangar shows the
actual simulator models. **FT Tiny Trainer · Sport** has roll, pitch and yaw
controls. **Simple Trainer** is Vortex RC's polyhedral rudder/elevator trainer:
use yaw to turn it. Both **FT Bronco** tail configurations are available.

The published examples have estimated physics. See [model limits](validation.md)
before treating simulator performance as a prediction of a physical build.

## Start flying

On the first visit a setup wizard calibrates your transmitter (see
[set up your transmitter](controllers.md#setup-wizard)). New sessions begin on
the ground with zero throttle, in FPV. Select the launch that suits the exercise:

| Start      | What happens                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ground     | Start stationary, increase power, then gently pull back as speed builds. Optional removable gear adds 45 g to aircraft without installed wheels. |
| Hand throw | Release at 8.5 m/s with calculated pitch trim and power for an 8° climb.                                                                         |
| In flight  | Begin at altitude at the aircraft's authored trim speed.                                                                                         |

Lower the throttle fully and press **Start flight**; a flight does not start
with the throttle up. **Enter / P / R** start, pause and reset; **V** changes
the view and **F** locates the aircraft.

**FPV** flies from the onboard camera with an on-screen display. **Pilot** keeps
you on the ground. **Position & view** places the aircraft and observer on
one map. The lower-left instruments show orientation and a minimap.

Focus loss pauses flight. Return to the field and deliberately resume. Reset
returns to the selected launch state; it does not remove aircraft edits.

## Your transmitter

The [setup wizard](controllers.md#setup-wizard) detects the stick mode, centres,
endpoints, channels and directions. Run it again from **Controllers → Run setup
wizard**. To connect a FlySky radio or an Arduino bridge, see
[choose a radio connection](radio-setup.md).

## Keep your changes

Use **Aircraft → History → Save version** before experimenting. **Apply to flight**
validates and saves the edited setup. **Export history** makes a portable backup;
browser storage belongs to this browser and address.

Continue with [Edit & save an aircraft](aircraft-editor.md) or
[build with an agent](agent-workflow.md).

Learn [views, pilot movement and flight setup](flight-guide.md) when you are comfortable with the basic controls.

## If something is wrong

The [troubleshooting guide](troubleshooting.md) covers connection errors, stopped input, sensitivity and lost edits.

- **No transmitter found:** click the page and move a stick. Check that your radio or adapter presents USB joystick input; a firmware-update cable is different.
- **The aircraft moved after an update:** custom definitions stay local. Use Restore original aircraft to adopt the current preset, or restore a saved version.
- **The aircraft will not trim:** check mass, CG, throws and power. A valid JSON definition can still describe an unflyable setup.
- **Changes disappeared after switching address:** localhost ports and the hosted domain have separate browser storage. Import an exported backup.
