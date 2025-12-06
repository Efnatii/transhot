import { ImageAnnotatorClient } from "@google-cloud/vision";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const CREDS_PATH = process.env.GOOGLE_CREDS_PATH;
const RESULTS_DIR = process.env.TRANSHOT_RESULTS_DIR;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new ImageAnnotatorClient({
  keyFilename: CREDS_PATH,
});

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

async function handleRecognition(message) {
  const { imageBase64, mimeType } = message;
  const buffer = Buffer.from(imageBase64, "base64");
  const hash = createHash("sha256").update(buffer).digest("hex");

  const [visionResult] = await client.textDetection({
    image: { content: buffer },
  });

  const folderPath = await ensureResultDirectory(hash);
  const outputPath = join(folderPath, "result.json");
  const payload = {
    mimeType,
    hash,
    createdAt: new Date().toISOString(),
    vision: visionResult,
  };

  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return { hash, outputPath };
}

async function ensureResultDirectory(hash) {
  const baseDir = RESULTS_DIR || join(__dirname, "..", "recognized");
  const folderPath = join(baseDir, hash);
  await mkdir(folderPath, { recursive: true });
  return folderPath;
}
