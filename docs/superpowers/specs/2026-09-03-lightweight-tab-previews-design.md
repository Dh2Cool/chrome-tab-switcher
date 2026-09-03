# Lightweight Tab Previews Design

## Goal

Add Arc-style visual previews to the existing press-and-hold MRU switcher while keeping the extension fast, private, and inexpensive when idle.

## Product behavior

- Show the five most recently used tabs from the active Chrome window by default.
- Capture the currently visible page once when a new switcher gesture begins.
- Reuse that image the next time the tab appears in the switcher.
- Show the tab favicon and title when no captured image is available.
- Never wake a discarded tab or navigate through tabs to manufacture previews.
- Keep the panel centered at exactly 50% of the page viewport.
- Repeated shortcut presses update only the selected card and title.
- Releasing Alt closes immediately and activates the selected tab without a closing animation.

## Capture and cache architecture

The command handler calls `chrome.tabs.captureVisibleTab()` before injecting the overlay, ensuring the overlay cannot appear inside its own screenshot. Capture happens once per switcher session, not once per key repeat. The API's JPEG output is decoded and cropped in the extension service worker with `createImageBitmap()` and `OffscreenCanvas`, then encoded as a 320 by 180 JPEG at 50% quality.

The worker stores a map of tab IDs to data URLs in `chrome.storage.session`. Cache pruning follows the current MRU order and retains at most five images. Closing or replacing a tab removes its cached preview. Session storage deliberately discards previews when Chrome exits; previews are ephemeral browsing data and do not need durable storage.

If capture or image processing is unavailable, switching continues normally with favicon fallbacks. No capture failure may block opening or completing the switcher.

## Rendering architecture

The overlay creates its panel, title, hint, and five card elements once. A render message updates card content only when the tab assigned to a slot changes. Ordinary cycling changes selection classes and the selected title without replacing DOM nodes or reloading image sources.

Cards contain a 16:9 preview, a compact favicon badge, and an ellipsized title. Selection uses a short transform/color transition only. The panel has no entrance or exit transition, and `prefers-reduced-motion` disables card transitions.

The injected root remains `position: fixed; inset: 0`, while the panel uses `top: 50%; left: 50%; transform: translate(-50%, -50%)`, so placement is relative to the visible content viewport and remains stable across page layouts.

## Permissions and performance constraints

- Keep the existing `activeTab`, `scripting`, `storage`, and `tabs` permissions.
- Add no host permissions, persistent content scripts, timers, polling, analytics, or dependencies.
- Capture at most once per switcher session.
- Store at most five 320 by 180 compressed previews.
- Limit the rendered switcher set to five tabs.
- Treat preview capture and processing as optional enhancement paths.

## Verification

Unit tests cover five-tab limiting and cache pruning/removal. Static overlay tests protect exact centering, five stable slots, and the absence of `replaceChildren()` in the injected renderer. Existing MRU tests, structural checks, and ZIP packaging must continue to pass.
