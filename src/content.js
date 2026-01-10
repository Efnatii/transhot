const OVERLAY_ID = "transhot-hover-overlay";
const COLLIDERS_ID = "transhot-text-colliders";
const DEBUG_TARGET_CLASS = "transhot-debug-target";
const ACTION_TRANSLATE = "translate";
const ACTIVE_COLLIDER_CLASS = "active";
const BLURRED_COLLIDER_CLASS = "blurred";
const TARGET_LANGUAGE = "русский";

let overlay;
let hideTimer;
let currentTarget;
let overlayTarget;
const processingTargets = new WeakSet();
const targetCache = new WeakMap();
let processedHashes = new Set();
let cachedAccessToken;
let visionResults = {};
let translationResults = {};
let debugMode = false;
let colliderContainer;
let colliderTarget;
let colliderTooltip;
let debugHighlightedTarget;

chrome.storage.local.get(
  ["transhotProcessedHashes", "transhotVisionResults", "transhotTranslationResults", "transhotDebugMode"],
  (result) => {
    const storedHashes = Array.isArray(result.transhotProcessedHashes) ? result.transhotProcessedHashes : [];
    const storedVisionResults = result.transhotVisionResults || {};
    const storedTranslations = result.transhotTranslationResults || {};
    const combinedHashes = new Set([...storedHashes, ...Object.keys(storedVisionResults)]);
    if (combinedHashes.size > 0) {
      processedHashes = combinedHashes;
    }
    visionResults = storedVisionResults;
    translationResults = storedTranslations;
    setDebugMode(Boolean(result.transhotDebugMode));
  }
);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (changes.transhotProcessedHashes) {
    const nextValue = changes.transhotProcessedHashes.newValue;
    processedHashes = new Set(Array.isArray(nextValue) ? nextValue : []);
  }

  if (changes.transhotVisionResults) {
    visionResults = changes.transhotVisionResults.newValue || {};
  }

  if (changes.transhotTranslationResults) {
    translationResults = changes.transhotTranslationResults.newValue || {};
  }

  if (changes.transhotDebugMode) {
    setDebugMode(Boolean(changes.transhotDebugMode.newValue));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "transhotTranslateAll") {
    handleTranslateAll(message.requestId)
      .then((summary) => sendResponse({ accepted: true, summary }))
      .catch((error) => {
        console.error("Ошибка массового перевода", error);
        sendResponse({ accepted: false, error: error?.message || String(error) });
      });

    return true;
  }

  return false;
});

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "transhot-overlay";
  overlay.innerHTML = `
    <button class="transhot-action transhot-icon-button" data-action="${ACTION_TRANSLATE}" aria-label="Перевести">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-default">
        <path d="M4 4h8v3H9.83a9.7 9.7 0 0 0 1.39 2.22 16 16 0 0 0 2.48-3.72h3.05c-.8 1.66-1.8 3.2-2.95 4.6l2.82 2.58-1.77 1.6-3.1-3c-.9.76-1.88 1.46-2.96 2.1L6 11.86c.82-.35 1.58-.76 2.3-1.23A9 9 0 0 1 6.7 8.05H5Z" />
        <path d="M15.5 10.5h3.1L22 20h-2.4l-.6-1.75h-2.9L15.5 20h-2.4l2.74-7.35a.9.9 0 0 1 .86-.6Zm.3 5.1h2.02l-.64-1.9h-.72z" />
        <path d="M6.5 16.5h4V19h-4z" />
      </svg>
    </button>
    <div class="transhot-loader hidden" aria-live="polite" aria-label="Выполняется перевод">
      <div class="pixel-spinner"><div class="pixel-core"></div></div>
    </div>
  `;

  overlay.addEventListener("mouseenter", clearHideTimer);
  overlay.addEventListener("mouseleave", scheduleHide);
  overlay.addEventListener("click", onOverlayClick);

  document.documentElement.appendChild(overlay);
  return overlay;
}

function ensureColliderContainer() {
  if (colliderContainer) return colliderContainer;

  const container = document.createElement("div");
  container.id = COLLIDERS_ID;
  container.className = "transhot-text-colliders";
  container.style.position = "absolute";
  container.style.pointerEvents = "none";
  container.style.zIndex = "2147483646";

  document.documentElement.appendChild(container);
  colliderContainer = container;
  applyDebugModeToContainer();
  return container;
}

function setDebugMode(enabled) {
  debugMode = enabled;
  applyDebugModeToContainer();
  refreshDebugHighlight();
}

function applyDebugModeToContainer() {
  if (!colliderContainer) return;
  colliderContainer.classList.toggle("debug-visible", debugMode);
}

function refreshDebugHighlight(preferredTarget) {
  const nextTarget = debugMode ? preferredTarget ?? currentTarget ?? colliderTarget : undefined;

  if (debugHighlightedTarget && debugHighlightedTarget !== nextTarget) {
    debugHighlightedTarget.classList.remove(DEBUG_TARGET_CLASS);
  }

  if (nextTarget) {
    nextTarget.classList.add(DEBUG_TARGET_CLASS);
  }

  debugHighlightedTarget = nextTarget;
}

function clearColliders() {
  colliderTarget = undefined;
  if (!colliderContainer) return;
  colliderContainer.innerHTML = "";
  colliderContainer.remove();
  colliderContainer = undefined;
  removeColliderTooltip();
  refreshDebugHighlight();
}

function onOverlayClick(event) {
  const button = event.target.closest(".transhot-action");
  if (!button) return;

  const action = button.dataset.action;
  if (action === ACTION_TRANSLATE) {
    startTranslation(currentTarget);
  }
}

function handleMouseOver(event) {
  const target = event.target.closest("img");
  if (!target) return;

  beginOverlayForTarget(target);
}

function handleMouseOut(event) {
  const activeTarget = currentTarget || colliderTarget;
  if (!activeTarget) return;
  if (overlay && overlay.contains(event.relatedTarget)) return;

  const leavingSameTarget = event.target === activeTarget && event.relatedTarget === activeTarget;
  if (leavingSameTarget) return;

  const relatedImage = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest("img");
  if (relatedImage === activeTarget) return;

  scheduleHide();
}

function handleMouseMove(event) {
  if (!colliderContainer) return;

  const colliders = Array.from(colliderContainer.children);
  if (colliders.length === 0) return;

  const containerRect = colliderContainer.getBoundingClientRect();
  const withinContainer =
    event.clientX >= containerRect.left &&
    event.clientX <= containerRect.right &&
    event.clientY >= containerRect.top &&
    event.clientY <= containerRect.bottom;

  const hoveredCollider = withinContainer
    ? colliders.find((collider) => {
        const rect = collider.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      })
    : undefined;

  colliders.forEach((collider) => {
    const isHovered = collider === hoveredCollider;
    collider.classList.toggle(BLURRED_COLLIDER_CLASS, isHovered);
    collider.classList.toggle(ACTIVE_COLLIDER_CLASS, debugMode && isHovered);
    if (!debugMode && !isHovered) {
      collider.classList.remove(ACTIVE_COLLIDER_CLASS);
    }
  });

  updateColliderTooltip(hoveredCollider);
}

function showOverlay(element) {
  clearHideTimer();
  element.classList.add("visible");
}

function scheduleHide() {
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    overlay?.classList.remove("visible");
    currentTarget = undefined;
    overlayTarget = undefined;
    clearColliders();
    refreshDebugHighlight();
  }, 140);
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function getTargetNaturalSize(target) {
  if (!target) return null;

  if (target instanceof HTMLImageElement) {
    return {
      width: target.naturalWidth || target.width || target.clientWidth,
      height: target.naturalHeight || target.height || target.clientHeight,
    };
  }

  return null;
}

function positionOverlay(element, target) {
  const rect = target.getBoundingClientRect();
  const overlayWidth = element.offsetWidth || 64;
  const preferredTop = window.scrollY + rect.top + 10;
  const centeredLeft = window.scrollX + rect.left + (rect.width - overlayWidth) / 2;

  const minLeft = window.scrollX + rect.left + 6;
  const maxLeft = window.scrollX + rect.right - overlayWidth - 6;
  element.style.top = `${preferredTop}px`;
  element.style.left = `${Math.min(Math.max(minLeft, centeredLeft), maxLeft)}px`;
}

function overlayFitsTarget(element, target) {
  const rect = target.getBoundingClientRect();
  const overlayWidth = element.offsetWidth || 64;
  const overlayHeight = element.offsetHeight || 64;
  const horizontalPadding = 12;
  const verticalOffset = 10;

  const fitsHorizontally = rect.width >= overlayWidth + horizontalPadding;
  const fitsVertically = rect.height >= overlayHeight + verticalOffset;

  return fitsHorizontally && fitsVertically;
}

function init() {
  document.addEventListener("mouseover", handleMouseOver);
  document.addEventListener("mouseout", handleMouseOut);
  document.addEventListener("mousemove", handleMouseMove);
}

init();

async function beginOverlayForTarget(target) {
  clearHideTimer();
  currentTarget = target;
  const overlayElement = ensureOverlay();
  if (!overlayFitsTarget(overlayElement, target)) {
    overlayElement.classList.remove("visible");
    currentTarget = undefined;
    clearColliders();
    refreshDebugHighlight();
    return;
  }

  try {
    const snapshot = await captureTargetSnapshot(target);
    if (colliderTarget && colliderTarget !== target) {
      clearColliders();
    }

    if (visionResults[snapshot.hash]) {
      renderTextColliders(target, snapshot.hash);
    } else {
      clearColliders();
    }

    if (processedHashes.has(snapshot.hash)) {
      overlayElement.classList.remove("visible");
      overlayTarget = undefined;
      refreshDebugHighlight(target);
      return;
    }
    overlayTarget = target;
    applyOverlayLoadingState(target);
    positionOverlay(overlayElement, target);
    showOverlay(overlayElement);
    refreshDebugHighlight(target);
  } catch (error) {
    console.warn("Не удалось подготовить оверлей", error);
  }
}

async function captureTargetSnapshot(target) {
  const cached = targetCache.get(target);
  if (cached) return cached;

  const arrayBuffer = await extractArrayBufferFromTarget(target);
  const hash = await digestBuffer(arrayBuffer);
  const base64 = bufferToBase64(arrayBuffer);
  const snapshot = { hash, base64 };
  targetCache.set(target, snapshot);
  return snapshot;
}

async function extractArrayBufferFromTarget(target) {
  if (target instanceof HTMLImageElement) {
    const src = target.currentSrc || target.src;
    if (isFileUrl(src)) {
      return fetchImageInBackground(src);
    }
    try {
      const response = await fetch(src, { mode: "cors" });
      if (!response.ok) {
        throw new Error(`Ответ изображения: ${response.status}`);
      }
      return await response.arrayBuffer();
    } catch (error) {
      return fetchImageInBackground(src);
    }
  }

  throw new Error("Неподдерживаемый тип элемента для перевода");
}

function isFileUrl(url) {
  try {
    return new URL(url, window.location.href).protocol === "file:";
  } catch (error) {
    return false;
  }
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

function fetchImageInBackground(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "fetchImage", url }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.success || !response?.base64) {
        reject(new Error(response?.error || "Не удалось получить изображение через сервис-воркер"));
        return;
      }

      try {
        resolve(base64ToArrayBuffer(response.base64));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function digestBuffer(buffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function extractVertices(source, naturalSize) {
  if (!source) return [];

  if (Array.isArray(source.vertices) && source.vertices.length > 0) {
    return source.vertices.map((vertex) => ({
      x: typeof vertex.x === "number" ? vertex.x : 0,
      y: typeof vertex.y === "number" ? vertex.y : 0,
    }));
  }

  if (Array.isArray(source.normalizedVertices) && source.normalizedVertices.length > 0 && naturalSize) {
    return source.normalizedVertices.map((vertex) => ({
      x: Math.round((vertex.x ?? 0) * naturalSize.width),
      y: Math.round((vertex.y ?? 0) * naturalSize.height),
    }));
  }

  return [];
}

function toBoundingRect(vertices) {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;

  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 0 || height <= 0) return null;

  return { left: minX, top: minY, width, height };
}

function collectTextBlockBounds(visionResponse, naturalSize) {
  const responses = visionResponse?.responses;
  if (!Array.isArray(responses) || responses.length === 0) return [];

  const [firstResponse] = responses;
  const pages = firstResponse?.fullTextAnnotation?.pages;
  if (!Array.isArray(pages)) return [];

  const bounds = [];
  pages.forEach((page) => {
    page?.blocks?.forEach((block) => {
      const vertices = extractVertices(block?.boundingBox || block?.boundingPoly, naturalSize);
      const rect = toBoundingRect(vertices);
      if (rect) {
        bounds.push(rect);
      }
    });
  });

  return bounds;
}

function collectTextBlocks(visionResponse) {
  const responses = visionResponse?.responses;
  if (!Array.isArray(responses) || responses.length === 0) return [];

  const [firstResponse] = responses;
  const pages = firstResponse?.fullTextAnnotation?.pages;
  if (!Array.isArray(pages)) return [];

  const blocks = [];
  pages.forEach((page) => {
    page?.blocks?.forEach((block) => {
      const text = extractTextFromBlock(block);
      if (text) {
        blocks.push({
          text,
          boundingPoly: block?.boundingPoly || block?.boundingBox || null,
        });
      }
    });
  });

  return blocks;
}

function collectFullText(visionResponse) {
  const responses = visionResponse?.responses;
  if (!Array.isArray(responses) || responses.length === 0) return "";

  const [firstResponse] = responses;
  const fullText = firstResponse?.fullTextAnnotation?.text;
  if (typeof fullText === "string" && fullText.trim()) {
    return fullText.trim();
  }

  return collectTextBlocks(visionResponse)
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractTextFromBlock(block) {
  const paragraphs = block?.paragraphs;
  if (!Array.isArray(paragraphs)) return "";

  const paragraphTexts = paragraphs
    .map((paragraph) => {
      const words = paragraph?.words;
      if (!Array.isArray(words)) return "";

      const wordTexts = words
        .map((word) => {
          const symbols = word?.symbols;
          if (!Array.isArray(symbols)) return "";

          return symbols.map((symbol) => symbol?.text || "").join("");
        })
        .filter(Boolean);

      return wordTexts.join(" ").trim();
    })
    .filter(Boolean);

  return paragraphTexts.join("\n").trim();
}

function renderTextColliders(target, hash) {
  const naturalSize = getTargetNaturalSize(target);
  if (!naturalSize || !naturalSize.width || !naturalSize.height) return;

  const visionResponse = visionResults[hash];
  if (!visionResponse) {
    clearColliders();
    return;
  }

  const bounds = collectTextBlockBounds(visionResponse, naturalSize);
  if (bounds.length === 0) {
    clearColliders();
    return;
  }

  const translations = translationResults[hash];

  const rect = target.getBoundingClientRect();
  const scaleX = rect.width / naturalSize.width;
  const scaleY = rect.height / naturalSize.height;
  const container = ensureColliderContainer();

  colliderTarget = target;
  container.innerHTML = "";
  container.style.width = `${rect.width}px`;
  container.style.height = `${rect.height}px`;
  container.style.left = `${window.scrollX + rect.left}px`;
  container.style.top = `${window.scrollY + rect.top}px`;

  bounds.forEach((bound, index) => {
    const collider = document.createElement("div");
    collider.className = "transhot-text-collider";
    collider.style.position = "absolute";
    collider.style.left = `${bound.left * scaleX}px`;
    collider.style.top = `${bound.top * scaleY}px`;
    collider.style.width = `${bound.width * scaleX}px`;
    collider.style.height = `${bound.height * scaleY}px`;

    const translationEntry = Array.isArray(translations)
      ? translations[index]
      : undefined;
    const translatedText = typeof translationEntry === "string"
      ? translationEntry
      : translationEntry?.translatedText;
    if (translatedText) {
      collider.dataset.translation = translatedText.trim();
    }

    container.appendChild(collider);
  });
  refreshDebugHighlight(target);
}

function ensureColliderTooltip() {
  if (colliderTooltip) return colliderTooltip;

  const tooltip = document.createElement("div");
  tooltip.className = "transhot-collider-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.style.position = "absolute";
  tooltip.style.pointerEvents = "none";
  tooltip.style.zIndex = "2147483647";

  document.documentElement.appendChild(tooltip);
  colliderTooltip = tooltip;
  return tooltip;
}

function removeColliderTooltip() {
  if (!colliderTooltip) return;
  colliderTooltip.remove();
  colliderTooltip = undefined;
}

function hideColliderTooltip() {
  if (!colliderTooltip) return;
  colliderTooltip.classList.remove("visible");
  colliderTooltip.textContent = "";
}

function updateColliderTooltip(collider) {
  if (!collider || !collider.dataset.translation) {
    hideColliderTooltip();
    return;
  }

  const tooltip = ensureColliderTooltip();
  tooltip.textContent = collider.dataset.translation;
  tooltip.classList.add("visible");

  const colliderRect = collider.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const pageX = window.scrollX + colliderRect.left;
  const pageY = window.scrollY + colliderRect.top;

  let top = pageY - tooltipRect.height - 10;
  if (top < window.scrollY + 6) {
    top = window.scrollY + colliderRect.bottom + 10;
  }

  const preferredLeft = pageX + (colliderRect.width - tooltipRect.width) / 2;
  const minLeft = window.scrollX + 8;
  const maxLeft = window.scrollX + window.innerWidth - tooltipRect.width - 8;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${Math.min(Math.max(minLeft, preferredLeft), maxLeft)}px`;
}

async function startTranslation(target) {
  return translateTarget(target, { manageOverlay: true });
}

async function translateTarget(target, options = {}) {
  const shouldManageOverlay = options.manageOverlay !== false;
  if (!target || processingTargets.has(target)) {
    return { status: "skippedBusy" };
  }

  processingTargets.add(target);
  if (shouldManageOverlay) {
    setLoadingState(true, target);
  }

  try {
    const targetForColliders = target;
    const snapshot = options.snapshot || (await captureTargetSnapshot(target));
    if (processedHashes.has(snapshot.hash)) {
      if (shouldManageOverlay) {
        hideOverlayForProcessed(target);
      }
      return { status: "skippedProcessed", hash: snapshot.hash };
    }

    const credentials = await loadVisionCredentials();
    const chatgptApiKey = await loadChatgptApiKey();
    const chatgptModel = await loadChatgptModel();
    const visionResponse = await sendToVision(snapshot.base64, credentials);
    visionResults = { ...visionResults, [snapshot.hash]: visionResponse };
    const persistResponse = await persistResultInBackground(snapshot.hash, visionResponse);
    if (!persistResponse.success) {
      throw new Error(persistResponse.error || "Не удалось сохранить результат Vision");
    }

    const blockTexts = collectTextBlocks(visionResponse);
    const contextSettings = await loadContextSettings();
    const textForContext = collectFullText(visionResponse);
    let translationContext = "";
    if (contextSettings.enabled) {
      translationContext = await generateTranslationContext({
        base64: snapshot.base64,
        text: textForContext,
        targetLanguage: TARGET_LANGUAGE,
        apiKey: chatgptApiKey,
        model: contextSettings.model,
      });
    }

    const translations = await translateBlocks(blockTexts, chatgptApiKey, chatgptModel, translationContext);
    if (translations.length > 0) {
      translationResults = { ...translationResults, [snapshot.hash]: translations };
      const persistTranslationResponse = await persistTranslationInBackground(snapshot.hash, translations);
      if (!persistTranslationResponse.success) {
        throw new Error(persistTranslationResponse.error || "Не удалось сохранить перевод");
      }
    }

    markHashProcessed(snapshot.hash);
    if (targetForColliders?.isConnected) {
      renderTextColliders(targetForColliders, snapshot.hash);
    }
    if (shouldManageOverlay) {
      hideOverlayForProcessed(target);
    }
    return { status: "translated", hash: snapshot.hash };
  } catch (error) {
    console.error("Ошибка перевода", error);
    if (shouldManageOverlay) {
      setLoadingState(false, target);
    }
    return { status: "failed", error };
  } finally {
    processingTargets.delete(target);
  }
}

function getTranslatableImages() {
  const overlayElement = ensureOverlay();
  return Array.from(document.querySelectorAll("img")).filter((img) => overlayFitsTarget(overlayElement, img));
}

function notifyBulkProgress(requestId, payload) {
  chrome.runtime.sendMessage({ type: "transhotTranslateAllProgress", requestId, ...payload });
}

async function handleTranslateAll(requestId) {
  const images = getTranslatableImages();
  const discovered = [];
  const seenHashes = new Set();
  let skippedProcessed = 0;

  notifyBulkProgress(requestId, {
    state: "discovering",
    total: images.length,
    completed: 0,
    skipped: 0,
    failed: 0,
  });

  for (const img of images) {
    try {
      const snapshot = await captureTargetSnapshot(img);
      if (seenHashes.has(snapshot.hash)) {
        continue;
      }
      seenHashes.add(snapshot.hash);

      if (processedHashes.has(snapshot.hash)) {
        skippedProcessed += 1;
        continue;
      }

      discovered.push({ target: img, snapshot });
    } catch (error) {
      console.warn("Не удалось подготовить изображение", error);
    }
  }

  let completed = 0;
  let failed = 0;

  for (const item of discovered) {
    notifyBulkProgress(requestId, {
      state: "translating",
      total: discovered.length,
      completed,
      skipped: skippedProcessed,
      failed,
    });

    const result = await translateTarget(item.target, { snapshot: item.snapshot, manageOverlay: false });
    if (result?.status === "translated") {
      completed += 1;
    } else if (result?.status === "skippedProcessed") {
      skippedProcessed += 1;
    } else if (result?.status !== "skippedBusy") {
      failed += 1;
    }
  }

  notifyBulkProgress(requestId, {
    state: "complete",
    total: discovered.length,
    completed,
    skipped: skippedProcessed,
    failed,
  });

  return { total: discovered.length, completed, skipped: skippedProcessed, failed };
}

function setLoadingState(loading, target) {
  const overlayElement = ensureOverlay();
  const loader = overlayElement.querySelector(".transhot-loader");

  const overlayMatchesTarget = !target || overlayTarget === target;
  if (!overlayMatchesTarget && !processingTargets.has(overlayTarget)) {
    overlayElement.classList.remove("loading");
    loader?.classList.add("hidden");
    return;
  }

  if (loading && overlayMatchesTarget) {
    overlayElement.classList.add("loading");
    loader?.classList.remove("hidden");
  } else if (overlayMatchesTarget) {
    overlayElement.classList.remove("loading");
    loader?.classList.add("hidden");
  }
}

function applyOverlayLoadingState(target) {
  const overlayElement = ensureOverlay();
  const loader = overlayElement.querySelector(".transhot-loader");
  const isProcessing = target ? processingTargets.has(target) : false;

  if (isProcessing) {
    overlayElement.classList.add("loading");
    loader?.classList.remove("hidden");
  } else {
    overlayElement.classList.remove("loading");
    loader?.classList.add("hidden");
  }
}

function hideOverlayForProcessed(target) {
  const overlayElement = ensureOverlay();
  const shouldHideOverlay = !currentTarget || currentTarget === target;
  if (shouldHideOverlay) {
    overlayElement.classList.remove("visible");
    currentTarget = undefined;
    overlayTarget = undefined;
  }
  setLoadingState(false, target);
  refreshDebugHighlight();
}

function markHashProcessed(hash) {
  processedHashes.add(hash);
  chrome.storage.local.set({ transhotProcessedHashes: Array.from(processedHashes) });
}

async function loadVisionCredentials() {
  const result = await chrome.storage.local.get("googleVisionCredsData");
  const storedCreds = result.googleVisionCredsData;
  const apiKey = storedCreds?.apiKey;
  const serviceAccount = storedCreds?.serviceAccount;
  if (!apiKey && !serviceAccount) {
    throw new Error("Учетные данные Vision не найдены: переукажите файл в настройках расширения");
  }

  if (apiKey) {
    return { apiKey };
  }

  if (serviceAccount?.privateKey && serviceAccount?.clientEmail) {
    return { serviceAccount };
  }

  throw new Error("Учетные данные Vision неполные: переукажите файл в настройках расширения");
}

async function loadChatgptApiKey() {
  const result = await chrome.storage.local.get("chatgptApiKey");
  const apiKey = (result.chatgptApiKey || "").trim();
  if (!apiKey) {
    throw new Error("API-ключ ChatGPT не найден: введите его в настройках расширения");
  }

  return apiKey;
}

async function loadChatgptModel() {
  const result = await chrome.storage.local.get("chatgptModel");
  const model = (result.chatgptModel || "").trim();
  return model || "gpt-5-nano";
}

async function loadContextSettings() {
  const result = await chrome.storage.local.get(["chatgptContextModel", "chatgptContextEnabled"]);
  const model = (result.chatgptContextModel || "").trim() || "gpt-5-nano";
  const enabled = Boolean(result.chatgptContextEnabled);
  return { model, enabled };
}

async function sendToVision(base64Image, credentials) {
  const body = {
    requests: [
      {
        image: { content: base64Image },
        features: [{ type: "TEXT_DETECTION" }],
      },
    ],
  };

  const headers = { "Content-Type": "application/json" };
  let url = "https://vision.googleapis.com/v1/images:annotate";

  if (credentials.apiKey) {
    url = `${url}?key=${encodeURIComponent(credentials.apiKey)}`;
  } else if (credentials.serviceAccount) {
    const token = await getAccessToken(credentials.serviceAccount);
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await describeResponseError(response);
    throw new Error(`Ответ Vision: ${response.status}${details ? ` (${details})` : ""}`);
  }

  return response.json();
}

async function translateBlocks(blockTexts, apiKey, model, translationContext) {
  if (!Array.isArray(blockTexts) || blockTexts.length === 0) return [];

  const translatedTexts = await sendToTranslation(
    blockTexts.map((item) => item.text),
    apiKey,
    model,
    translationContext
  );

  return blockTexts.map((block, index) => ({
    originalText: block.text,
    translatedText: translatedTexts[index] || "",
    boundingPoly: block.boundingPoly,
  }));
}

async function sendToTranslation(texts, apiKey, model, translationContext) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const doubleQuoteToken = "⟦DQUOTE⟧";
  const maskedTexts = texts.map((text) => String(text ?? "").replace(/"/g, doubleQuoteToken));
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const delimiter = "⟦TRANSHOT_DELIM⟧";
  const contextSection = translationContext
    ? ["Translation context for accuracy, terminology, style, and tone:", translationContext, ""].join("\n")
    : "";
  const prompt = [
    contextSection,
    "Translate each of the following text segments to Russian.",
    `There are ${maskedTexts.length} segments.`,
    `Return the translations in the same order, separated by the delimiter "${delimiter}".`,
    "Do not add extra text before or after the translations and do not use markdown.",
    `Do not remove or alter the special tokens ${delimiter} and ${doubleQuoteToken}.`,
    "Input segments (one per line):",
    ...maskedTexts.map((text, index) => `${index + 1}) ${text}`),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: [
            "You translate text segments to Russian.",
            "Return only the translations separated by the provided delimiter.",
            "Never remove or alter special tokens like ⟦TRANSHOT_DELIM⟧ or ⟦DQUOTE⟧.",
            translationContext
              ? "Use the provided translation context to preserve terminology, style, and tone."
              : "",
            "Do not request or output JSON.",
          ]
            .filter(Boolean)
            .join(" "),
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const details = await describeResponseError(response);
    throw new Error(`Ответ ChatGPT: ${response.status}${details ? ` (${details})` : ""}`);
  }

  const data = await response.json();
  const textResponse = data?.choices?.[0]?.message?.content?.trim() || "";

  const normalizeTranslations = (values) => {
    const arrayValues = Array.isArray(values) ? values : [values];
    const mapped = arrayValues.map((item) =>
      typeof item === "string" ? item : String(item ?? "")
    );
    const unmasked = mapped.map((item) =>
      item.split(doubleQuoteToken).join("\"")
    );
    const normalized = dedupeRepeatedTranslations(unmasked, texts.length);
    while (normalized.length < texts.length) {
      normalized.push("");
    }
    return normalized.slice(0, texts.length);
  };

  if (!textResponse) return [];

  const splitByDelimiter = textResponse
    .split(delimiter)
    .map((item) => item.trim());
  if (splitByDelimiter.length > 1) {
    return normalizeTranslations(splitByDelimiter);
  }

  const numberedItems = textResponse.match(/^\s*\d+[\).\-\s]+/m)
    ? textResponse
      .split(/\n(?=\s*\d+[\).\-\s]+)/)
      .map((item) => item.replace(/^\s*\d+[\).\-\s]+/, "").trim())
      .filter(Boolean)
    : [];
  if (numberedItems.length > 1) {
    return normalizeTranslations(numberedItems);
  }

  const paragraphItems = textResponse
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphItems.length > 1) {
    return normalizeTranslations(paragraphItems);
  }

  const lineItems = textResponse
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[\).\-\s]+/, "").trim())
    .filter(Boolean);
  return normalizeTranslations(lineItems.length > 0 ? lineItems : [textResponse]);
}

function buildContextPrompt(targetLanguage, text) {
  const safeText = text || "";
  return [
    `Проанализируй исходный текст и составь контекст для перевода на ${targetLanguage}.`,
    "Нужны максимально полезные детали для переводчика.",
    "Формат — строго по разделам ниже (кратко, пунктами).",
    "",
    "1) Тип текста и назначение:",
    "- жанр/домен (художественный, техдок, маркетинг, UI, новости и т.п.)",
    "- цель (информировать, убедить, инструктировать, описать, продать и т.п.)",
    "- предполагаемая аудитория (если явно видно)",
    "",
    "2) Сеттинг:",
    "- место действия, география, организации/локации (если указано)",
    "- время/эпоха/период (если указано)",
    "",
    "3) Участники/персонажи:",
    "- имена/роли/должности",
    "- пол/род/местоимения (если явно указано)",
    "- говорящие/адресаты (кто кому говорит)",
    "",
    "4) Отношения и социальные связи:",
    "- отношения между персонажами (если явно есть)",
    "- статус/иерархия (начальник‑подчинённый, клиент‑служба поддержки и т.п.)",
    "",
    "5) Сюжетные/фактологические опорные точки:",
    "- ключевые события/факты, которые нельзя исказить",
    "",
    "6) Терминология и единообразие:",
    "- термины/понятия/аббревиатуры, которые должны переводиться одинаково",
    "- рекомендуемые варианты перевода, если явно вытекают из контекста",
    "- что нельзя переводить или что оставлять как есть (только если это прямо следует из текста)",
    "",
    "7) Собственные имена и ономастика:",
    "- имена, бренды, продукты, организации, топонимы",
    "- как передавать: перевод/транслитерация/оставить как есть (оставлять как есть только при явном указании)",
    "",
    "8) Тональность и стиль:",
    "- официальный/разговорный/нейтральный/художественный/ирония и т.п.",
    "- уровень формальности и вежливости (ты/вы, обращения)",
    "",
    "9) Лингвистические особенности:",
    "- сленг, жаргон, диалект, архаизмы",
    "- игра слов/идиомы (если есть)",
    "- цитаты/цитируемая речь",
    "",
    "10) Формат и технические требования:",
    "- единицы измерения, валюты, даты, форматы",
    "- требования к краткости/структуре",
    "- повторяющиеся шаблоны/плейсхолдеры (если есть)",
    "",
    "Текст:",
    safeText,
    "",
    "Выводи только разделы с краткими пунктами.",
    "Если раздел не заполнен — напиши \"не указано\".",
  ].join("\n");
}

async function generateTranslationContext({ base64, text, targetLanguage, apiKey, model }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const systemPrompt = [
    "Ты — ассистент переводчика. Составь контекст для качественного перевода.",
    "Не пересказывай текст, не оценивай и не добавляй факты вне источника.",
    "Если информации нет, укажи \"не указано\".",
    "Фокусируйся на деталях, влияющих на точность, единообразие терминов, стиль и смысл.",
    "Не предлагай оставлять имена/названия/термины без перевода, если это не явно указано в тексте.",
    "Ответ должен быть структурированным и лаконичным.",
  ].join(" ");
  const prompt = buildContextPrompt(targetLanguage, text);
  const imageUrl = `data:image/png;base64,${base64}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await describeResponseError(response);
    throw new Error(`Ответ ChatGPT (контекст): ${response.status}${details ? ` (${details})` : ""}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

function dedupeRepeatedTranslations(values, expectedLength) {
  if (!Array.isArray(values) || values.length === 0) return [];
  if (!expectedLength || values.length <= expectedLength) return values;

  if (values.length % expectedLength === 0) {
    const chunkCount = values.length / expectedLength;
    let repeats = true;
    for (let chunk = 1; chunk < chunkCount; chunk += 1) {
      for (let index = 0; index < expectedLength; index += 1) {
        if (values[index] !== values[chunk * expectedLength + index]) {
          repeats = false;
          break;
        }
      }
      if (!repeats) break;
    }
    if (repeats) {
      return values.slice(0, expectedLength);
    }
  }

  return values;
}

async function describeResponseError(response) {
  try {
    const text = await response.text();
    if (!text) return "";

    try {
      const json = JSON.parse(text);
      const error = json.error;
      if (error?.message) return error.message;
      if (error?.status) return String(error.status);
    } catch (parseError) {
      console.warn("Не удалось распарсить тело ошибки", parseError);
    }

    const trimmed = text.trim();
    return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
  } catch (error) {
    console.warn("Не удалось прочитать тело ответа с ошибкой", error);
    return "";
  }
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const cleaned = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const binary = atob(cleaned);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

async function createServiceAccountJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.clientEmail,
    scope:
      "https://www.googleapis.com/auth/cloud-vision https://www.googleapis.com/auth/generative-language",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const headerPayload = `${base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  )}`;

  const keyData = pemToArrayBuffer(serviceAccount.privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    new TextEncoder().encode(headerPayload)
  );
  const signature = base64UrlEncode(signatureBuffer);

  return `${headerPayload}.${signature}`;
}

async function getAccessToken(serviceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 30000) {
    return cachedAccessToken.token;
  }

  const assertion = await createServiceAccountJwt(serviceAccount);
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok) {
    throw new Error(`Не удалось получить токен сервисного аккаунта: ${response.status}`);
  }

  const data = await response.json();
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  return cachedAccessToken.token;
}

function persistResultInBackground(hash, data) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "persistResult",
        hash,
        data,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { success: false, error: "Неизвестный ответ сервис-воркера" });
      }
    );
  });
}

function persistTranslationInBackground(hash, translations) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "persistTranslation",
        hash,
        translations,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { success: false, error: "Неизвестный ответ сервис-воркера" });
      }
    );
  });
}
