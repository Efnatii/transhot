chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "persistResult") return false;

  handlePersistRequest(message)
    .then((downloadId) => sendResponse({ success: true, downloadId }))
    .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));

  return true;
});

async function handlePersistRequest({ hash, data }) {
  if (!hash || !data) {
    throw new Error("Неверные данные для сохранения результата Vision");
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url,
          filename: `transhot/${hash}/vision-result.json`,
          saveAs: false,
          conflictAction: "overwrite",
        },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(id);
          }
        }
      );
    });

    return downloadId;
  } finally {
    URL.revokeObjectURL(url);
  }
}
