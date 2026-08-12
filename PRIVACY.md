# Privacy Policy — CB Deal Finder

_Last updated: 13 August 2026_

> Public URL for the Chrome Web Store listing:
> <https://github.com/lucasfirl/benefits-chrome/blob/main/PRIVACY.md>

CB Deal Finder is a private, unofficial browser extension. It is not
affiliated with, operated by, or endorsed by corporate benefits Germany GmbH
or any employee-benefits provider.

## Short version

The extension collects nothing, transmits nothing to the developer, and
contacts no server other than the employee-benefits portal **you** configure
and approve. There is no analytics, no tracking, no advertising, and no
remote code.

## What the extension stores

All of this is stored **locally in your browser only** (`chrome.storage`) and
never leaves your device:

| Data | Why | Where |
|---|---|---|
| The portal address you enter | To know which portal to query | `chrome.storage.sync` |
| Your notification, scanning and brand-source preferences | To respect your chosen settings | `chrome.storage.sync` |
| Sites you switched off, and patterns you added | So a site you silenced stays silent | `chrome.storage.sync` / `chrome.storage.session` |
| A cached copy of the offer catalogue (brand names, offer titles, discount labels, links) | So sites can be matched locally instead of querying the portal on every page view | `chrome.storage.local` |

The catalogue cache expires after seven days and can be cleared at any time
by removing the extension. Sites you only paused rather than silenced for good
live in session storage and are forgotten when the browser closes.

## What the extension reads

- **The address of the tab you are viewing**, to derive a brand name from the
  domain (e.g. `philips.de` → "philips").
- **The page title and the `og:site_name` meta tag** of that page, to derive a
  more accurate brand name. Nothing else from the page is read — no page
  content, no form fields, no input, no cookies.

Without the optional "Automatic scanning" setting, this only happens for the
tab you are looking at, at the moment you click the extension icon. If you
enable automatic scanning, it also happens on pages as they load; the data
read is exactly the same (title and `og:site_name` only).

## What the extension sends, and where

Requests are made **only** to the benefits portal origin you entered and
explicitly approved in the extension's settings. Nothing is sent anywhere
else — not to the developer, not to any third party.

Those requests reuse the login session you already have with that portal in
your browser. The extension never sees, requests, or stores your username,
password, or session cookies; the browser attaches your session at the network
layer, exactly as it does when you open the portal in a tab. The extension
does not hold the `cookies` permission and therefore cannot read them.

## Credentials

The extension never asks for a password and has no login functionality. If you
are not logged in to your portal, it simply tells you so.

## Third parties

None. No analytics services, no error reporting, no advertising networks, no
external code or fonts — the typefaces are bundled with the extension rather
than requested from a font host. The extension functions entirely offline apart
from the requests to your own portal described above.

## Data retention and deletion

Everything is local. Removing the extension from Chrome deletes all stored
data, including the cached catalogue. No copy exists anywhere else, because
none is ever transmitted.

## Permissions

See the extension's Chrome Web Store listing for a per-permission
justification. Notably, the broad host permission (all sites) is **optional**
and is requested only if you explicitly turn on "Automatic scanning"; it is
not granted at install time.

## Contact

Questions about this policy: lucas.p.firl@gmail.com
