// Runs in the extension's offscreen document, which - unlike the background
// service worker - has a real DOM, so it's where we parse the CB portal's
// HTML with DOMParser instead of fragile regexes.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return false;

  try {
    if (message.type === "PARSE_OFFERS") {
      sendResponse({ ok: true, deals: parseOfferList(message.html, message.portalOrigin) });
      return false;
    }
    if (message.type === "PARSE_CATEGORY_IDS") {
      sendResponse({ ok: true, categoryIds: parseCategoryIds(message.html) });
      return false;
    }
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
    return false;
  }

  return false;
});

/**
 * Extracts offers from any CB list page.
 *
 * The portal uses two different nestings for the same list item:
 *   search results : <h3><a>Name</a></h3>   (heading wraps link)
 *   category pages : <a><h3>Name</h3></a>   (link wraps heading)
 * Reading the <h3>'s text content instead of matching "h3 a" handles both.
 */
function parseOfferList(html, portalOrigin) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = doc.querySelectorAll(".cbg3-list-item[data-id]");
  const base = (portalOrigin || "").replace(/\/+$/, "");
  const deals = [];

  items.forEach((item) => {
    const id = item.getAttribute("data-id");
    const linkEl = item.querySelector('a[href^="/offer/"]');
    const href = linkEl ? linkEl.getAttribute("href") : null;
    if (!id || !href) return;

    const h3 = item.querySelector("h3");
    const title = h3 ? h3.textContent.replace(/\s*-\s*$/, "").trim() : "";
    if (!title) return;

    // "Bosch Siemens Hausgeräte - August-Special" -> brand is the part before
    // the dash; the suffix is campaign wording, not part of the brand name.
    const brand = title.split(" - ")[0].trim();

    const descEl = item.querySelector(".cbg3-list-item--copy, .cbg3-offer-list-item--content p");
    const description = descEl ? descEl.textContent.trim() : "";
    const discountEl = item.querySelector(".cbg3-list-item--discount");
    const discount = discountEl ? discountEl.textContent.trim() : "";
    const logoEl = item.querySelector(".cbg3-offerlistitem--supplierlogo img");
    const logo = logoEl ? logoEl.getAttribute("src") || logoEl.getAttribute("data-original") : null;
    const breadcrumbEl = item.querySelector(".cbg3-list-item--breadcrumb");
    const category = breadcrumbEl ? breadcrumbEl.textContent.trim() : "";

    deals.push({
      id,
      title,
      brand,
      description,
      discount,
      category,
      logo,
      url: base + href,
    });
  });

  return deals;
}

/**
 * Reads the top-level category ids out of the portal's main navigation
 * (/overview/<id>). Discovered rather than hardcoded, because each employer's
 * portal can expose a different set of categories.
 */
function parseCategoryIds(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set();
  doc.querySelectorAll('a[href*="/overview/"]').forEach((a) => {
    const m = (a.getAttribute("href") || "").match(/\/overview\/(\d+)/);
    if (m) ids.add(m[1]);
  });
  return [...ids];
}
