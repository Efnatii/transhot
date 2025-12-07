chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "persistResult") return false;

  handlePersistRequest(message)
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));

  return true;
});

async function handlePersistRequest({ hash, data }) {
  if (!hash || !data) {
    throw new Error("Неверные данные для сохранения результата Vision");
  }

  const { transhotVisionResults = {} } = await chrome.storage.local.get("transhotVisionResults");
  const updatedResults = { ...transhotVisionResults, [hash]: data };

  await chrome.storage.local.set({ transhotVisionResults: updatedResults });
}
