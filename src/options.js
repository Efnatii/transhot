const input = document.getElementById("vision-key");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

async function loadKey() {
  if (!chrome?.storage?.local?.get) return;
  const stored = await chrome.storage.local.get("visionApiKey");
  if (stored?.visionApiKey) {
    input.value = stored.visionApiKey;
  }
}

async function saveKey() {
  const key = input.value.trim();
  statusEl.textContent = "";
  saveButton.disabled = true;

  try {
    await chrome.storage.local.set({ visionApiKey: key });
    statusEl.textContent = "Saved";
    statusEl.className = "status success";
  } catch (error) {
    console.error("Unable to save Vision API key", error);
    statusEl.textContent = "Не удалось сохранить ключ";
    statusEl.className = "status error";
  } finally {
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", saveKey);

document.addEventListener("DOMContentLoaded", loadKey);
