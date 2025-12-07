const OVERLAY_ID = "transhot-hover-overlay";
const ACTION_TRANSLATE = "translate";

let overlay;
let hideTimer;
let currentTarget;
let isProcessing = false;
const targetCache = new WeakMap();
let processedHashes = new Set();
let cachedAccessToken;

chrome.storage.local.get("transhotProcessedHashes", (result) => {
  if (Array.isArray(result.transhotProcessedHashes)) {
    processedHashes = new Set(result.transhotProcessedHashes);
  }
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

function onOverlayClick(event) {
  const button = event.target.closest(".transhot-action");
  if (!button) return;

  const action = button.dataset.action;
  if (action === ACTION_TRANSLATE) {
    startTranslation();
  }
}

function handleMouseOver(event) {
  const target = event.target.closest("img, video");
  if (!target) return;

  beginOverlayForTarget(target);
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

async function beginOverlayForTarget(target) {
  currentTarget = target;
  const overlayElement = ensureOverlay();
  if (!overlayFitsTarget(overlayElement, target)) {
    overlayElement.classList.remove("visible");
    currentTarget = undefined;
    return;
  }

  try {
    const snapshot = await captureTargetSnapshot(target);
    if (processedHashes.has(snapshot.hash)) {
      overlayElement.classList.remove("visible");
      currentTarget = undefined;
      return;
    }
    positionOverlay(overlayElement, target);
    showOverlay(overlayElement);
  } catch (error) {
    console.warn("Не удалось подготовить оверлей", error);
  }
}

async function captureTargetSnapshot(target) {
  const cached = targetCache.get(target);
  if (cached) return cached;

  const blob = await extractBlobFromTarget(target);
  const arrayBuffer = await blob.arrayBuffer();
  const hash = await digestBuffer(arrayBuffer);
  const base64 = bufferToBase64(arrayBuffer);
  const snapshot = { hash, base64 };
  targetCache.set(target, snapshot);
  return snapshot;
}

async function extractBlobFromTarget(target) {
  if (target instanceof HTMLImageElement) {
    const src = target.currentSrc || target.src;
    const response = await fetch(src, { mode: "cors" });
    return response.blob();
  }

  if (target instanceof HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = target.videoWidth;
    canvas.height = target.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(target, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Не удалось сохранить кадр видео"));
        }
      }, "image/png");
    });
  }

  throw new Error("Неподдерживаемый тип элемента для перевода");
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

async function startTranslation() {
  if (isProcessing || !currentTarget) return;
  isProcessing = true;
  setLoadingState(true);

  try {
    const snapshot = await captureTargetSnapshot(currentTarget);
    if (processedHashes.has(snapshot.hash)) {
      hideOverlayForProcessed();
      return;
    }

    const credentials = await loadVisionCredentials();
    const visionResponse = await sendToVision(snapshot.base64, credentials);
    await persistResult(snapshot.hash, visionResponse);
    markHashProcessed(snapshot.hash);
    hideOverlayForProcessed();
  } catch (error) {
    console.error("Ошибка перевода", error);
    setLoadingState(false);
  } finally {
    isProcessing = false;
  }
}

function setLoadingState(loading) {
  const overlayElement = ensureOverlay();
  const loader = overlayElement.querySelector(".transhot-loader");
  if (loading) {
    overlayElement.classList.add("loading");
    loader?.classList.remove("hidden");
  } else {
    overlayElement.classList.remove("loading");
    loader?.classList.add("hidden");
  }
}

function hideOverlayForProcessed() {
  const overlayElement = ensureOverlay();
  overlayElement.classList.remove("visible");
  setLoadingState(false);
  currentTarget = undefined;
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
    throw new Error(`Ответ Vision: ${response.status}`);
  }

  return response.json();
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
    scope: "https://www.googleapis.com/auth/cloud-vision",
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

async function persistResult(hash, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: `transhot/${hash}/vision-result.json`,
        saveAs: false,
        conflictAction: "overwrite",
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(downloadId);
        }
        URL.revokeObjectURL(url);
      }
    );
  });
}
