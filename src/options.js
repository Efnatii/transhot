const fileInput = document.getElementById("creds-file");
const status = document.getElementById("status");
const selectedFileLabel = document.getElementById("selected-file");
let statusTimeout;
let currentPath = "";

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

  const filePath =
    file.path ||
    file.webkitRelativePath ||
    fileInput.value ||
    file.name;
  setSelectedFile(filePath);
  savePath("Путь подставлен и сохранён автоматически", filePath);
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
  chrome.storage.local.set({ googleVisionCredsPath: value }, () => {
    showStatus(message);
  });
}

function restorePath() {
  chrome.storage.local.get("googleVisionCredsPath", (result) => {
    if (result.googleVisionCredsPath) {
      setSelectedFile(result.googleVisionCredsPath);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  restorePath();
  fileInput.addEventListener("change", updatePathFromFile);
});
