# Skill Marketplace Tile Spec — v0.1.0

## Core Design
The Marketplace Tile is the primary unit of discovery for AutoFlow skills. It must clearly communicate the vendor, the skill capability, and its status.

## Dimensions & Grid
- **Container:** 400px x 300px.
- **Corner Radius:** `radius-lg` (12px).
- **Padding:** 24px (all sides).

## Components
1. **Header:** 
   - Integration Logo (Left-aligned, 48px box).
   - Skill Name (Right of logo, Bold Inter).
2. **Body:**
   - Brief Description (Max 80 characters).
3. **Footer:**
   - "MCP Verified" badge (bottom-right).
   - Connection status (indicator dot bottom-left).

## Styling
- **Background:** Subtle glassmorphism (Slate-900 at 80% opacity with backdrop-blur).
- **Border:** 1px solid Slate-800.
- **Hover State:** Border glow using `AutoFlow Indigo` (#6366f1).
