// The panel is injected on demand rather than declared as a content script, so
// the extension holds no standing access to any site: activeTab grants access
// to one tab, at the moment its button is clicked, and nothing more.

const FILES = ['content.js'];

/**
 * Injects into the page's own world rather than the isolated one.
 *
 * Isolated content scripts get their requests judged against the extension's
 * origin. Chrome waives that when host permissions cover the site; Safari does
 * not, and glowfic sends no CORS headers to fall back on, so the panel could
 * not read the thread it was sitting on. Running as page script makes the
 * request same-origin, which is what the bookmarklet build has always done.
 */
async function inject(tabId) {
  const target = { tabId };
  try {
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: FILES });
    return 'MAIN';
  } catch (error) {
    // `world` is a newer option; fall back rather than fail outright.
    console.warn('Glowfic Transcript: main-world injection failed:', error);
    await chrome.scripting.executeScript({ target, files: FILES });
    return 'ISOLATED';
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await inject(tab.id);
  } catch (error) {
    // Chrome and Safari both block injection into their own pages.
    console.warn('Glowfic Transcript could not run on this page:', error);
  }
});
