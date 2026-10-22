(() => {
  if (globalThis.caoCaoContentInstalled) return;
  globalThis.caoCaoContentInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('CAOCAO_')) return;
    try {
      if (message.type === 'CAOCAO_READ') respond(globalThis.CaoCaoReader.read(message.options));
      else if (message.type === 'CAOCAO_ADVANCE') respond(globalThis.CaoCaoReader.advance());
    } catch { respond({ state: 'error', records: [], error: 'readFailed' }); }
  });
})();
