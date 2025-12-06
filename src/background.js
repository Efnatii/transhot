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
  return resolveApiKeyFromEnvFile();
}

async function resolveApiKeyFromEnvFile() {
  const credsPath = getCredsPath();
  if (!credsPath) return "";

  const fs = await import("fs/promises").catch(() => null);
  if (fs?.readFile) {
    const key = await tryReadCredsWithFs(fs, credsPath);
    if (key) return key;
  }

  if (typeof fetch !== "undefined") {
    const key = await tryReadCredsWithFetch(credsPath);
    if (key) return key;
  }

  console.warn("Transhot: GOOGLE_CREDS_PATH is set but no API key was found or file could not be read");
  return "";
}

function getCredsPath() {
  if (typeof process !== "undefined" && process?.env?.GOOGLE_CREDS_PATH) {
    return process.env.GOOGLE_CREDS_PATH;
  }

  if (typeof globalThis !== "undefined" && globalThis.GOOGLE_CREDS_PATH) {
    return globalThis.GOOGLE_CREDS_PATH;
  }

  return "";
}

async function tryReadCredsWithFs(fs, credsPath) {
  try {
    const content = await fs.readFile(credsPath, "utf8");
    return extractApiKey(content);
  } catch (error) {
    console.warn("Transhot: unable to read GOOGLE_CREDS_PATH with fs", error);
    return "";
  }
}

async function tryReadCredsWithFetch(credsPath) {
  try {
    const url = toFetchableUrl(credsPath);
    const response = await fetch(url);
    if (!response.ok) return "";

    const content = await response.text();
    return extractApiKey(content);
  } catch (error) {
    console.warn("Transhot: unable to fetch GOOGLE_CREDS_PATH", error);
    return "";
  }
}

function toFetchableUrl(credsPath) {
  if (/^(https?:|file:)/i.test(credsPath)) return credsPath;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(credsPath);
  }
  return credsPath;
}

function extractApiKey(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    return (parsed.apiKey || parsed.api_key || parsed.key || "").trim();
  } catch (error) {
    console.warn("Transhot: GOOGLE_CREDS_PATH content is not valid JSON", error);
    return "";
  }
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
