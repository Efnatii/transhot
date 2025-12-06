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
  const auth = await resolveVisionAuth();
  if (!auth) {
    throw new Error("Vision API key is not configured");
  }

  const hash = await calculateHash(imageBase64);
  const visionResult = await runVisionRequest(auth, imageBase64, mimeType);

  return { hash, vision: visionResult };
}

async function resolveVisionAuth() {
  const creds = await resolveCredsFromEnvFile();
  if (!creds) return null;

  if (creds.kind === "apiKey") return creds;

  const token = await getServiceAccountToken(creds).catch((error) => {
    console.warn("Transhot: failed to exchange service account credentials", error);
    return "";
  });

  return token ? { kind: "accessToken", token } : null;
}

async function resolveCredsFromEnvFile() {
  const credsPath = getCredsPath();
  if (!credsPath) return null;

  const fs = await import("fs/promises").catch(() => null);
  if (fs?.readFile) {
    const creds = await tryReadCredsWithFs(fs, credsPath);
    if (creds) return creds;
  }

  if (typeof fetch !== "undefined") {
    const creds = await tryReadCredsWithFetch(credsPath);
    if (creds) return creds;
  }

  console.warn("Transhot: GOOGLE_CREDS_PATH is set but no API key was found or file could not be read");
  return null;
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
    return extractCreds(content);
  } catch (error) {
    console.warn("Transhot: unable to read GOOGLE_CREDS_PATH with fs", error);
    return null;
  }
}

async function tryReadCredsWithFetch(credsPath) {
  try {
    const url = toFetchableUrl(credsPath);
    const response = await fetch(url);
    if (!response.ok) return null;

    const content = await response.text();
    return extractCreds(content);
  } catch (error) {
    console.warn("Transhot: unable to fetch GOOGLE_CREDS_PATH", error);
    return null;
  }
}

function toFetchableUrl(credsPath) {
  if (/^(https?:|file:)/i.test(credsPath)) return credsPath;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(credsPath);
  }
  return credsPath;
}

function extractCreds(jsonContent) {
  try {
    const parsed = JSON.parse(jsonContent);
    const apiKey = (parsed.apiKey || parsed.api_key || parsed.key || "").trim();
    if (apiKey) return { kind: "apiKey", apiKey };

    if (isServiceAccount(parsed)) {
      return {
        kind: "serviceAccount",
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
        tokenUri: parsed.token_uri,
      };
    }

    return null;
  } catch (error) {
    console.warn("Transhot: GOOGLE_CREDS_PATH content is not valid JSON", error);
    return null;
  }
}

function isServiceAccount(parsed) {
  return (
    parsed?.type === "service_account" &&
    typeof parsed.private_key === "string" && parsed.private_key &&
    typeof parsed.client_email === "string" && parsed.client_email
  );
}

async function getServiceAccountToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: creds.clientEmail,
    sub: creds.clientEmail,
    aud: creds.tokenUri || "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/cloud-vision",
    iat: now,
    exp: now + 3600,
  };

  const jwt = await signJwt(header, claimSet, creds.privateKey);

  const response = await fetch(claimSet.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Service account token request failed: ${response.status} ${errorText || response.statusText}`);
  }

  const body = await response.json();
  return body?.access_token || "";
}

async function signJwt(header, payload, privateKeyPem) {
  const encoder = new TextEncoder();
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const keyData = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const signature = base64UrlEncodeFromBuffer(signatureBuffer);
  return `${unsigned}.${signature}`;
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(jsonString) {
  const base64 = btoa(jsonString)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return base64;
}

function base64UrlEncodeFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function runVisionRequest(auth, imageBase64, mimeType) {
  const headers = { "Content-Type": "application/json" };
  let url = VISION_ENDPOINT;

  if (auth.kind === "apiKey") {
    url = `${url}?key=${encodeURIComponent(auth.apiKey)}`;
  }

  if (auth.kind === "accessToken") {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
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
