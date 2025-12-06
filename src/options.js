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

function updatePathFromFile() {
  const file = fileInput.files?.[0];
  if (!file) return;

  const filePath =
    file.path ||
    file.webkitRelativePath ||
    fileInput.value ||
    file.name;
  pathInput.value = filePath;
  savePath("Путь подставлен и сохранён автоматически");
}

function savePath(message = "Путь сохранён автоматически") {
  const value = pathInput.value.trim();
  chrome.storage.local.set({ googleVisionCredsPath: value }, () => {
    showStatus(message);
  });
}

function restorePath() {
  chrome.storage.local.get("googleVisionCredsPath", (result) => {
    if (result.googleVisionCredsPath) {
      pathInput.value = result.googleVisionCredsPath;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  restorePath();
  fileInput.addEventListener("change", updatePathFromFile);
  pathInput.addEventListener("input", () => savePath());
});
