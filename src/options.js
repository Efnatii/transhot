const fileInput = document.getElementById("creds-file");
const status = document.getElementById("status");
const selectedFileLabel = document.getElementById("selected-file");
let statusTimeout;
let currentPath = "";

const CREDENTIALS_STORAGE_KEY = "googleVisionCredsData";
const CREDENTIALS_PATH_KEY = "googleVisionCredsPath";

function normalizeFilePath(file) {
  if (!file) return "";

  const rawPath =
    file.path ||
    file.webkitRelativePath ||
    (fileInput.value ? fileInput.value.trim() : "") ||
    file.name;

  return (rawPath || "").trim();
}

function extractApiKey(json) {
  const apiKey = json.apiKey || json.key;
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("В JSON не найден apiKey или key");
  }
  return apiKey.trim();
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
  setSelectedFile(filePath || file.name);

  file
    .text()
    .then((text) => {
      const parsed = JSON.parse(text);
      const apiKey = extractApiKey(parsed);
      const safePath = filePath || file.name;
      chrome.storage.local.set(
        {
          [CREDENTIALS_PATH_KEY]: safePath,
          [CREDENTIALS_STORAGE_KEY]: { apiKey, fileName: deriveFileName(safePath, file.name) },
        },
        () => {
          showStatus("Файл распознан и ключ сохранён");
        }
      );
    })
    .catch((error) => {
      console.error("Не удалось прочитать файл с ключом Vision", error);
      showStatus("Ошибка чтения файла: проверьте JSON");
    });
}

function setSelectedFile(path) {
  currentPath = (path ?? "").trim();
  selectedFileLabel.dataset.fullPath = currentPath;
  selectedFileLabel.textContent = currentPath
    ? deriveFileName(currentPath)
    : "Файл не выбран";
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

document.addEventListener("DOMContentLoaded", () => {
  restorePath();
  fileInput.addEventListener("change", updatePathFromFile);
});
