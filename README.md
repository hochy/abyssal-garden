# Abyssal Garden VR

**A dreamy underwater world you can swim through, in your browser or in a Meta Quest 3.**

Towering kelp forests, sunbeams pouring through a rippling surface, a sunken ship, manta rays gliding overhead.
And all of it is made by code: no images, no 3D models, no sound files. The whole world fits in **one HTML file** of about 100 KB.

This is a fork of [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Noniv (MIT license) that adds a
**virtual reality mode** for Meta Quest 3. The original desktop and phone version is unchanged and still works the same way.

![Kelp forest with a stone whale tail and a manta ray](.github/screenshots/whale-fluke.jpg)

## Try it in VR (Meta Quest 3)

1. Put on the headset and open **https://abyssal-garden-vr.vercel.app** in the **Meta Quest Browser**.
2. Wait while the world is built (the loading bar fills; it can take a little while on the headset).
3. Press **Enter VR**.

VR uses WebGPU inside WebXR, which the Quest Browser added in 2026 (experimental from version 146, listed as supported in
version 156). Where a browser has WebXR and WebGPU but not the two joined up, VR still starts: each eye is drawn with
WebGPU and copied into an ordinary WebGL VR session. That costs one copy per eye, so it is a little slower, but it opens
the door to other headsets (for example Steam Frame or Apple Vision Pro browsers with WebGPU). The idea comes from
[strayer's fork](https://github.com/strayer/abyssal-garden-vr). If **Enter VR** is missing or the menu says VR did not
start, update the browser; on older Quest Browser versions turn on **WebXR experiments** in `chrome://flags`. The page must be opened over `https://` (or `localhost`): browsers do
not allow VR on a file opened straight from disk.

### VR controls

| | Controllers | Hands |
|---|---|---|
| Swim where you look | Left stick | |
| Swim where you point | Hold the trigger | Pinch and hold |
| Rise / sink | Right stick up / down | |
| Turn | Right stick left / right | Turn your body |
| Swim faster | Hold grip | |
| Next viewpoint | A / X | |

These are the defaults, and the start menu lists them next to the keyboard keys. **To change them, click a control in
the VR controls list** (on the computer, or with the controller's laser on the Quest before you enter VR):

- **Swim where you look** switches between the left and right stick. The other stick then turns and rises / sinks, so
  left-handed players can swim with the right hand.
- **Swim where you point** can be the trigger, the grip, or off.
- **Swim faster** can be the grip, the trigger, a stick press, B / Y, A / X, or off.
- **Next viewpoint** can be A / X, B / Y, a stick press, or off.

Each click moves to the next choice and skips buttons already used by another action. **Reset VR controls** puts the
defaults back. The choices are saved in the browser and kept between visits.

### Comfort

Set in the menu before you press **Enter VR**; the page remembers them.

- **Snap turn / Smooth turn**: snap turns 30° per push of the right stick; smooth turns continuously.
- **Vignette on / off**: darkens the edges of your view while you swim or smooth-turn, which helps with motion sickness.

Swimming is slower in VR than on the desktop (3 m/s, 9 m/s holding grip) and speeds up and slows down gently.
Rock is solid: if you lean or swim into a wall you are pushed back out.

### Detail and resolution in VR

Two separate settings decide how VR looks and runs:

- **Detail** (Low / Medium / High in the menu) decides how much is in the world: leaves, shadows, anti-aliasing.
  The Quest starts on **Low**, the setting that runs smoothly on a Quest 3. Medium and High glitch on the headset.
  The page remembers the last level you picked, so switch back to Low if you tried another one.
- **VR resolution** (`xrscale`) is how many pixels each eye draws, as a share of the headset's normal VR resolution.

| Detail | VR resolution | Starting draw distance |
|---|---|---|
| Low (Quest default) | 0.7 | 0.6 |
| Medium | 0.75 | 0.8 |
| High | 0.9 | 1.0 |

The draw distance for plants and rocks then adjusts itself every second to hold the headset's frame rate.
Bloom (the soft glow) is off in VR to save time.

You can override these by adding options to the link, with no rebuild:

| Option | Example | What it does |
|---|---|---|
| `xrscale` | `?xrscale=0.6` | VR resolution per eye (1 = the headset's normal resolution; lower is faster but blurrier) |
| `xrdet` | `?xrdet=0.8` | Starting draw distance, 0.4 to 1 |
| `xrbloom` | `?xrbloom=1` | Turns the bloom glow back on in VR |
| `xrgl` | `?xrgl=1` | Uses the WebGL copy path even where the direct WebGPU path exists (for comparing the two) |

Options combine with `&`, for example `https://abyssal-garden-vr.vercel.app/?xrscale=0.6&xrdet=0.5`.

To see performance numbers, connect the headset to a computer and open `chrome://inspect`: the page prints a line with
the frame rate, GPU time, draw distance and per-eye resolution every two seconds.

### Status

Tested on a Meta Quest 3 in November 2026: Low detail at 0.7 resolution runs well; Medium is a little glitchy and High
glitches badly. Still worth checking on the headset: how hand tracking and the comfort settings feel, and that the sound
keeps playing in VR (it is ambient stereo; it does not follow your head).

## Maps

The start menu's **Map** row switches between worlds that other people built on this engine. Each one is its own page
with the same VR mode, comfort options and VR controls panel. Its menu has an **All maps** link back.

| Map | What it is | By | Page |
|---|---|---|---|
| **Garden** | The original kelp forest, ship and whale tail | [Noniv](https://github.com/Noniv/abyssal-garden) | [/](https://abyssal-garden-vr.vercel.app/) |
| **Shallows** | The garden with a swimmable surface and coastline, jellyfish and reef fish | [nox-do](https://github.com/nox-do/abyssal-garden) | [/maps/shallows/](https://abyssal-garden-vr.vercel.app/maps/shallows/) |
| **Mine** | A Descent-style reactor mine carved out of rock, flown in a Pyro-GX | [hoyajavis](https://github.com/hoyajavis/abyssal-mine) | [/maps/mine/](https://abyssal-garden-vr.vercel.app/maps/mine/) |

All are MIT-licensed forks of Abyssal Garden; each map folder keeps its source (`maps/<name>/source`, built with
`npm run build` there) and its license. In VR the Mine is flown like the garden is swum (no roll on the sticks; your
head does that). Planned next: the 15 Eunomia asteroid and Abyssal Infinite, which need VR wired into their own walking,
gravity and multiplayer controls.

## Try it on a computer or phone

1. Download [`index.html`](index.html) or open https://abyssal-garden-vr.vercel.app.
2. Open it in **Chrome** or **Edge** on a desktop computer.
3. Wait a few seconds while the world is built, then press **Dive in** and start swimming.

Nothing to install, and the downloaded file works offline. It needs a browser with **WebGPU**. If you see *"This scene needs WebGPU"*, update your browser or switch to Chrome / Edge.

## What's down there

- **Kelp forests** that sway in the current and sparkle with tiny gold and green specks
- **Light rays** streaming down from a wavy surface, with shimmering caustics on the sea floor
- **A sunken wooden ship**, a **giant stone whale tail**, rock arches, canyons and floating boulders
- **Manta rays**, schools of fish, rising bubbles and drifting particles
- **A purple grotto** with glowing magenta ground cover, coral and barrel sponges
- **A soundscape** made up as you listen: a deep rumble, distant whale calls, soft chimes and bubbles

| | |
|---|---|
| ![Shipwreck](.github/screenshots/shipwreck.jpg) | ![Looking up through the kelp](.github/screenshots/kelp-forest.jpg) |
| ![Barrel sponges](.github/screenshots/sponge-garden.jpg) | ![Light rays over the kelp basin](.github/screenshots/light-rays.jpg) |

![The purple grotto](.github/screenshots/purple-grotto.jpg)

## Controls (computer and phone)

| | Keyboard & mouse |
|---|---|
| Look around | Move the mouse |
| Swim | `W` `A` `S` `D` |
| Up / down | `E` / `Q` |
| Swim faster | Hold `Shift` |
| Jump to a viewpoint | `1` to `6` (the spots in the screenshots) |
| Menu | `Esc` releases the mouse and opens the menu with the list of controls; **Resume** takes you back |
| Sound on / off | `M` (sound starts when you dive in) |
| Performance stats | `H` |
| Detail level | **Low**, **Medium** or **High** in the menu (reloads the page) |

**To change a key, click it in the menu's list of controls, then press the new key.** If that key already does
something else, the two swap. `Esc` and `1` to `6` stay fixed. **Reset keys** puts the defaults back, and your keys are
saved in the browser between visits. The menu always shows the keys you are using.

The seabed, cliffs and arches are solid: you glide along the rock instead of swimming into it, and you still fit through every tunnel and arch. Kelp, plants, corals, sponges, loose rocks, the floating boulders, the ship and the whale tail you can swim through.

**On a touchscreen:** hold one finger down to swim forward and slide it to steer. Put a second finger down to go faster. The `≡` button in the corner opens the menu. Phones always show the scene in landscape and start on Low or Medium detail. (Touch support is experimental.)

## Detail levels

The **Low**, **Medium** and **High** buttons in the menu pick the detail level; the current one is lit. Each level is the same world, built with less in it:

| Level | What it is | Picked on a first visit for |
|---|---|---|
| **High** | The full scene | Computers |
| **Medium** | Half of the leaves, sparkles and pebbles; small rocks, sponges and corals cast no shadows | Phones with 8 GB of memory |
| **Low** | A quarter of the leaves, no anti-aliasing, coarser rocks and corals, simpler lighting, 480p to start with | Other phones, computers with 4 GB of memory or less, and Meta Quest headsets |

If loading crashes the tab, or the graphics driver gives up, the page starts again one level lower. Your browser remembers the level, and the resolution and draw distance the scene settled on, for the next visit.

## How it works

- The seabed is sculpted on your graphics card every time the page opens, then decorated with about two million kelp leaves and plants, tens of thousands of rocks, and thousands of sponges, corals and fish.
- Everything is drawn with **WebGPU** directly. No game engine or 3D library is used.
- The ship, whale tail, mantas, fish and corals are built from simple mathematical shapes.
- The sound is synthesized live with the Web Audio API.
- It's built to run smoothly: about 180 fps at 2560×1440 on an RTX 5070 Ti. On slower hardware it aims for 60 fps by lowering first the resolution and then how far away plants and rocks are drawn, in small steps. The scene is already running, blurred, behind the start menu, so most of that tuning is done before you dive in. A low-end phone (Samsung Galaxy A16) reaches about 20 fps at 670×372 on Low.

## Make it your own

The readable source code is in the [`source`](source) folder. To change something and rebuild `index.html` you need [Node.js](https://nodejs.org) 18 or newer:

```bash
cd source
npm install
npm run build
```

This writes a new `index.html` next to this README. `npm run build:readable` writes an unminified version instead, which is easier to debug in the browser's developer tools.

`npm run build:dev` writes a separate `dev.html` with two extra tools that are not part of `index.html`: `F` flies the camera along a one-minute path through the whole world, and `B` runs that flight as a benchmark and reports frame and GPU times.

| File | What's inside |
|---|---|
| [`source/src/world.js`](source/src/world.js) | The world layout: rock walls, arches, tunnels, kelp forests, sponge gardens, fish schools, mantas, the ship and the whale tail. **A good place to start.** |
| [`source/src/shaders.js`](source/src/shaders.js) | The look: water and fog colors, lighting, kelp, rocks, the water surface and light rays (WGSL shader code) |
| [`source/src/main.js`](source/src/main.js) | The renderer, the camera, the controls, the six viewpoints and the camera path the world is laid out around |
| [`source/src/audio.js`](source/src/audio.js) | The soundscape |
| [`source/src/quality.js`](source/src/quality.js) | The detail levels: which one a device starts on, and what is remembered between visits |
| [`source/src/math.js`](source/src/math.js) | Noise, random numbers and mesh-building helpers |
| [`source/src/xr.js`](source/src/xr.js) | Virtual reality: Enter VR, drawing both eyes, swimming with controllers or hands, comfort options, VR resolution defaults |
| [`source/src/dev.js`](source/src/dev.js) | Development tools (fly-through and benchmark), only in `dev.html` |
| [`source/template.html`](source/template.html) | The page around the scene: loading bar, start menu, links and their styles |

Some easy first tweaks:

- **Water color:** `WCOL` (blue-green water) and `PCOL` (purple grotto) near the top of the shared scene code in `shaders.js`
- **Sunlight color:** `SUNC` right next to them
- **Brightness and light rays:** `EXPO` and `RAYS` in `main.js`
- **Swimming speed:** search for `26 : 7` in `main.js` (fast speed : normal speed); in VR, `fast ? 9 : 3` in `xr.js`
- **VR resolution per detail level:** `XSCALE` near the top of `xr.js` (High, Medium, Low)

## License

[MIT](LICENSE): free to use, change and share, including in your own projects. The original Abyssal Garden is by
[Noniv](https://github.com/Noniv/abyssal-garden); the VR mode was added in this fork. The maps keep their authors' credits and licenses (see [Maps](#maps)).
