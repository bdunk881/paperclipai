# Dashboard Visual Direction — v0.1.0

## Core Aesthetic: "The Command Center"
The dashboard is the primary workspace for AutoFlow users. It must balance technical precision with high-performance execution cues.

## Visual Rules
- **Base Surface:** Always `Obsidian Dark` (#0f172a).
- **Secondary Surfaces:** Slate-900 with subtle borders (Slate-800).
- **Accent Logic:**
  - `Electric Teal` (#14b8a6) for active AI runs, successful connections, and "execution" paths.
  - `AutoFlow Indigo` (#6366f1) for navigation, primary CTAs, and stable configuration states.
  - `Cyber Orange` (#f97316) for triggers, manual inputs, and warnings.
- **Textures:** Subtle noise overlay (see `textures/noise-overlay.svg`) on primary panels to reduce flat-color fatigue.

## UI Patterns
- **Canvas Nodes:** 
  - `radius-lg` (12px).
  - Subtle glassmorphism (back-drop blur 4px) for overlay panels.
  - Borders: 1px solid Slate-800.
- **Typography:**
  - Headings: `Inter` Semi-Bold (tight tracking).
  - Body: `Inter` Regular.
  - Data/Stats: `JetBrains Mono`.
- **Motion:**
  - Transition duration: 200ms.
  - Easing: `ease-in-out`.
  - Pulse effects for nodes currently "thinking".
