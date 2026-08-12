// Registered dynamically (see background.js) only after the user opts in to
// "automatic scanning" in the extension's settings. Runs on every page at
// document_idle and reads nothing but the page title and its og:site_name
// meta tag - just enough to guess the brand - then hands that off to the
// background script. It never reads page content, forms, or anything else.
(function () {
  const og = document.querySelector('meta[property="og:site_name"]');
  const hints = deriveHintCandidates({ title: document.title || "", ogSiteName: og ? og.content : "" });
  if (hints.length > 0) {
    chrome.runtime.sendMessage({ target: "background", type: "PAGE_HINTS", hints });
  }
})();
