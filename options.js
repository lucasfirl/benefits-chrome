const t = (key, subs) => chrome.i18n.getMessage(key, subs);

const appMode = document.getElementById("appMode");
const setupView = document.getElementById("setupView");
const settingsView = document.getElementById("settingsView");

const setupForm = document.getElementById("setupForm");
const setupInput = document.getElementById("setupInput");
const setupStatus = document.getElementById("setupStatus");

const portalForm = document.getElementById("portalForm");
const portalInput = document.getElementById("portalInput");
const portalStatus = document.getElementById("status");

const autoScanToggle = document.getElementById("autoScanToggle");
const autoScanTitle = document.getElementById("autoScanTitle");
const autoScanDesc = document.getElementById("autoScanDesc");
const autoScanChip = document.getElementById("autoScanChip");
const autoScanStatus = document.getElementById("autoScanStatus");

const notifyList = document.getElementById("notifyList");
const sourcesList = document.getElementById("sourcesList");

const catalogRefreshBtn = document.getElementById("catalogRefreshBtn");
const catalogCount = document.getElementById("catalogCount");
const catalogStatus = document.getElementById("catalogStatus");

document.title = t("optionsPageTitle");
applyI18n();

function el(tag, props) {
  const node = document.createElement(tag);
  if (props) Object.assign(node, props);
  return node;
}

/** Portaladresse ohne Schema - im Panel zaehlt der Host, nicht "https://". */
function hostOfOrigin(origin) {
  try {
    return new URL(origin).host;
  } catch (e) {
    return origin || "";
  }
}

function setFieldStatus(node, text, kind, portalOrigin) {
  node.innerHTML = "";
  node.className = "field-status" + (kind ? " " + kind : "");
  if (!text) return;
  if (kind === "success") {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M20 6 9 17l-5-5");
    svg.appendChild(path);
    node.appendChild(svg);
  }
  node.appendChild(document.createTextNode(text));
  // Bei fehlender Anmeldung direkt ins Portal verlinken.
  if (portalOrigin) {
    node.appendChild(document.createTextNode(" "));
    node.appendChild(
      el("a", {
        className: "portal-link",
        href: portalOrigin,
        target: "_blank",
        rel: "noreferrer",
        textContent: t("catalogLoginLink"),
      })
    );
  }
}

// --- Standing status panel ------------------------------------------------

function setFact(id, text, dim) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.classList.toggle("dim", !!dim);
}

async function refreshStatusPanel() {
  const s = (await chrome.runtime.sendMessage({ target: "background", type: "GET_STATUS" })) || {};

  let headline = t("optionsStatusWorking");
  let dotClass = "";
  if (!s.portalOrigin) {
    headline = t("optionsStatusNeedsSetup");
    dotClass = "idle";
  } else if (!s.hasPermission) {
    headline = t("optionsStatusNoAccess");
    dotClass = "warn";
  } else if (s.loggedOut) {
    headline = t("optionsStatusSignedOut");
    dotClass = "warn";
  }
  document.getElementById("statusHeadline").textContent = headline;
  document.getElementById("statusDot").className = "dot" + (dotClass ? " " + dotClass : "");

  setFact("factPortal", s.portalOrigin ? hostOfOrigin(s.portalOrigin) : t("optionsValueNotSet"), !s.portalOrigin);

  const session = s.loggedOut
    ? t("optionsSessionSignedOut")
    : s.catalog && s.catalog.fresh
    ? t("optionsSessionSignedIn")
    : t("optionsSessionUnknown");
  setFact("factSession", session, s.loggedOut || !(s.catalog && s.catalog.fresh));

  if (s.catalog) {
    const age = formatCatalogAgeShort(Date.now() - s.catalog.fetchedAt, t);
    setFact("factCatalog", t("optionsFactCatalogueValue", [String(s.catalog.count), age]));
    setFact("factRequests", String(s.catalog.requestsPerSync));
  } else {
    setFact("factCatalog", t("optionsValueNone"), true);
    setFact("factRequests", "–", true);
  }

  setFact("factAutoScan", s.autoScan ? t("optionsValueOn") : t("optionsValueOff"), !s.autoScan);
}

// --- Catalogue ------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

async function refreshCatalogUi() {
  catalogRefreshBtn.textContent = t("optionsCatalogRefreshBtn");
  const s = await chrome.runtime.sendMessage({ target: "background", type: "GET_CATALOG_STATUS" });
  if (!s || !s.hasCatalog) {
    catalogCount.textContent = t("optionsValueNone");
    catalogStatus.textContent = t("optionsCatalogNone");
    return;
  }
  catalogCount.textContent = t("optionsCatalogOffers", [s.count.toLocaleString(chrome.i18n.getUILanguage())]);
  const age = formatCatalogAge(Date.now() - s.fetchedAt, t);
  if (s.fresh) {
    const daysLeft = Math.max(1, Math.round((s.fetchedAt + CB_CATALOG_MAX_AGE_MS - Date.now()) / DAY_MS));
    catalogStatus.textContent = t("optionsCatalogMeta", [age, t("catalogAgeDays", [String(daysLeft)])]);
  } else {
    catalogStatus.textContent = t("optionsCatalogMetaStale", [age]);
  }
}

catalogRefreshBtn.addEventListener("click", async () => {
  catalogRefreshBtn.disabled = true;
  catalogStatus.textContent = t("optionsCatalogSyncing");
  try {
    const res = await chrome.runtime.sendMessage({ target: "background", type: "SYNC_CATALOG" });
    if (!res || !res.ok) {
      const key =
        res && res.error === "not-logged-in"
          ? "optionsCatalogErrNotLoggedIn"
          : res && res.error === "no-permission"
          ? "optionsCatalogErrNoPermission"
          : res && res.error === "no-portal"
          ? "optionsCatalogErrNoPortal"
          : "optionsCatalogErrGeneric";
      catalogStatus.textContent = t(key);
      if (res && res.error === "not-logged-in" && res.portalOrigin) {
        catalogStatus.appendChild(document.createTextNode(" "));
        catalogStatus.appendChild(
          el("a", {
            className: "portal-link",
            href: res.portalOrigin,
            target: "_blank",
            rel: "noreferrer",
            textContent: t("catalogLoginLink"),
          })
        );
      }
      await refreshStatusPanel();
      return;
    }
    await refreshCatalogUi();
    await refreshStatusPanel();
  } finally {
    catalogRefreshBtn.disabled = false;
  }
});

// --- Portal address -------------------------------------------------------

/**
 * Speichert die Portaladresse und fragt die Berechtigung dafuer an.
 * Beide Formulare (Ersteinrichtung und Einstellungen) laufen hier zusammen.
 */
async function savePortal(value, statusNode) {
  const origin = normalizePortalInput(value);
  if (!origin) {
    setFieldStatus(statusNode, t("optionsStatusInvalid"), "error");
    return false;
  }

  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) {
    setFieldStatus(statusNode, t("optionsStatusNotGranted"), "error");
    return false;
  }

  await chrome.storage.sync.set({ [CB_STORAGE_KEY]: origin });
  setFieldStatus(statusNode, t("optionsStatusSavedGranted"), "success");
  // Frisch berechtigt: gleich den Katalog holen, damit die Erweiterung nicht
  // erst beim naechsten Seitenaufruf zu arbeiten anfaengt.
  chrome.runtime.sendMessage({ target: "background", type: "SYNC_CATALOG" }).catch(() => {});
  return true;
}

portalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await savePortal(portalInput.value, portalStatus)) {
    await refreshStatusPanel();
  }
});

setupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await savePortal(setupInput.value, setupStatus)) {
    portalInput.value = hostOfOrigin(normalizePortalInput(setupInput.value));
    await showSettingsView();
    setFieldStatus(portalStatus, t("optionsStatusSavedGranted"), "success");
  }
});

// --- Automatic scanning ---------------------------------------------------

// Der zuletzt gelesene Stand. Der Klick-Handler darf ihn nicht selbst frisch
// abfragen: chrome.permissions.request() will eine Nutzergeste, und die ist
// nach dem ersten await verbraucht - der Dialog kaeme dann gar nicht mehr.
let autoScanEnabled = false;
let lastGrantedOrigins = [];

async function refreshAutoScanUi() {
  const enabled = await cbHasAutoScanPermission();
  autoScanEnabled = enabled;
  const all = await chrome.permissions.getAll().catch(() => ({}));
  // Diagnose: zeigt, was Chrome wirklich gewaehrt hat, wenn der Schalter nicht
  // zum erteilten Zugriff passt.
  console.debug("[CB Deal Finder] auto scan permission:", enabled, all);
  lastGrantedOrigins = (all && all.origins) || [];
  if (enabled) setFieldStatus(autoScanStatus, "");
  autoScanToggle.setAttribute("aria-checked", enabled ? "true" : "false");
  autoScanTitle.textContent = enabled ? t("optionsAutoScanOnTitle") : t("optionsAutoScanOffTitle");
  autoScanDesc.textContent = enabled ? t("optionsAutoScanOnDesc") : t("optionsAutoScanOffDesc");
  // Der Hinweis gilt nur fuer das Einschalten - ist die Berechtigung erteilt,
  // fragt hier nichts mehr nach.
  autoScanChip.hidden = enabled;
}

// Der Zugriff laesst sich auch ausserhalb dieser Seite aendern (Symbolmenue,
// chrome://extensions). Liegt die Optionsseite dabei offen, zeigte sie sonst
// weiter den alten Stand.
chrome.permissions.onAdded.addListener(() => {
  refreshAutoScanUi();
  refreshStatusPanel();
});
chrome.permissions.onRemoved.addListener(() => {
  refreshAutoScanUi();
  refreshStatusPanel();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshAutoScanUi();
});

async function afterAutoScanChange(enabled) {
  try {
    await chrome.runtime.sendMessage({ target: "background", type: "SET_AUTO_SCAN", enabled });
  } catch (e) {
    console.error("[CB Deal Finder] SET_AUTO_SCAN failed", e);
  }
  await refreshAutoScanUi();
  await refreshStatusPanel();
}

// Callback-Form statt await: nur so laeuft der Aufruf noch innerhalb der
// Nutzergeste des Klicks, und Chrome zeigt den Berechtigungsdialog.
autoScanToggle.addEventListener("click", () => {
  if (autoScanEnabled) {
    chrome.permissions.remove({ origins: CB_AUTO_SCAN_ORIGINS }, (removed) => {
      if (chrome.runtime.lastError) {
        console.error("[CB Deal Finder] permissions.remove", chrome.runtime.lastError.message);
      }
      afterAutoScanChange(!removed);
    });
  } else {
    chrome.permissions.request({ origins: CB_AUTO_SCAN_ORIGINS }, (granted) => {
      if (chrome.runtime.lastError) {
        console.error("[CB Deal Finder] permissions.request", chrome.runtime.lastError.message);
      }
      // Abgelehnt: nur neu einlesen, damit der Schalter nicht faelschlich
      // umspringt - und erklaeren, statt den Nutzer klicken zu lassen, ohne
      // dass sich sichtbar etwas tut.
      if (granted) {
        afterAutoScanChange(true);
        return;
      }
      const detail = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : "granted=" + granted + ", origins=[" + lastGrantedOrigins.join(", ") + "]";
      setFieldStatus(autoScanStatus, t("optionsAutoScanDeniedHint") + " (" + detail + ")", "error");
      refreshAutoScanUi();
    });
  }
});

// --- Notification "loudness" ---------------------------------------------

notifyList.addEventListener("change", async (e) => {
  if (e.target.name !== "notifyLevel") return;
  await chrome.storage.sync.set({ [CB_NOTIFY_KEY]: e.target.value });
});

// --- Woraus der Markenname geraten wird ----------------------------------

sourcesList.addEventListener("change", async (e) => {
  if (e.target.name !== "matchSources") return;
  await chrome.storage.sync.set({ [CB_MATCH_SOURCES_KEY]: e.target.value });
});

// --- Sites with automatic alerts switched off -----------------------------
//
// Gesetzt wird das im Popup, je Seite. Hier stehen sie alle beisammen, damit
// man ein "Nie" auch wieder zuruecknehmen kann, ohne die Seite erst wieder
// aufzurufen.

const mutedList = document.getElementById("mutedList");
const mutedHead = document.getElementById("mutedHead");
const mutedCount = document.getElementById("mutedCount");
const mutedFilter = document.getElementById("mutedFilter");
const mutedClearAll = document.getElementById("mutedClearAll");
const mutedAddForm = document.getElementById("mutedAddForm");
const mutedAddInput = document.getElementById("mutedAddInput");
const mutedAddStatus = document.getElementById("mutedAddStatus");

// Hier - und nur hier - lassen sich Eintraege von Hand anlegen. Im Popup geht
// immer nur die Seite, auf der man gerade steht; ein Muster wie "google.*"
// deckt dagegen Adressen ab, die man nie einzeln besucht.
mutedAddForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = mutedAddInput.value;
  if (!isValidMuteEntry(raw)) {
    setFieldStatus(mutedAddStatus, t("optionsMutedAddInvalid"), "error");
    return;
  }
  const key = muteEntryKey(raw);
  const { always, session } = await readMutedHosts();
  if (always.has(key) || session.has(key)) {
    setFieldStatus(mutedAddStatus, t("optionsMutedAddDuplicate", [key]), "warn");
    return;
  }
  await setSiteMute(key, "always");
  mutedAddInput.value = "";
  setFieldStatus(mutedAddStatus, t("optionsMutedAddDone", [key]), "success");
  await refreshMutedUi();
});

mutedAddInput.addEventListener("input", () => setFieldStatus(mutedAddStatus, ""));

// Ab hier lohnt sich das Filterfeld - darunter sieht man ohnehin alle Zeilen
// auf einen Blick, und ein leeres Suchfeld waere nur Beiwerk. Die Liste selbst
// bekommt in CSS einen Hoehendeckel und scrollt danach in sich.
const MUTED_FILTER_THRESHOLD = 8;

let mutedEntries = [];

function renderMutedList() {
  const needle = mutedFilter.value.trim().toLowerCase();
  const shown = needle ? mutedEntries.filter((e) => e.host.includes(needle)) : mutedEntries;

  mutedList.innerHTML = "";
  if (mutedEntries.length === 0) {
    mutedList.appendChild(el("p", { className: "muted-empty", textContent: t("optionsMutedNone") }));
    return;
  }
  if (shown.length === 0) {
    mutedList.appendChild(el("p", { className: "muted-empty", textContent: t("optionsMutedNoMatch") }));
    return;
  }

  shown.forEach(({ host, temporary }) => {
    const row = el("div", { className: "muted-row" });
    row.appendChild(el("span", { className: "muted-host", textContent: host }));
    if (isMutePattern(host)) {
      row.appendChild(el("span", { className: "chip", textContent: t("optionsMutedPattern") }));
    }
    if (temporary) {
      row.appendChild(el("span", { className: "chip", textContent: t("optionsMutedTemporary") }));
    }
    const btn = el("button", {
      className: "btn outline",
      type: "button",
      textContent: t("optionsMutedRemoveBtn"),
    });
    btn.addEventListener("click", async () => {
      await setSiteMute(host, "off");
      await refreshMutedUi();
    });
    row.appendChild(btn);
    mutedList.appendChild(row);
  });
}

async function refreshMutedUi() {
  const { always, session } = await readMutedHosts();
  mutedEntries = [
    ...[...always].sort().map((host) => ({ host, temporary: false })),
    ...[...session].sort().map((host) => ({ host, temporary: true })),
  ];

  const count = mutedEntries.length;
  mutedHead.hidden = count === 0;
  mutedCount.textContent = count === 1 ? t("optionsMutedCountOne") : t("optionsMutedCount", [String(count)]);
  mutedFilter.hidden = count < MUTED_FILTER_THRESHOLD;
  if (mutedFilter.hidden) mutedFilter.value = "";
  resetClearAll();

  renderMutedList();
}

mutedFilter.addEventListener("input", renderMutedList);

// Zweistufig statt Dialog: der erste Klick fragt nach, der zweite raeumt.
// Eine lange Liste von Hand zurueckzunehmen waere muehsam, sie versehentlich
// zu verlieren aber auch aergerlich.
let clearAllArmed = false;

function resetClearAll() {
  clearAllArmed = false;
  mutedClearAll.textContent = t("optionsMutedClearAllBtn");
  mutedClearAll.classList.remove("armed");
}

mutedClearAll.addEventListener("click", async () => {
  if (!clearAllArmed) {
    clearAllArmed = true;
    mutedClearAll.textContent = t("optionsMutedClearAllConfirm");
    mutedClearAll.classList.add("armed");
    return;
  }
  await clearSiteMutes();
  await refreshMutedUi();
});

// Klick woanders hin nimmt die Nachfrage zurueck - so bleibt der scharfe
// Zustand nicht unbemerkt stehen, bis man das naechste Mal hinsieht.
document.addEventListener("click", (e) => {
  if (clearAllArmed && e.target !== mutedClearAll) resetClearAll();
});

// --- Views ----------------------------------------------------------------

async function showSettingsView() {
  setupView.hidden = true;
  settingsView.hidden = false;
  appMode.textContent = t("optionsModeSettings");
  await Promise.all([refreshAutoScanUi(), refreshCatalogUi(), refreshStatusPanel(), refreshMutedUi()]);
}

function showSetupView() {
  settingsView.hidden = true;
  setupView.hidden = false;
  appMode.textContent = t("optionsModeSetup");
  setupInput.focus();
}

async function load() {
  const stored = await chrome.storage.sync.get([CB_STORAGE_KEY, CB_NOTIFY_KEY, CB_MATCH_SOURCES_KEY]);
  const level = stored[CB_NOTIFY_KEY] || CB_NOTIFY_DEFAULT;
  const radio = notifyList.querySelector(`input[value="${level}"]`);
  if (radio) radio.checked = true;

  const sources = stored[CB_MATCH_SOURCES_KEY] === "domain" ? "domain" : CB_MATCH_SOURCES_DEFAULT;
  const sourceRadio = sourcesList.querySelector(`input[value="${sources}"]`);
  if (sourceRadio) sourceRadio.checked = true;

  if (stored[CB_STORAGE_KEY]) {
    // Ohne Schema anzeigen - normalizePortalInput() setzt https:// beim
    // Speichern ohnehin wieder davor.
    portalInput.value = hostOfOrigin(stored[CB_STORAGE_KEY]);
    await showSettingsView();
    return;
  }

  // Nur vorschlagen - erst der Klick auf "Weiter" fragt die Berechtigung an.
  if (CB_DEFAULT_PORTAL) {
    setupInput.value = CB_DEFAULT_PORTAL;
    portalInput.value = CB_DEFAULT_PORTAL;
  }
  showSetupView();
}

load();
