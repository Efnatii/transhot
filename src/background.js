chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "persistResult") {
    handlePersistRequest(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));

    return true;
  }

  if (message?.type === "persistTranslation") {
    handlePersistTranslation(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));

    return true;
  }

  return false;
});

async function handlePersistRequest({ hash, data }) {
  if (!hash || !data) {
    throw new Error("Неверные данные для сохранения результата Vision");
  }

  const { transhotVisionResults = {} } = await chrome.storage.local.get("transhotVisionResults");
  const updatedResults = { ...transhotVisionResults, [hash]: data };

  await chrome.storage.local.set({ transhotVisionResults: updatedResults });
}

async function handlePersistTranslation({ hash, translations }) {
  if (!hash || !Array.isArray(translations)) {
    throw new Error("Неверные данные для сохранения перевода");
  }

  const { transhotTranslationResults = {} } = await chrome.storage.local.get("transhotTranslationResults");
  const updatedTranslations = { ...transhotTranslationResults, [hash]: translations };

  await chrome.storage.local.set({ transhotTranslationResults: updatedTranslations });
}
