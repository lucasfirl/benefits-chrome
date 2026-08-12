const contentEl = document.getElementById("content");
const hostEl = document.getElementById("siteHost");
const manualForm = document.getElementById("manualSearchForm");
const manualInput = document.getElementById("manualSearchInput");
const manualClearBtn = document.getElementById("manualSearchClear");
const manualResultsEl = document.getElementById("manualResults");

const t = (key, subs) => chrome.i18n.getMessage(key, subs);

applyI18n();

document.getElementById("settingsBtn").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  (children || []).forEach((c) => node.appendChild(c));
  return node;
}

/** Link zum Portal, damit man sich von hier aus direkt anmelden kann. */
function portalLink(portalOrigin) {
  return el("a", {
    className: "portal-link",
    href: portalOrigin,
    target: "_blank",
    rel: "noreferrer",
    textContent: t("catalogLoginLink"),
  });
}

/** Setzt genau eine `state-*`-Klasse auf <body>, fuer die Randregeln in CSS. */
function setBodyState(status) {
  document.body.className = document.body.className
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("state-"))
    .join(" ");
  document.body.classList.add("state-" + (status || "unknown"));
}

// --- Bausteine ------------------------------------------------------------

function renderDealCard(deal) {
  const card = el("a", { className: "deal", href: deal.url, target: "_blank", rel: "noreferrer" });
  // Die 34px-Spalte bleibt auch ohne Logo stehen, sonst rutschen Zeilen mit und
  // ohne Logo gegeneinander.
  card.appendChild(deal.logo ? el("img", { src: deal.logo, alt: "" }) : el("span", {}));

  const text = el("div", { className: "text" }, [el("p", { className: "title", textContent: deal.title })]);
  if (deal.description) text.appendChild(el("p", { className: "desc", textContent: deal.description }));
  card.appendChild(text);

  card.appendChild(el("span", { className: "discount", textContent: deal.discount || "–" }));
  return card;
}

/**
 * Rendert eine Angebotsliste. `asOf` ist der Katalogstand; er steht als eine
 * Zeile unter der ganzen Liste statt an jedem Angebot einzeln.
 */
function renderDealList(container, deals, asOf) {
  container.innerHTML = "";
  if (!deals || deals.length === 0) {
    container.appendChild(el("p", { className: "placeholder", textContent: t("popupNoDeals") }));
    return;
  }
  const list = el("div", { className: "deal-list" });
  deals.forEach((deal) => list.appendChild(renderDealCard(deal)));
  if (asOf) {
    const stamp = formatAsOfDate(asOf, chrome.i18n.getUILanguage());
    list.appendChild(el("p", { className: "as-of", textContent: t("popupFiguresAsOf", [stamp]) }));
  }
  container.appendChild(list);
}

/**
 * Der grosse Block fuer alles, was kein Treffer ist: optionaler Marker
 * (Chip oder "Schritt 1 von 1"), Ueberschrift, Text, Portaladresse, Buttons.
 */
function renderNotice({ chip, chipKind, step, heading, body, origin, actions }) {
  const box = el("div", { className: "notice" });
  if (chip) box.appendChild(el("span", { className: "chip" + (chipKind ? " " + chipKind : ""), textContent: chip }));
  if (step) box.appendChild(el("div", { className: "eyebrow", textContent: step }));
  box.appendChild(el("h2", { textContent: heading }));
  if (body) box.appendChild(el("p", { textContent: body }));
  if (origin) box.appendChild(el("div", { className: "origin", textContent: origin }));
  if (actions && actions.length) {
    const row = el("div", { className: "actions" });
    actions.forEach(({ label, onClick, secondary }) => {
      const btn = el("button", { className: "btn" + (secondary ? " secondary" : ""), type: "button", textContent: label });
      btn.addEventListener("click", onClick);
      row.appendChild(btn);
    });
    box.appendChild(row);
  }
  return box;
}

function renderEmpty(heading, body) {
  return el("div", { className: "empty" }, [
    el("h2", { textContent: heading }),
    el("p", { textContent: body }),
  ]);
}

// --- Zustaende ------------------------------------------------------------

function hostOf(url) {
  try {
    const parsed = new URL(url);
    // Nur echte Webseiten haben einen Hostnamen, der jemandem etwas sagt.
    // chrome://, chrome-extension:// und file: haetten sonst z.B. die
    // Erweiterungs-ID selbst in die Kopfzeile geschrieben.
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

/** Portaladresse ohne "https://" - im Popup zaehlt der Host, nicht das Schema. */
function portalLabel(origin) {
  try {
    return new URL(origin).host;
  } catch (e) {
    return origin || "";
  }
}

/** Anzeigename der Seite: der Treffer-Begriff, sonst aus der Domain geraten. */
function siteBrandName(state) {
  if (state.brand) return displayBrand(state.brand);
  const guessed = guessBrandCandidates(hostOf(state.url))[0];
  return displayBrand(guessed || hostOf(state.url));
}

function render(state) {
  contentEl.innerHTML = "";
  setBodyState(state.status);
  hostEl.textContent = state.status === "no-portal" ? "" : hostOf(state.url);

  // Ohne Portal gibt es nichts zu suchen; bei "nicht angemeldet" waere jede
  // Suche derselbe Fehlschlag. In beiden Faellen bleibt das Suchfeld weg.
  const searchable = state.status === "ok" || state.status === "not-applicable" || state.status === "error";
  manualForm.hidden = !searchable;
  document.body.classList.toggle("no-search", !searchable);

  // Ohne Anmeldung oder Zugriff wuerde "REFRESH" nur denselben Fehler holen.
  catalogRefreshBtn.disabled = state.status === "not-logged-in" || state.status === "no-permission";

  switch (state.status) {
    case "no-portal":
      contentEl.appendChild(
        renderNotice({
          step: t("popupNoPortalStep"),
          heading: t("popupNoPortalHeading"),
          body: t("popupNoPortalBody"),
          actions: [{ label: t("popupNoPortalBtn"), onClick: () => chrome.runtime.openOptionsPage() }],
        })
      );
      break;

    case "no-permission":
      contentEl.appendChild(
        renderNotice({
          chip: t("popupNoPermissionChip"),
          heading: t("popupNoPermissionHeading"),
          body: t("popupNoPermissionBody"),
          origin: portalLabel(state.portalOrigin),
          actions: [
            {
              label: t("popupGrantAccessBtn"),
              onClick: async () => {
                const granted = await chrome.permissions.request({ origins: [state.portalOrigin + "/*"] });
                if (granted) {
                  await chrome.runtime.sendMessage({ target: "background", type: "RESCAN" });
                  main();
                }
              },
            },
          ],
        })
      );
      break;

    case "not-logged-in":
      contentEl.appendChild(
        renderNotice({
          chip: t("popupSessionEndedChip"),
          heading: t("popupNotLoggedInHeading"),
          body: t("popupNotLoggedInBody"),
          origin: portalLabel(state.portalOrigin),
          actions: [
            { label: t("popupOpenPortalBtn"), onClick: () => chrome.tabs.create({ url: state.portalOrigin }) },
            {
              label: t("popupTryAgainBtn"),
              secondary: true,
              onClick: async () => {
                await chrome.runtime.sendMessage({ target: "background", type: "RESCAN" });
                main();
              },
            },
          ],
        })
      );
      break;

    case "not-applicable":
      contentEl.appendChild(renderEmpty(t("popupNotApplicableHeading"), t("popupNotApplicable")));
      break;

    case "error":
      contentEl.appendChild(
        renderNotice({
          chip: t("popupErrorChip"),
          chipKind: "alert",
          heading: t("popupErrorHeading"),
          body: t("popupErrorNotice", [state.error || "unknown error"]),
        })
      );
      break;

    case "ok": {
      const deals = state.deals || [];
      if (deals.length === 0) {
        contentEl.appendChild(
          renderEmpty(t("popupNoMatchHeading", [siteBrandName(state)]), t("popupNoMatchBody"))
        );
        break;
      }
      const count = deals.length === 1 ? t("popupMatchesOne") : t("popupMatches", [String(deals.length)]);
      contentEl.appendChild(
        el("div", { className: "brand-head" }, [
          el("span", { className: "name", textContent: siteBrandName(state) }),
          el("span", { className: "count", textContent: count }),
        ])
      );
      const list = el("div", {});
      // Treffer aus dem Katalog tragen einen Stand; Live-Ergebnisse nicht.
      renderDealList(list, deals, deals[0] && deals[0].cachedAt);
      contentEl.appendChild(list);
      break;
    }

    default:
      contentEl.appendChild(renderEmpty(t("popupNotApplicableHeading"), t("popupDefaultHint")));
  }
}

// --- Ablauf ---------------------------------------------------------------

async function main() {
  let state = await chrome.runtime.sendMessage({ target: "background", type: "GET_TAB_STATE" });
  render(state || {});
  refreshCatalogBar();
  refreshAutoBar(state || {});

  // If this looks like a normal page, do a fresh rescan seeded with hints
  // pulled from the page itself (title / og:site_name) - these catch brands
  // whose domain doesn't cleanly split into words (e.g. "easyairportparking.de").
  if (state && (state.status === "ok" || state.status === "not-logged-in") && state.tabId != null) {
    const hints = await getPageHints(state.tabId);
    if (hints.length > 0) {
      await chrome.runtime.sendMessage({ target: "background", type: "RESCAN", hints });
      state = await chrome.runtime.sendMessage({ target: "background", type: "GET_TAB_STATE" });
      // Eine laufende manuelle Suche darf der Nachzuegler nicht wegraeumen.
      if (!document.body.classList.contains("searching")) render(state || {});
    }
  }
}

async function getPageHints(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const og = document.querySelector('meta[property="og:site_name"]');
        return { title: document.title || "", ogSiteName: og ? og.content : "" };
      },
    });
    return deriveHintCandidates(result || {});
  } catch (e) {
    // Injection can fail on restricted pages (chrome://, web store, etc.) - that's fine.
    return [];
  }
}

// --- Manuelle Suche -------------------------------------------------------

function exitSearch() {
  document.body.classList.remove("searching");
  manualResultsEl.innerHTML = "";
}

function syncSearchAffordances() {
  const hasValue = manualInput.value.trim().length > 0;
  manualForm.classList.toggle("has-value", hasValue);
  manualClearBtn.hidden = !hasValue;
}

manualInput.addEventListener("input", syncSearchAffordances);

manualClearBtn.addEventListener("click", () => {
  manualInput.value = "";
  syncSearchAffordances();
  exitSearch();
  manualInput.focus();
});

manualForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const term = manualInput.value.trim();
  if (!term) return;

  document.body.classList.add("searching");
  manualResultsEl.innerHTML = "";
  manualResultsEl.appendChild(el("p", { className: "placeholder", textContent: t("popupSearching") }));

  const response = await chrome.runtime.sendMessage({ target: "background", type: "MANUAL_SEARCH", term });
  manualResultsEl.innerHTML = "";

  if (!response || !response.ok) {
    const msg =
      response && response.error === "not-logged-in"
        ? t("popupManualErrNotLoggedIn")
        : response && response.error === "no-permission"
        ? t("popupManualErrNoPermission")
        : response && response.error === "no-portal"
        ? t("popupManualErrNoPortal")
        : t("popupManualErrGeneric");
    manualResultsEl.appendChild(el("p", { className: "placeholder", textContent: msg }));
    return;
  }

  const deals = response.deals || [];
  const label = deals.length === 1 ? t("popupSearchResultsOne") : t("popupSearchResults", [String(deals.length)]);
  manualResultsEl.appendChild(el("p", { className: "result-count", textContent: label }));
  const list = el("div", {});
  renderDealList(list, deals);
  manualResultsEl.appendChild(list);
});

// --- Seiten-Leiste: automatisches Melden hier abschalten -------------------
//
// Die globale Einstellung ("Popup automatisch oeffnen") sagt nur, WIE gemeldet
// wird. Hier legt man je Seite fest, OB - voruebergehend (bis der Browser
// geschlossen wird) oder dauerhaft. Die Zahl am Symbol bleibt in jedem Fall.

const autoBarEl = document.getElementById("autoBar");
const autoBarLabelEl = document.getElementById("autoBarLabel");
const autoBarSegEl = document.getElementById("autoBarSeg");
const autoBarScopeEl = document.getElementById("autoBarScope");

const AUTO_MODES = [
  { mode: "off", label: "popupAutoOn", title: "popupAutoOnTitle", state: "popupAutoStateOn" },
  { mode: "session", label: "popupAutoSession", title: "popupAutoSessionTitle", state: "popupAutoStateSession" },
  { mode: "always", label: "popupAutoAlways", title: "popupAutoAlwaysTitle", state: "popupAutoStateAlways" },
];

let autoBarHost = null;
// "host" = genau diese Adresse, "domain" = "*.beispiel.de", also samt aller
// Unterseiten. Grosse Anbieter verteilen sich sonst ueber ein Dutzend Hosts
// (mail./docs./www.google.com), und jeder wollte einzeln abgeschaltet werden.
let autoBarScope = "host";
// Der Eintrag, der die Seite gerade stillstellt. Bei einem Muster ist das nicht
// der Hostname - und "wieder einschalten" muss dann das Muster loeschen, sonst
// klickt man ins Leere.
let autoBarEntry = null;

function autoBarKey() {
  if (!autoBarHost) return "";
  return autoBarScope === "domain" ? domainMutePattern(autoBarHost) : autoBarHost;
}

AUTO_MODES.forEach(({ mode, label, title }) => {
  const btn = el("button", { type: "button", textContent: t(label), title: t(title) });
  btn.dataset.mute = mode;
  btn.addEventListener("click", async () => {
    if (!autoBarHost) return;
    if (mode === "off") {
      // Was auch immer gerade greift, muss weg - der Hostname allein reicht
      // nicht, wenn ein Muster dahintersteht.
      await setSiteMute(autoBarEntry || autoBarKey(), "off");
    } else {
      await setSiteMute(autoBarKey(), mode);
    }
    await paintAutoBar();
  });
  autoBarSegEl.appendChild(btn);
});

const AUTO_SCOPES = [
  { scope: "host", label: "popupScopeHost", title: "popupScopeHostTitle" },
  { scope: "domain", label: "popupScopeDomain", title: "popupScopeDomainTitle" },
];

AUTO_SCOPES.forEach(({ scope, label, title }) => {
  const btn = el("button", { type: "button", textContent: t(label), title: t(title) });
  btn.dataset.scope = scope;
  btn.addEventListener("click", async () => {
    if (!autoBarHost || autoBarScope === scope) return;
    const previousScope = autoBarScope;
    autoBarScope = scope;
    // Steht die Seite schon still, folgt die Sperre dem neuen Umfang, statt
    // erst beim naechsten Klick auf "Nie" zu wirken.
    const current = await getSiteMuteMatch(autoBarHost);
    if (current.mode !== "off") {
      const previousKey = previousScope === "domain" ? domainMutePattern(autoBarHost) : autoBarHost;
      // Nur den eigenen Eintrag zuruecknehmen. Ein fremdes Muster (z. B. ein
      // von Hand gesetztes "google.*") gehoert dem Nutzer, nicht diesem Klick.
      if (current.entry === previousKey) await setSiteMute(current.entry, "off");
      await setSiteMute(autoBarKey(), current.mode);
    }
    await paintAutoBar();
  });
  autoBarScopeEl.appendChild(btn);
});

async function paintAutoBar() {
  const { mode, entry } = await getSiteMuteMatch(autoBarHost);
  autoBarEntry = entry;
  // Der gesetzte Eintrag bestimmt den angezeigten Umfang - sonst zeigte die
  // Leiste "nur diese Seite", waehrend in Wahrheit die ganze Domain still ist.
  if (entry) autoBarScope = isMutePattern(entry) ? "domain" : "host";

  const active = AUTO_MODES.find((m) => m.mode === mode) || AUTO_MODES[0];
  autoBarLabelEl.textContent = entry && isMutePattern(entry)
    ? t(mode === "session" ? "popupAutoStateSessionPattern" : "popupAutoStateAlwaysPattern", [entry])
    : t(active.state);

  autoBarSegEl.querySelectorAll("button").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.mute === active.mode ? "true" : "false");
  });
  autoBarScopeEl.querySelectorAll("button").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.scope === autoBarScope ? "true" : "false");
  });
}

async function refreshAutoBar(state) {
  const host = hostOf(state.url);
  const stored = await chrome.storage.sync.get(CB_NOTIFY_KEY);
  const level = stored[CB_NOTIFY_KEY] || CB_NOTIFY_DEFAULT;
  // Auf Nicht-Webseiten gibt es keinen Host zum Merken, und bei "nur die Zahl
  // am Symbol" meldet sich ohnehin nichts von selbst - dann waere der Schalter
  // eine Einstellung ohne Wirkung.
  if (!host || level === "silent" || state.status === "no-portal") {
    autoBarEl.hidden = true;
    autoBarHost = null;
    return;
  }
  autoBarHost = host;
  autoBarScope = "host";
  autoBarEl.hidden = false;

  // Die Umfangsknoepfe tragen die echten Namen - "google.com" sagt mehr als
  // "ganze Domain", wenn man gerade auf mail.google.com steht.
  const domainBtn = autoBarScopeEl.querySelector('[data-scope="domain"]');
  const pattern = domainMutePattern(host);
  domainBtn.textContent = pattern || t("popupScopeDomain");
  domainBtn.title = t("popupScopeDomainTitle", [baseDomainOf(host)]);
  const hostBtn = autoBarScopeEl.querySelector('[data-scope="host"]');
  hostBtn.title = t("popupScopeHostTitle", [host]);

  await paintAutoBar();
}

// --- Katalogleiste: Alter anzeigen und manuell erneuern --------------------

const catalogAgeEl = document.getElementById("catalogAge");
const catalogRefreshBtn = document.getElementById("catalogRefresh");

catalogRefreshBtn.textContent = t("popupCatalogRefresh");
catalogRefreshBtn.addEventListener("click", async () => {
  catalogRefreshBtn.disabled = true;
  catalogAgeEl.textContent = t("popupCatalogSyncing");
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", type: "SYNC_CATALOG" });
    if (!res || !res.ok) {
      catalogAgeEl.innerHTML = "";
      if (res && res.error === "not-logged-in") {
        // Direkt verlinken - sonst muesste man die Portaladresse erst suchen.
        catalogAgeEl.appendChild(document.createTextNode(t("popupManualErrNotLoggedIn") + " "));
        if (res.portalOrigin) catalogAgeEl.appendChild(portalLink(res.portalOrigin));
      } else if (res && res.error === "no-portal") {
        catalogAgeEl.textContent = t("popupManualErrNoPortal");
      } else {
        catalogAgeEl.textContent = t("popupCatalogErr");
      }
      return;
    }
    // Neu bewerten - der frische Katalog kann andere Treffer liefern.
    await chrome.runtime.sendMessage({ target: "background", type: "RESCAN" });
    const state = await chrome.runtime.sendMessage({ target: "background", type: "GET_TAB_STATE" });
    if (!document.body.classList.contains("searching")) render(state || {});
    await refreshCatalogBar();
  } finally {
    catalogRefreshBtn.disabled = false;
  }
});

async function refreshCatalogBar() {
  const s = await chrome.runtime.sendMessage({ target: "background", type: "GET_CATALOG_STATUS" });
  if (!s || !s.hasCatalog) {
    catalogAgeEl.textContent = t("popupCatalogNone");
    return;
  }
  const age = formatCatalogAgeShort(Date.now() - s.fetchedAt, t);
  catalogAgeEl.textContent = t("popupCatalogBar", [String(s.count), age]);
}

main();
