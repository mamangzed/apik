function createPanelWithFallback() {
  const candidates = [
    'devtools/panel.html',
    '/devtools/panel.html',
    'panel.html',
  ];

  function tryNext(index) {
    if (index >= candidates.length) {
      // eslint-disable-next-line no-console
      console.error('[APIK DevTools] Failed to create panel with all candidate paths.');
      return;
    }

    chrome.devtools.panels.create('APIK', '', candidates[index], () => {
      if (chrome.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.warn('[APIK DevTools] Panel path failed:', candidates[index], chrome.runtime.lastError.message);
        tryNext(index + 1);
      }
    });
  }

  tryNext(0);
}

createPanelWithFallback();
