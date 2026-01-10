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

  if (message?.type === "fetchImage") {
    handleFetchImage(message)
      .then((base64) => sendResponse({ success: true, base64 }))
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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

async function handleFetchImage({ url }) {
  if (!url) {
    throw new Error("Не указан URL изображения");
  }

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok && !(isFileUrl(url) && response.status === 0)) {
    throw new Error(`Ответ изображения: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function isFileUrl(url) {
  try {
    return new URL(url).protocol === "file:";
  } catch (error) {
    return false;
  }
}
