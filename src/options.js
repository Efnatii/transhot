const pathInput = document.getElementById("creds-path");
const fileInput = document.getElementById("creds-file");
const saveButton = document.getElementById("save-button");
const status = document.getElementById("status");

function showStatus(message) {
  status.textContent = message;
  status.classList.add("visible");
  setTimeout(() => status.classList.remove("visible"), 1600);
}

function updatePathFromFile() {
  const file = fileInput.files?.[0];
  if (!file) return;

  const filePath = file.path || file.webkitRelativePath || file.name;
  pathInput.value = filePath;
  showStatus("Путь подставлен из выбранного файла");
}

function savePath() {
  const value = pathInput.value.trim();
  chrome.storage.local.set({ googleVisionCredsPath: value }, () => {
    showStatus("Сохранено");
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
  saveButton.addEventListener("click", savePath);
});
