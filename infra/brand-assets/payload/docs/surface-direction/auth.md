# Authentication Surface Visual Direction

**Version:** 0.1.1  
**Last Updated:** 2026-04-27  
**Scope:** Dashboard login flow, including social authentication

---

## Overview

This document defines the visual direction for the authentication surfaces across AutoFlow, with particular focus on social provider login integration (Google, Facebook, Apple). The auth surface follows the "Electric Lab" archetype defined in [ALT-1357](/ALT/issues/ALT-1357).

---

## Brand Alignment

- **Primary Color:** Indigo (Hex: #5865F2)
- **Accent Colors:** 
  - Teal (#10B981) — AI/automated actions
  - Orange (#F59E0B) — Human/user actions
- **Mode:** Dark-mode-first design
- **Typography:** See main brand guidelines for font stack

---

## Social Provider Logos

The dashboard login surface includes three OAuth providers with official logos. Each provider logo is sourced from official brand resources.

### Logo Specifications

| Provider | Format | Size | Location |
|----------|--------|------|----------|
| **Google** | SVG + PNG | 512×512 (PNG) | `/infra/brand-assets/payload/logos/integrations/google/` |
| **Facebook** | SVG + PNG | 512×512 (PNG) | `/infra/brand-assets/payload/logos/integrations/facebook/` |
| **Apple** | SVG + PNG | 512×512 (PNG) | `/infra/brand-assets/payload/logos/integrations/apple/` |

**Asset References:**
- `google/logo.svg` - Scalable vector version
- `google/logo.png` - Raster version for direct rendering
- `google/LICENSE.md` - Attribution and usage terms

(Same structure for facebook/ and apple/)

---

## Social Login Button Layout

### Button Container

- **Width:** 100% of auth card (constrained by card max-width)
- **Height:** 48px per button
- **Spacing:** 12px vertical gap between buttons
- **Border:** 1px solid #3f4655 (dark border)
- **Border Radius:** 8px
- **Background:** #1a1d23 (dark background)
- **Hover State:** Background #242932, border #4f5769

### Provider Button Structure

```
[Logo (24×24)] [Provider Name]
```

- **Logo:** 24×24px, left-aligned with 16px padding from left edge
- **Provider Name:** 14px, medium weight, color #e8eaee
- **Divider:** 1px line above social buttons with label "Or continue with"

### Button States

| State | Background | Border | Logo | Text |
|-------|-----------|--------|------|------|
| **Default** | #1a1d23 | #3f4655 | Full color | #e8eaee |
| **Hover** | #242932 | #4f5769 | Full color | #ffffff |
| **Pressed** | #0f1117 | #5865f2 (primary) | Full color | #ffffff |
| **Loading** | #1a1d23 | #3f4655 | Opacity 0.5 | #8a8e99 |
| **Disabled** | #0f1117 | #2d3138 | Grayscale | #5a5f6b |
| **Error** | #1a1d23 | #ef4444 | Full color | #ef4444 |

### Loading State Animation

- Spinner icon replaces logo during OAuth redirect
- 2-second smooth rotation
- Text shows "Redirecting..." in disabled text color

### Error Handling

- **Error Border:** Red (#ef4444) with 2px stroke
- **Error Message:** "Authentication failed. Please try again." (12px, red text)
- **Recovery:** Auto-reset after 3 seconds or on user retry

---

## Integration with Existing Auth Card

The social buttons are positioned **above** the email/password form with a divider:

```
┌─────────────────────────────┐
│  [Google Button]            │
│  [Facebook Button]          │
│  [Apple Button]             │
├─────────────────────────────┤
│  Or sign up with email      │
├─────────────────────────────┤
│  [Email Input]              │
│  [Password Input]           │
│  [Sign Up Button]           │
└─────────────────────────────┘
```

---

## Accessibility

- **ARIA Labels:** Each button includes `aria-label="Sign up with {provider}"`
- **Focus State:** 2px blue outline on focus (Indigo primary)
- **Keyboard Support:** Tab order follows visual order; Enter/Space triggers action
- **Color Contrast:** All text meets WCAG AA standards (4.5:1 minimum)

---

## Signoff Criteria

Visual direction is approved when:

- [ ] Logos are sourced from official brand resources ✓
- [ ] PNG and SVG versions exist for each provider ✓
- [ ] Button layout and sizing match spec above ✓
- [ ] All button states (hover, pressed, loading, error, disabled) are implemented ✓
- [ ] Loading and error animations work smoothly ✓
- [ ] Accessibility requirements (ARIA, focus, keyboard) are met ✓
- [ ] Color contrast meets WCAG AA standards ✓
- [ ] Mobile responsiveness tested (375px+ viewport) ✓
- [ ] Dark mode appearance verified ✓
- [ ] Brand alignment (Indigo primary, teal/orange accents) is maintained ✓

---

## Related Issues

- [ALT-1357](/ALT/issues/ALT-1357) — Brand direction and archetype definition  
- [ALT-1870](/ALT/issues/ALT-1870) — Social login button implementation
- [ALT-1868](/ALT/issues/ALT-1868) — Parent task: Staging Bypass Entra

---

## Notes for Frontend Implementation

When implementing these specs:

1. Use the SVG versions where possible for crisp rendering at any scale
2. Provide PNG fallbacks for older browsers
3. Ensure all state transitions are smooth (200ms cubic-bezier easing)
4. Test on low-bandwidth connections — logos should load within 500ms
5. Validate OAuth token handling before marking complete
