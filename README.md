# Room Unsealed: Glassback

A browser-first augmented-reality room-defense game built for mobile Safari. Players mark three breach directions in their physical room, then defend that position from a procedurally animated alien parasite brood for two minutes.

> **Status:** Playable prototype. The hosted demo currently requires owner access while development continues.

## Why this project exists

Room Unsealed explores how far an immersive AR-style game can go without asking players to install a native application. The current version works within iPhone browser constraints: device orientation supplies rotational tracking, while player-defined breach bearings create a stable 360-degree combat space around a fixed position.

The project deliberately does not claim full room mapping or positional tracking. Safari does not currently expose ARKit-style six-degree-of-freedom world tracking through WebXR, so the experience is designed around turning in place rather than walking through the room.

## Features

- Rear-camera experience with a privacy-first permission flow
- Three player-defined breach directions
- Gyroscope-based 360-degree aiming with drag and keyboard fallbacks
- Two-to-three simultaneous enemies with crawler and skitter variants
- Original procedural Glassback parasite assembled and animated in Three.js
- Center-reticle hit detection, ammunition, reloading, damage, scoring, and win/loss states
- Two-minute survival round that remains fully playable while muted
- Responsive interface with iPhone safe-area support
- Simulated-room mode for desktop development and testing
- Generated Web Audio cues with no external audio dependencies

## Engineering decisions

### Directional anchors instead of fake world tracking

Each breach stores a bearing relative to the player's starting orientation. This produces believable 360-degree placement while being honest about the browser's inability to track physical translation on iOS.

### Procedural creature instead of a human-scale model

The original zombie character exposed scale, grounding, animation, and asset-loading problems at long distances. The Glassback is generated from Three.js primitives and animated in code. Its unfamiliar anatomy makes scale more flexible, improves the distant silhouette, and removes a large FBX and texture payload.

### Visual-first accessibility

Threat direction, impacts, reloading, health, and round status all have visible feedback so sound is never required to play.

## Technology

- TypeScript
- Three.js
- Vite
- Device Orientation API
- MediaDevices camera API
- Web Audio API
- Progressive Web App manifest

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL. Camera access works on `localhost`. To test the complete loop without camera permission, choose **Preview without camera**.

## Production build

```bash
npm run build
```

The optimized static output is written to `dist/`.

## Controls

| Action | Mobile | Desktop fallback |
| --- | --- | --- |
| Look around | Turn the phone | Drag or use arrow keys |
| Mark breach | Tap **Lock this breach** | Press Enter |
| Fire | Tap **Discharge** | Press Space |

## Current limitations

- The player must remain approximately in one position during a round.
- Breaches are directional bearings, not persistent 3D world anchors.
- Real furniture occlusion and surface collision require native ARKit or future iOS WebXR support.
- The hosted preview is private during active development.

## Roadmap

- Add distinct parasite behaviors and attack telegraphs
- Improve lighting adaptation against bright and dark camera backgrounds
- Add device-performance profiling and adaptive quality settings
- Explore visual-marker anchoring as a web-compatible positional-tracking experiment
- Evaluate an ARKit App Clip for full world anchors and plane interaction

## Author

Designed and engineered by Jay Kleezie.

