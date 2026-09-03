# Recent Tabs Switcher for Chrome

A local-first, Command-Tab-style switcher for Chrome tabs in most-recently-used (MRU) order.

## Features

- MRU ordering across service-worker restarts
- Opens with the previous MRU tab already highlighted
- Hold `Alt`, tap `Q` repeatedly to cycle, and release `Alt` to switch
- `Alt+Shift+Q` cycles backward
- `W` closes the highlighted tab and `Escape` cancels
- A centered five-card switcher with real page previews
- Five session-only 320×180 preview images, captured only when invoked
- Optional cycling across all Chrome windows
- No host permissions, network requests, analytics, or third-party dependencies
- Event-driven background worker with no polling or permanent content scripts
- In-memory MRU updates with collapsed session writes and stable DOM rendering

Chrome reserves Control-Tab, so a Web Store extension cannot replace that literal shortcut. On Ubuntu and Windows, this extension uses `Alt+Q` and `Alt+Shift+Q` to preserve the same press-and-hold interaction. Users can customize the commands at `chrome://extensions/shortcuts`.

The shortcut temporarily injects an isolated overlay and one-shot key listener into the active page. The service worker owns the tab snapshot and selection; releasing `Alt` tells it to activate the selected tab, then the overlay removes itself. There are no permanent content scripts, host permissions, or polling. Chrome-owned pages that prohibit script injection use the toolbar popup fallback.

Page previews populate progressively: each new switcher gesture captures only the currently visible outgoing tab, compresses it to a 320×180 JPEG, and retains at most five images in session storage. The cache disappears when Chrome exits. Tabs without a cached image use their favicon and title, and discarded tabs are never awakened to generate previews.

## Run locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Open several tabs, then click the toolbar icon or use the configured shortcut.

Run the local checks:

```sh
npm test
npm run check
```

Create the upload ZIP:

```sh
npm run package
```

## Chrome Web Store submission

1. Create a Chrome Web Store developer account and pay Google's one-time registration fee.
2. Replace the contact placeholder in `PRIVACY.md`, publish that policy at a stable public URL, and add it in the Developer Dashboard.
3. Run `npm test`, `npm run check`, and manually test the unpacked extension on Windows, macOS, and ChromeOS where available.
4. Run `npm run package` and upload `dist/recent-tabs-switcher.zip`.
5. Use this single-purpose statement: **Helps users find and switch among their open Chrome tabs in most-recently-used order.**
6. Justify `tabs` and `storage` using the explanations in `PRIVACY.md`.
7. Declare that browsing activity is handled locally for the user-facing tab-switching feature and is not collected or transmitted.
8. Supply a 128×128 store icon, at least one 1280×800 or 640×400 screenshot, a detailed description, category, support URL, and a monitored contact email.

## Project layout

```text
manifest.json       Manifest V3 definition and shortcuts
src/background.js   MRU tracking, capture lifecycle, and cycle commands
src/preview.js      Bounded cache and worker image downscaling
src/popup.*         Press-and-hold switcher overlay
src/options.*       Settings and privacy disclosure
src/core.js         Testable ordering and formatting logic
test/               Node unit tests
```
