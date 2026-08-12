# CB Deal Finder

A Chrome extension that scans whatever site you're browsing for matching
deals on your Corporate Benefits employee portal (`*.mitarbeiterangebote.de`
and similar CB-powered portals), using the login session you already have in
your browser. UI is in English or German, auto-selected from your browser's
language.

## How it works

- You tell the extension your employer's portal address once (every employer
  has their own slug, e.g. `yourcompany.mitarbeiterangebote.de`).
- The extension reuses your existing logged-in session on that portal — it
  never asks for or stores a password.
- **The catalogue is downloaded once a week** and matching happens locally,
  offline. See below — this is what keeps portal load low.
- Brand matching uses two signals: the site's domain (e.g. `philips.de` →
  `philips`), and — if you've turned on automatic scanning, or when you open
  the popup — the page's `<title>` and `og:site_name` meta tag.
- If there are matches, the toolbar badge shows a count; click the icon to
  see the deals and jump straight to them on your portal.
- You can also manually search any brand from the popup, regardless of what
  site you're on.

### The offer catalogue (why it works this way)

The obvious design — query the portal's search on every page you visit — does
not scale. Measured on the real code, that was ~2.4 requests per page view
(misses cost the most, because the candidate loop only stops on a *hit*), and
tab switches triggered full rescans with no caching at all. For a single user
that's invisible; across a whole company it would be hundreds of thousands of
requests a day and would read, in the portal's logs, as distributed scraping.

So instead the extension fetches the catalogue **once a week**:

1. Loads the portal home page and reads the top-level category ids from the
   navigation (discovered, not hardcoded — every employer's portal differs).
2. Fetches each `/overview/<id>` page, spaced 1.5 s apart rather than as a
   burst. Each one returns its full offer list in a single response — the
   portal does not paginate these.
3. Stores brand names + offer links in `chrome.storage.local`.

After that, matching a site is a **local string comparison — zero requests**.

| | requests/user/day | at 1,000 users |
|---|---|---|
| per-page search (before) | ~600 | 600,000 |
| weekly catalogue (now) | **~2** | **2,000** |

The important property is that the cost no longer scales with browsing: a
heavy surfer costs the same as someone who barely opens the browser.

Matching normalises both sides (lowercase, umlauts, punctuation removed), so
`easyairportparking.de` matches "Easy Airport Parking" without needing the
page title at all. It is deliberately conservative — a short brand like "On"
matches only exactly, never by prefix, so `onlineshop.de` won't claim a
discount that doesn't exist. If the catalogue is missing or older than a week,
the extension falls back to live search so it never appears broken.

### Automatic scanning (opt-in)

By default, the badge only updates when you switch to/reload a tab, using
the domain guess alone — accurate for most brands, but it can miss ones like
the "easyairportparking.de" example above until you open the popup.

Turning on **Automatic scanning** in Settings additionally registers a tiny
content script on every page (reads only `document.title` and the
`og:site_name` meta tag, nothing else) so the badge is accurate immediately,
without needing to open the popup. This requires granting the extension a
broader "read every site" permission, which is why it's off by default.

### Notifications ("how disruptive")

Also in Settings, once automatic scanning is on, you can choose how loudly a
match is announced:
- **Badge only** — no interruption, just the toolbar count.
- **Desktop notification** — a dismissible OS notification when a page has
  matches (once per page, not on every scan).
- **Try to open the popup automatically** (default) — attempts
  `chrome.action.openPopup()`; Chrome frequently blocks this outside of a direct
  click, so it silently falls back to a desktop notification when that happens.

## Install (unpacked, for now)

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this folder (`benefits-chrome`).
4. Click the extension icon → the gear icon (or right-click the icon →
   Options) and enter your portal address, e.g.
   `yourcompany.mitarbeiterangebote.de`.
5. Approve the permission prompt — this grants the extension access to that
   one portal domain only.
6. Make sure you're logged in to your CB portal in a regular tab.
7. (Optional) In the same Settings page, enable "Automatic scanning" and
   pick a notification style.
8. Browse to any brand's site — the badge (or popup) shows matching deals.

Whenever you pull code changes for this extension, click the reload icon on
its card in `chrome://extensions` — background script and manifest changes
don't apply until you do.

## Limitations / notes

- Without automatic scanning enabled, the toolbar badge is domain-heuristic
  only and can under-count until you open the popup (which always does the
  more accurate title-based check).
- Automatic scanning needs the broad all-sites permission, since Chrome only
  lets extensions read page content without a user gesture if they hold that
  permission. It's opt-in specifically because of that broader access.
- The "auto-open popup" notification level is best-effort; Chrome's
  `chrome.action.openPopup()` API is restricted outside direct user
  gestures and may just fall back to a notification instead.
- Single-page-app navigations that don't trigger a full page load or a
  `chrome.tabs.onUpdated` "complete" event won't auto-rescan until you switch
  tabs or reload; use the manual search in the popup as a fallback.
- If your portal ever changes its HTML structure, the parser in
  `offscreen.js` (`.cbg3-list-item` selectors) may need updating. Note it
  already handles two different nestings the portal uses for the same item
  (`h3 > a` on search results, `a > h3` on category pages) — matching on
  `h3 a` silently returns nothing on category pages.
- Brand names in the catalogue are stable, but discount amounts and monthly
  specials are not. With a one-week lifetime a percentage can be out of date,
  so the popup always shows how old the data is and offers a Refresh button;
  the authoritative figure is on the portal page the link leads to anyway.
- Location-dependent offers ("Regionales") are in the catalogue by brand, but
  the local matcher cannot filter them by your location. Use the popup's
  search box for those.
- Only one portal origin is supported at a time; re-running the settings
  page overwrites the previous one.

## Disclaimer

This is a private, unofficial tool. It is **not affiliated with, operated by,
endorsed by, or reviewed by corporate benefits Germany GmbH**. All brand
names, product names and logos referenced or displayed belong to their
respective owners.

The offer catalogue is deliberately downloaded only once a week — staggered
rather than in one burst — and all matching afterwards happens locally in your
browser. This is done explicitly to keep load on corporate benefits' servers as
low as possible: instead of a search request on every page you visit, only a
handful of requests are made per week.

Discount figures shown come from the locally cached catalogue and may be out
of date — only the offer page on the portal itself is authoritative. Provided
as-is, without warranty of any kind and without liability.

The offers and discount codes retrieved are subject to your portal's terms of
use and are confidential: they are intended for eligible employees only and
must not be shared with third parties or published. This tool does not change
that — it only shows you, locally, what your own account can already see.

## Files

- `manifest.json` — MV3 manifest.
- `background.js` — service worker: watches tabs, fetches/parses portal
  search results, manages the badge/notifications, and answers popup and
  content-script requests.
- `content-hints.js` — opt-in content script (registered dynamically once
  automatic scanning is enabled) that reports page title / og:site_name.
- `offscreen.js` / `offscreen.html` — offscreen document used to parse the
  portal's HTML with a real DOMParser (service workers have no DOM).
- `popup.html` / `popup.js` / `popup.css` — toolbar popup UI.
- `options.html` / `options.js` / `options.css` — settings page (portal URL,
  automatic scanning toggle, notification style).
- `common.js` — shared helpers (URL normalization, brand guessing, i18n).
- `test/` — run everything with **`node test/run-all.js`**.
  - `scan-order.test.js` — loads the real `background.js` in a sandbox with
    stubbed Chrome APIs and replays browser event orderings, asserting the
    hint-based result wins over a late hintless one.
  - `catalog.test.js` — asserts that with a fresh catalogue the scan makes
    **zero** portal requests, and that a stale catalogue falls back to live
    search.
  - `matching.test.js` — the local name matcher, including the false-positive
    cases it must reject.
- `_locales/en`, `_locales/de` — UI text; Chrome auto-selects based on your
  browser's language, falling back to English.
