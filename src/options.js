const fileInput = document.getElementById("creds-file");
const status = document.getElementById("status");
const selectedFileLabel = document.getElementById("selected-file");
const debugToggle = document.getElementById("debug-toggle");
let statusTimeout;
let currentPath = "";

const CREDENTIALS_STORAGE_KEY = "googleVisionCredsData";
const CREDENTIALS_PATH_KEY = "googleVisionCredsPath";
const DEBUG_MODE_KEY = "transhotDebugMode";

function normalizeFilePath(file) {
  if (!file) return "";

  const rawPath =
    file.path ||
    file.webkitRelativePath ||
    (fileInput.value ? fileInput.value.trim() : "") ||
    file.name;

  return (rawPath || "").trim();
}

function extractCredentials(json) {
  const apiKey = json.apiKey || json.key;
  if (apiKey && typeof apiKey === "string") {
    return { type: "apiKey", apiKey: apiKey.trim() };
  }

  const privateKey = json.private_key;
  const clientEmail = json.client_email;
  if (privateKey && clientEmail && typeof privateKey === "string" && typeof clientEmail === "string") {
    return { type: "serviceAccount", serviceAccount: { privateKey, clientEmail } };
  }

  throw new Error("В JSON нет apiKey/key или service account полей");
}

function showStatus(message) {
  status.textContent = message;
  status.classList.add("visible");
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => status.classList.remove("visible"), 1600);
}

function deriveFileName(path, fallbackName) {
  if (fallbackName) return fallbackName;
  if (!path) return "";

  const pathParts = path.split(/[/\\]/);
  const name = pathParts.pop();
  return name || path;
}

function updatePathFromFile() {
  const file = fileInput.files?.[0];
  if (!file) return;

  const filePath = normalizeFilePath(file);

  const previousPath = selectedFileLabel.dataset.fullPath || currentPath;
  const safePath = filePath || file.name;
  setSelectedFile(safePath);

  file
    .text()
    .then((text) => {
      const parsed = JSON.parse(text);
      const creds = extractCredentials(parsed);
      chrome.storage.local.set(
        {
          [CREDENTIALS_PATH_KEY]: safePath,
          [CREDENTIALS_STORAGE_KEY]: { ...creds, fileName: deriveFileName(safePath, file.name) },
        },
        () => {
          showStatus(
            creds.type === "apiKey"
              ? "Файл распознан и API-ключ сохранён"
              : "Файл распознан, сервисный аккаунт сохранён"
          );
        }
      );
    })
    .catch((error) => {
      console.error("Не удалось прочитать файл с ключом Vision", error);
      showStatus("Ошибка чтения файла: проверьте JSON");
      setSelectedFile(previousPath);
    });
}

function setSelectedFile(path) {
  currentPath = (path ?? "").trim();
  selectedFileLabel.dataset.fullPath = currentPath;
  selectedFileLabel.textContent = currentPath || "Файл не выбран";
}

function savePath(message = "Путь сохранён автоматически", storedValue) {
  const value = (storedValue ?? selectedFileLabel.dataset.fullPath ?? currentPath).trim();
  setSelectedFile(value);
  chrome.storage.local.set({ [CREDENTIALS_PATH_KEY]: value }, () => {
    showStatus(message);
  });
}

function restorePath() {
  chrome.storage.local.get([CREDENTIALS_PATH_KEY, CREDENTIALS_STORAGE_KEY], (result) => {
    const savedPath = result[CREDENTIALS_PATH_KEY];
    if (savedPath) {
      setSelectedFile(savedPath);
      return;
    }

    const savedName = result[CREDENTIALS_STORAGE_KEY]?.fileName;
    if (savedName) {
      setSelectedFile(savedName);
    }
  });
}

function saveDebugMode(event) {
  const isEnabled = Boolean(event?.target?.checked ?? debugToggle?.checked);
  chrome.storage.local.set({ [DEBUG_MODE_KEY]: isEnabled }, () => {
    showStatus(isEnabled ? "Дебаг-режим включён" : "Дебаг-режим выключен");
  });
}

function restoreDebugMode() {
  chrome.storage.local.get(DEBUG_MODE_KEY, (result) => {
    const saved = Boolean(result[DEBUG_MODE_KEY]);
    if (debugToggle) {
      debugToggle.checked = saved;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  restorePath();
  restoreDebugMode();
  fileInput.addEventListener("change", updatePathFromFile);
  debugToggle?.addEventListener("change", saveDebugMode);
});
