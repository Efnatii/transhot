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
    const paragraph = document.createElement("div");
    paragraph.className = "empty";
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
  const original = typeof block === "string" ? "" : block?.originalText || "";
  const translated = typeof block === "string" ? block : block?.translatedText || "";

  return {
    title: `Блок ${index + 1}`,
    original,
    translated,
  };
}

function createEntryElement({ hash, meta, translations, context, pageEntry }) {
  const container = document.createElement("article");
  container.className = "entry";

  const header = document.createElement("div");
  header.className = "entry-header";

  if (meta?.imageUrl) {
    const thumbnail = document.createElement("img");
    thumbnail.className = "entry-thumbnail";
    thumbnail.src = meta.imageUrl;
    thumbnail.alt = "Миниатюра изображения";
    thumbnail.loading = "lazy";
    header.appendChild(thumbnail);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "action-button";
  deleteButton.textContent = "Стереть перевод";
  deleteButton.dataset.hash = hash;
  actions.appendChild(deleteButton);

  const blocksContainer = document.createElement("div");
  const translationItems = Array.isArray(translations) ? translations : [];
  if (translationItems.length === 0) {
    const emptyBlock = document.createElement("div");
    emptyBlock.className = "empty";
    emptyBlock.textContent = "Нет сохранённых блоков перевода.";
    blocksContainer.appendChild(emptyBlock);
  } else {
    translationItems.forEach((block, index) => {
      const normalized = createBlockElement(block, index);
      blocksContainer.appendChild(createLabeledBlock(`${normalized.title} — оригинал`, normalized.original));
      blocksContainer.appendChild(createLabeledBlock(`${normalized.title} — перевод`, normalized.translated));
    });
  }

  const metaBlock = [
    `Последний перевод: ${formatDate(pageEntry?.updatedAt) || "—"}`,
    meta?.imageUrl ? `URL изображения: ${meta.imageUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  container.appendChild(header);
  container.appendChild(createLabeledBlock("Метаданные", metaBlock));
  container.appendChild(actions);
  container.appendChild(blocksContainer);
  container.appendChild(createLabeledBlock("Контекст", context));

  return container;
}

function createLabeledBlock(label, value) {
  const block = document.createElement("div");
  block.className = "block";

  const labelEl = document.createElement("div");
  labelEl.className = "label";
  labelEl.textContent = label;
  block.appendChild(labelEl);

  if (value) {
    const pre = document.createElement("pre");
    pre.textContent = value;
    block.appendChild(pre);
  } else {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "—";
    block.appendChild(empty);
  }

  return block;
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

  const params = new URLSearchParams(window.location.search);
  const sourceUrl = params.get("sourceUrl") || "";
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  const url = sourceUrl || activeTab?.url || "";

  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch (error) {
    origin = "";
  }

  debugSite.textContent = url ? `URL: ${url}` : "Не удалось определить активный сайт.";

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
