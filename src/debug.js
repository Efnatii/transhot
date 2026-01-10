const debugList = document.getElementById("debug-list");
const debugSite = document.getElementById("debug-site");

const STORAGE_KEYS = [
  "transhotTranslationResults",
  "transhotTranslationContexts",
  "transhotImageMeta",
  "transhotVisionResults",
  "transhotProcessedHashes",
];

function setDebugMessage(message) {
  if (debugList) {
    debugList.innerHTML = "";
    const paragraph = document.createElement("p");
    paragraph.className = "hint";
    paragraph.textContent = message;
    debugList.appendChild(paragraph);
  }
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU");
}

function createBlockElement(block, index) {
  const element = document.createElement("div");
  element.className = "debug-block";

  const original = typeof block === "string" ? "" : block?.originalText || "";
  const translated = typeof block === "string" ? block : block?.translatedText || "";

  const header = document.createElement("div");
  header.className = "debug-block-header";
  header.textContent = `Блок ${index + 1}`;

  const originalLabel = document.createElement("strong");
  originalLabel.textContent = "Оригинал";
  const originalText = document.createElement("div");
  originalText.textContent = original || "—";

  const translatedLabel = document.createElement("strong");
  translatedLabel.textContent = "Перевод";
  const translatedText = document.createElement("div");
  translatedText.textContent = translated || "—";

  element.appendChild(header);
  element.appendChild(originalLabel);
  element.appendChild(originalText);
  element.appendChild(translatedLabel);
  element.appendChild(translatedText);

  return element;
}

function createEntryElement({ hash, meta, translations, context, pageEntry }) {
  const container = document.createElement("article");
  container.className = "debug-entry";

  const header = document.createElement("div");
  header.className = "debug-entry-header";

  const image = document.createElement("img");
  image.className = "debug-image";
  image.alt = "Переведённое изображение";
  if (meta?.imageUrl) {
    image.src = meta.imageUrl;
  } else {
    image.classList.add("debug-image-placeholder");
  }

  const metaColumn = document.createElement("div");
  metaColumn.className = "debug-meta";

  const urlRow = document.createElement("div");
  urlRow.className = "debug-meta-row";
  const urlLabel = document.createElement("strong");
  urlLabel.textContent = "Страница";
  const urlValue = document.createElement("div");
  urlValue.textContent = pageEntry?.url || "Неизвестно";
  urlRow.appendChild(urlLabel);
  urlRow.appendChild(urlValue);

  const titleRow = document.createElement("div");
  titleRow.className = "debug-meta-row";
  const titleLabel = document.createElement("strong");
  titleLabel.textContent = "Заголовок";
  const titleValue = document.createElement("div");
  titleValue.textContent = pageEntry?.title || "—";
  titleRow.appendChild(titleLabel);
  titleRow.appendChild(titleValue);

  const timeRow = document.createElement("div");
  timeRow.className = "debug-meta-row";
  const timeLabel = document.createElement("strong");
  timeLabel.textContent = "Последний перевод";
  const timeValue = document.createElement("div");
  timeValue.textContent = formatDate(pageEntry?.updatedAt) || "—";
  timeRow.appendChild(timeLabel);
  timeRow.appendChild(timeValue);

  if (meta?.imageUrl) {
    const imageRow = document.createElement("div");
    imageRow.className = "debug-meta-row";
    const imageLabel = document.createElement("strong");
    imageLabel.textContent = "URL изображения";
    const imageValue = document.createElement("div");
    imageValue.textContent = meta.imageUrl;
    imageRow.appendChild(imageLabel);
    imageRow.appendChild(imageValue);
    metaColumn.appendChild(imageRow);
  }

  metaColumn.appendChild(urlRow);
  metaColumn.appendChild(titleRow);
  metaColumn.appendChild(timeRow);

  header.appendChild(image);
  header.appendChild(metaColumn);

  const actions = document.createElement("div");
  actions.className = "debug-actions";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "primary-button debug-delete";
  deleteButton.textContent = "Стереть перевод";
  deleteButton.dataset.hash = hash;
  actions.appendChild(deleteButton);

  const blocksContainer = document.createElement("div");
  blocksContainer.className = "debug-blocks";
  const translationItems = Array.isArray(translations) ? translations : [];
  if (translationItems.length === 0) {
    const emptyBlock = document.createElement("p");
    emptyBlock.className = "hint";
    emptyBlock.textContent = "Нет сохранённых блоков перевода.";
    blocksContainer.appendChild(emptyBlock);
  } else {
    translationItems.forEach((block, index) => {
      blocksContainer.appendChild(createBlockElement(block, index));
    });
  }

  const contextSection = document.createElement("div");
  contextSection.className = "debug-context-section";
  const contextLabel = document.createElement("strong");
  contextLabel.textContent = "Контекст";
  const contextValue = document.createElement("div");
  contextValue.className = "debug-context";
  contextValue.textContent = context || "—";
  contextSection.appendChild(contextLabel);
  contextSection.appendChild(contextValue);

  container.appendChild(header);
  container.appendChild(actions);
  container.appendChild(blocksContainer);
  container.appendChild(contextSection);

  return container;
}

async function deleteTranslation(hash) {
  if (!hash) return;

  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const translations = stored.transhotTranslationResults || {};
  const contexts = stored.transhotTranslationContexts || {};
  const visionResults = stored.transhotVisionResults || {};
  const processedHashes = Array.isArray(stored.transhotProcessedHashes) ? stored.transhotProcessedHashes : [];

  if (!translations[hash]) return;

  delete translations[hash];
  delete contexts[hash];
  delete visionResults[hash];

  const updatedProcessed = processedHashes.filter((item) => item !== hash);

  await chrome.storage.local.set({
    transhotTranslationResults: translations,
    transhotTranslationContexts: contexts,
    transhotVisionResults: visionResults,
    transhotProcessedHashes: updatedProcessed,
  });
}

async function loadDebugData() {
  if (!debugList || !debugSite) return;

  setDebugMessage("Загрузка переводов…");

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  const url = activeTab?.url || "";

  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch (error) {
    origin = "";
  }

  debugSite.textContent = origin ? `Сайт: ${origin}` : "Не удалось определить активный сайт.";

  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  const translations = stored.transhotTranslationResults || {};
  const contexts = stored.transhotTranslationContexts || {};
  const metaMap = stored.transhotImageMeta || {};

  const entries = Object.entries(translations)
    .map(([hash, translationList]) => {
      const meta = metaMap[hash];
      const pages = Array.isArray(meta?.pages) ? meta.pages : [];
      const pageEntry = pages.find((page) => page.origin === origin);
      if (!pageEntry) return null;
      return {
        hash,
        translations: translationList,
        context: contexts[hash] || "",
        meta,
        pageEntry,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.pageEntry?.updatedAt || 0) - (a.pageEntry?.updatedAt || 0));

  if (entries.length === 0) {
    setDebugMessage("На этом сайте ещё нет сохранённых переводов изображений.");
    return;
  }

  debugList.innerHTML = "";
  entries.forEach((entry) => {
    const element = createEntryElement(entry);
    debugList.appendChild(element);
  });
}

debugList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button?.dataset?.hash) return;
  await deleteTranslation(button.dataset.hash);
  await loadDebugData();
});

document.addEventListener("DOMContentLoaded", () => {
  loadDebugData();
});
