const MANUAL_API_KEY = typeof globalThis !== "undefined" ? globalThis.VISION_API_KEY || "" : "";
const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "transhot/recognize") return;

    handleRecognition(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Transhot: recognition failed", error);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  });
}

async function handleRecognition(message) {
  const { imageBase64, mimeType } = message;
  const apiKey = await resolveApiKey();
  if (!apiKey) {
    throw new Error("Vision API key is not configured");
  }

  const hash = await calculateHash(imageBase64);
  const visionResult = await runVisionRequest(apiKey, imageBase64, mimeType);

  return { hash, vision: visionResult };
}

async function resolveApiKey() {
  if (MANUAL_API_KEY) return MANUAL_API_KEY;

  if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
    try {
      const stored = await chrome.storage.local.get("visionApiKey");
      if (stored?.visionApiKey) return stored.visionApiKey;
    } catch (error) {
      console.warn("Transhot: unable to read API key from storage", error);
    }
  }

  return "";
}

async function runVisionRequest(apiKey, imageBase64, mimeType) {
  const response = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "TEXT_DETECTION" }],
          imageContext: mimeType ? { mimeType } : undefined,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Vision API returned ${response.status}: ${errorText || response.statusText}`);
  }

  const body = await response.json();
  return body?.responses?.[0] ?? null;
}

async function calculateHash(base64String) {
  const binary = atob(base64String);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
