const OVERLAY_ID = "transhot-hover-overlay";
const ACTION_TRANSLATE = "translate";

let overlay;
let hideTimer;
let currentTarget;

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "transhot-overlay";
  overlay.innerHTML = `
    <button class="transhot-action transhot-icon-button" data-action="${ACTION_TRANSLATE}" aria-label="Перевести">
      <span class="spinner" aria-hidden="true"></span>
      <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-default">
        <path d="M4 4h8v3H9.83a9.7 9.7 0 0 0 1.39 2.22 16 16 0 0 0 2.48-3.72h3.05c-.8 1.66-1.8 3.2-2.95 4.6l2.82 2.58-1.77 1.6-3.1-3c-.9.76-1.88 1.46-2.96 2.1L6 11.86c.82-.35 1.58-.76 2.3-1.23A9 9 0 0 1 6.7 8.05H5Z" />
        <path d="M15.5 10.5h3.1L22 20h-2.4l-.6-1.75h-2.9L15.5 20h-2.4l2.74-7.35a.9.9 0 0 1 .86-.6Zm.3 5.1h2.02l-.64-1.9h-.72z" />
        <path d="M6.5 16.5h4V19h-4z" />
      </svg>
      <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-success" focusable="false">
        <path d="M20.2 6.5 9.8 17.2 4.3 11.7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <span class="progress-bar"></span>
      <svg class="check" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 6.5 9.8 17.2 4.3 11.7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    </button>
  `;

  overlay.addEventListener("mouseenter", clearHideTimer);
  overlay.addEventListener("mouseleave", scheduleHide);
  overlay.addEventListener("click", onOverlayClick);

  document.documentElement.appendChild(overlay);
  return overlay;
}

async function onOverlayClick(event) {
  const button = event.target.closest(".transhot-action");
  if (!button || button.dataset.loading === "true") return;

  const action = button.dataset.action;
  if (action === ACTION_TRANSLATE) {
    if (!currentTarget) return;
    setButtonLoading(button, true);
    try {
      const result = await sendForRecognition(currentTarget);
      if (result?.ok) {
        markButtonComplete(button);
      } else {
        handleRecognitionError(result?.error);
        resetButtonState(button);
      }
    } catch (error) {
      handleRecognitionError(error?.message ?? error);
      resetButtonState(button);
    }
  }
}

let hasPromptedForApiKey = false;

function handleRecognitionError(message) {
  console.error("Transhot: vision error", message);

  if (typeof message !== "string") return;
  if (!message.includes("Vision API key is not configured")) return;
  if (hasPromptedForApiKey) return;

  hasPromptedForApiKey = true;

  const promptText =
    "Укажите ключ Google Vision в настройках Transhot, иначе распознавание не работает. Открыть страницу настроек сейчас?";

  if (window.confirm(promptText)) {
    if (typeof chrome !== "undefined" && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }
}

function markButtonComplete(button) {
  button.classList.add("is-complete");
  button.removeAttribute("aria-busy");
  button.dataset.loading = "false";
  window.setTimeout(() => {
    button.remove();
    overlay?.classList.remove("visible");
  }, 300);
}

function setButtonLoading(button, isLoading) {
  button.dataset.loading = isLoading ? "true" : "false";
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
  button.classList.toggle("is-loading", isLoading);
}

function resetButtonState(button) {
  button.dataset.loading = "false";
  button.removeAttribute("aria-busy");
  button.classList.remove("is-loading");
}

async function sendForRecognition(target) {
  const imageBytes = await extractImageBytes(target);
  if (!imageBytes) {
    return { ok: false, error: "Unable to read image bytes" };
  }

  const payload = {
    type: "transhot/recognize",
    imageBase64: arrayBufferToBase64(imageBytes),
    mimeType: getTargetMimeType(target),
  };

  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      console.warn("Transhot: chrome.runtime.sendMessage is unavailable");
      resolve({ ok: false, error: "Messaging unavailable" });
      return;
    }

    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function getTargetMimeType(target) {
  if (target instanceof HTMLImageElement && target.currentSrc) {
    const url = new URL(target.currentSrc);
    const extension = url.pathname.split(".").pop()?.toLowerCase();
    if (extension) {
      if (extension === "png") return "image/png";
      if (["jpg", "jpeg", "jfif"].includes(extension)) return "image/jpeg";
      if (extension === "webp") return "image/webp";
    }
  }
  if (target instanceof HTMLVideoElement) {
    return "image/png";
  }
  return "application/octet-stream";
}

async function extractImageBytes(target) {
  if (target instanceof HTMLImageElement) {
    const src = target.currentSrc || target.src;
    if (!src) return undefined;
    const response = await fetch(src, { mode: "cors" }).catch(() => undefined);
    if (!response?.ok) return undefined;
    return response.arrayBuffer();
  }

  if (target instanceof HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = target.videoWidth;
    canvas.height = target.videoHeight;
    if (!canvas.width || !canvas.height) return undefined;
    const context = canvas.getContext("2d");
    context?.drawImage(target, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    return blob?.arrayBuffer();
  }

  return undefined;
}

function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer)) return "";

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function handleMouseOver(event) {
  const target = event.target.closest("img, video");
  if (!target) return;

  currentTarget = target;
  const overlayElement = ensureOverlay();
  if (!overlayFitsTarget(overlayElement, target)) {
    overlayElement.classList.remove("visible");
    currentTarget = undefined;
    return;
  }
  positionOverlay(overlayElement, target);
  showOverlay(overlayElement);
}

function handleMouseOut(event) {
  if (!currentTarget) return;
  if (overlay && overlay.contains(event.relatedTarget)) return;

  const leavingSameTarget = event.target === currentTarget && event.relatedTarget === currentTarget;
  if (leavingSameTarget) return;

  const relatedImage = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest("img, video");
  if (relatedImage === currentTarget) return;

  scheduleHide();
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
  }, 140);
}

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = undefined;
  }
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
}

init();
