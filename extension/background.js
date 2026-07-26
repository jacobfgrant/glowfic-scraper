// The panel is injected on demand rather than declared as a content script, so
// the extension holds no standing access to any site: activeTab grants access
// to one tab, at the moment its button is clicked, and nothing more.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (error) {
    // Chrome blocks injection into its own pages and the extension gallery.
    console.warn('Glowfic Clean Transcript could not run on this page:', error);
  }
});
