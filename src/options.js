const pathInput = document.getElementById("creds-path");
const fileInput = document.getElementById("creds-file");
const status = document.getElementById("status");
let statusTimeout;

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
  const fileName = deriveFileName(filePath, file.name);

  pathInput.dataset.fullPath = filePath;
  pathInput.value = fileName;
  savePath("Путь подставлен и сохранён автоматически", filePath, file);
}

function savePath(message = "Путь сохранён автоматически", storedValue, file) {
  const value = (storedValue ?? pathInput.dataset.fullPath ?? pathInput.value).trim();
  pathInput.dataset.fullPath = value;
  chrome.storage.local.set({ googleVisionCredsPath: value }, () => {
    showStatus(message);
    if (file) {
      file
        .text()
        .then((text) => {
          console.log("Содержимое файла:", text);
        })
        .catch((error) => console.error("Не удалось прочитать файл:", error));
    }
  });
}

function restorePath() {
  chrome.storage.local.get("googleVisionCredsPath", (result) => {
    if (result.googleVisionCredsPath) {
      pathInput.dataset.fullPath = result.googleVisionCredsPath;
      pathInput.value = deriveFileName(result.googleVisionCredsPath);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  restorePath();
  fileInput.addEventListener("change", updatePathFromFile);
  pathInput.addEventListener("input", () => {
    pathInput.dataset.fullPath = pathInput.value;
    savePath();
  });
});
