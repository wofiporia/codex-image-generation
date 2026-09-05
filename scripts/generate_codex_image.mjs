#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(SCRIPT_DIR, "..", "config.json");

const DEFAULTS = {
  outputDir: path.join(process.cwd(), "generated-images"),
  configPath: DEFAULT_CONFIG_PATH,
  model: "gpt-image-2",
  size: "1024x1024",
  quality: "auto",
  format: "png",
  action: "auto",
};

const ALLOWED_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const ALLOWED_ACTIONS = new Set(["auto", "generate", "edit"]);
const OPTION_NAMES = new Set([
  "-h",
  "--help",
  "--prompt",
  "--config",
  "--output-dir",
  "--model",
  "--size",
  "--quality",
  "--format",
  "--action",
  "--reference-image",
  "--debug-artifacts",
  "--dry-run",
]);

function printHelp() {
  console.log(`Usage:
  node scripts/generate_codex_image.mjs [options]

Options:
  --prompt <text>              Image prompt. If omitted, prompts interactively.
  --config <path>              Config JSON. Default: <skill-dir>/config.json
  --output-dir <dir>           Output directory. Default: ./generated-images
  --model <name>               Image model. Default: gpt-image-2
  --size <size>                Image size. Default: 1024x1024
  --quality <value>            auto, low, medium, or high. Default: auto
  --format <value>             png, jpeg, or webp. Default: png
  --action <value>             auto, generate, or edit. Default: auto
  --reference-image <value>    Local path, URL, or data URL. Repeatable.
  --debug-artifacts            Keep request/response files after success.
  --dry-run                    Save request metadata without calling the API.
  -h, --help                   Show this help.
`);
}

function fail(message) {
  throw new Error(message);
}

function requireValue(argv, index, argument) {
  const value = argv[index + 1];
  if (typeof value === "undefined" || OPTION_NAMES.has(value)) {
    fail(`Missing value for ${argument}`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    prompt: undefined,
    configPath: DEFAULTS.configPath,
    outputDir: DEFAULTS.outputDir,
    model: DEFAULTS.model,
    size: DEFAULTS.size,
    quality: DEFAULTS.quality,
    format: DEFAULTS.format,
    action: DEFAULTS.action,
    referenceImages: [],
    debugArtifacts: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--prompt":
        options.prompt = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--config":
        options.configPath = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--model":
        options.model = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--size":
        options.size = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--quality":
        options.quality = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--format":
        options.format = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--action":
        options.action = requireValue(argv, index, argument);
        index += 1;
        break;
      case "--reference-image":
        options.referenceImages.push(requireValue(argv, index, argument));
        index += 1;
        break;
      case "--debug-artifacts":
        options.debugArtifacts = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        fail(`Unknown argument: ${argument}`);
    }
  }

  options.quality = options.quality.toLowerCase();
  options.format = options.format.toLowerCase();
  options.action = options.action.toLowerCase();
  options.referenceImages = options.referenceImages.filter((value) => value && value.trim());
  return options;
}

function validateOptions(options) {
  if (!ALLOWED_QUALITIES.has(options.quality)) {
    fail(`Invalid quality: ${options.quality}`);
  }
  if (!ALLOWED_FORMATS.has(options.format)) {
    fail(`Invalid format: ${options.format}`);
  }
  if (!ALLOWED_ACTIONS.has(options.action)) {
    fail(`Invalid action: ${options.action}`);
  }
  if (options.action === "generate" && options.referenceImages.length > 0) {
    fail("Action 'generate' cannot use reference images. Use --action auto or --action edit.");
  }
  if (options.action === "edit" && options.referenceImages.length === 0) {
    fail("Action 'edit' requires at least one --reference-image.");
  }
}

function loadConfig(configPath) {
  const resolvedPath = path.resolve(configPath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`Missing config file: ${resolvedPath}. Copy config.example.json to config.json and fill in base_url and key.`);
  }

  let config;
  try {
    const configText = fs.readFileSync(resolvedPath, "utf8").replace(/^\uFEFF/, "");
    config = JSON.parse(configText);
  } catch (error) {
    fail(`Cannot parse config file ${resolvedPath}: ${error.message}`);
  }

  const baseUrl = typeof config?.base_url === "string" ? config.base_url.trim().replace(/\/+$/, "") : "";
  const key = typeof config?.key === "string" ? config.key.trim() : "";
  if (!baseUrl) {
    fail(`Config field 'base_url' is required in ${resolvedPath}.`);
  }
  if (!key) {
    fail(`Config field 'key' is required in ${resolvedPath}.`);
  }

  try {
    const parsedUrl = new URL(baseUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      fail("Config field 'base_url' must use http or https.");
    }
  } catch {
    fail(`Config field 'base_url' is not a valid URL: ${baseUrl}`);
  }

  return { baseUrl, key };
}

function getImageMimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      fail(`Unsupported reference image extension: ${filePath}. Use jpg, jpeg, png, webp, or gif.`);
  }
}

function getExtensionForMimeType(mimeType) {
  const normalized = mimeType.toLowerCase().split(";")[0];
  switch (normalized) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

function getEndpoint(baseUrl, route) {
  const endpointSuffix = `/images/${route}`;
  const endpointMatch = /\/images\/(generations|edits)$/i.exec(baseUrl);
  if (endpointMatch) {
    return `${baseUrl.slice(0, endpointMatch.index)}${endpointSuffix}`;
  }
  return `${baseUrl}${endpointSuffix}`;
}

function getRemoteFileName(urlValue, mimeType, index) {
  try {
    const pathname = new URL(urlValue).pathname;
    const candidate = path.basename(pathname);
    if (candidate && path.extname(candidate)) {
      return candidate;
    }
  } catch {
    return `reference-${index + 1}${getExtensionForMimeType(mimeType)}`;
  }
  return `reference-${index + 1}${getExtensionForMimeType(mimeType)}`;
}

function parseDataUrl(value) {
  const match = /^data:(image\/[^;]+);base64,(.*)$/is.exec(value);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return {
    bytes,
    mimeType,
    fileName: `reference${getExtensionForMimeType(mimeType)}`,
  };
}

async function readReferenceImage(reference, index) {
  const trimmed = reference.trim();
  const dataUrl = parseDataUrl(trimmed);
  if (dataUrl) {
    return { ...dataUrl, fileName: `reference-${index + 1}${path.extname(dataUrl.fileName)}` };
  }
  if (/^file-[A-Za-z0-9_-]+$/.test(trimmed)) {
    fail(`Reference image file IDs are not supported by the direct Images API: ${trimmed}`);
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      fail(`Failed to download reference image (${response.status} ${response.statusText}).`);
    }
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!mimeType.toLowerCase().startsWith("image/")) {
      fail(`Reference URL did not return an image: ${trimmed}`);
    }
    return {
      bytes,
      mimeType,
      fileName: getRemoteFileName(trimmed, mimeType, index),
    };
  }

  const resolvedPath = path.resolve(trimmed);
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    fail(`Reference image does not exist: ${trimmed}`);
  }
  if (!stat.isFile()) {
    fail(`Reference image is not a file: ${trimmed}`);
  }
  return {
    bytes: fs.readFileSync(resolvedPath),
    mimeType: getImageMimeType(resolvedPath),
    fileName: path.basename(resolvedPath),
  };
}

async function promptForInput(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail("Prompt cannot be empty. Pass --prompt when running non-interactively.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

function buildTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function createRequestMetadata(options, promptText, endpoint, action) {
  return {
    endpoint,
    model: options.model,
    prompt: promptText,
    n: 1,
    size: options.size,
    quality: options.quality,
    output_format: options.format,
    action,
    reference_images: options.referenceImages,
  };
}

function formatApiError(response, responseText, key) {
  let detail = responseText.trim();
  try {
    const parsed = JSON.parse(detail);
    detail = parsed.error?.message || parsed.message || detail;
  } catch {
    detail = detail.slice(0, 4000);
  }
  if (key) {
    detail = detail.split(key).join("[redacted]");
  }
  return `Image API request failed with ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ""}`;
}

function isImageContentType(contentType) {
  return contentType.toLowerCase().startsWith("image/");
}

function isSameOrigin(firstUrl, secondUrl) {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

async function downloadGeneratedImage(urlValue, key, baseUrl) {
  const headers = isSameOrigin(urlValue, baseUrl)
    ? { Authorization: `Bearer ${key}` }
    : undefined;
  const response = await fetch(urlValue, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok && !isImageContentType(contentType)) {
    fail(`Failed to download generated image (${response.status} ${response.statusText}).`);
  }
  if (!isImageContentType(contentType)) {
    fail("Generated image URL did not return an image.");
  }
  return bytes;
}

async function sendJsonRequest(endpoint, key, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  return {
    response,
    responseBytes,
    responseText: new TextDecoder().decode(responseBytes),
  };
}

async function sendEditRequest(endpoint, key, options, promptText, referenceFiles) {
  const form = new FormData();
  form.append("model", options.model);
  form.append("prompt", promptText);
  form.append("n", "1");
  form.append("size", options.size);
  form.append("quality", options.quality);
  form.append("output_format", options.format);
  referenceFiles.forEach((reference) => {
    form.append("image", new Blob([reference.bytes], { type: reference.mimeType }), reference.fileName);
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });
  const responseBytes = Buffer.from(await response.arrayBuffer());
  return {
    response,
    responseBytes,
    responseText: new TextDecoder().decode(responseBytes),
  };
}

function decodeBase64(value) {
  const normalized = value.replace(/^data:image\/[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!normalized) {
    fail("Image API returned an empty base64 image.");
  }
  return Buffer.from(normalized, "base64");
}

async function extractImageBytes(response, responseBytes, responseText, config) {
  const contentType = response.headers.get("content-type") || "";
  if (isImageContentType(contentType)) {
    return responseBytes;
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    fail("Image API returned a response that is neither JSON nor an image.");
  }

  const item = Array.isArray(parsed.data) ? parsed.data[0] : null;
  if (item?.b64_json) {
    return decodeBase64(item.b64_json);
  }
  if (item?.url) {
    return downloadGeneratedImage(item.url, config.key, config.baseUrl);
  }
  fail("Image API response did not contain data[0].b64_json or data[0].url.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  validateOptions(options);
  const config = loadConfig(options.configPath);
  const promptText = typeof options.prompt === "undefined"
    ? await promptForInput("Enter image prompt: ")
    : options.prompt;
  if (!promptText || !promptText.trim()) {
    fail("Prompt cannot be empty.");
  }

  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const action = options.action === "auto"
    ? (options.referenceImages.length > 0 ? "edit" : "generate")
    : options.action;
  const endpoint = getEndpoint(config.baseUrl, action === "edit" ? "edits" : "generations");
  const stamp = buildTimestamp(new Date());
  const payloadPath = path.join(outputDir, `payload-${stamp}.json`);
  const responsePath = path.join(outputDir, `response-${stamp}.json`);
  const imagePath = path.join(outputDir, `image-${stamp}.${options.format}`);
  const requestMetadata = createRequestMetadata(options, promptText, endpoint, action);
  const payloadJson = `${JSON.stringify(requestMetadata, null, 2)}\n`;
  fs.writeFileSync(payloadPath, payloadJson, "utf8");

  if (options.dryRun) {
    console.log(`Dry run enabled. Request metadata saved: ${payloadPath}`);
    if (options.referenceImages.length > 0) {
      console.log(`Reference images included: ${options.referenceImages.length}`);
    }
    return;
  }

  let requestResult;
  try {
    if (action === "edit") {
      const referenceFiles = await Promise.all(options.referenceImages.map(readReferenceImage));
      requestResult = await sendEditRequest(endpoint, config.key, options, promptText, referenceFiles);
    } else {
      requestResult = await sendJsonRequest(endpoint, config.key, {
        model: options.model,
        prompt: promptText,
        n: 1,
        size: options.size,
        quality: options.quality,
        output_format: options.format,
      });
    }

    fs.writeFileSync(responsePath, requestResult.responseText, "utf8");
    const contentType = requestResult.response.headers.get("content-type") || "";
    if (!requestResult.response.ok && !isImageContentType(contentType)) {
      fail(formatApiError(requestResult.response, requestResult.responseText, config.key));
    }

    const imageBytes = await extractImageBytes(
      requestResult.response,
      requestResult.responseBytes,
      requestResult.responseText,
      config,
    );
    fs.writeFileSync(imagePath, imageBytes);
  } catch (error) {
    if (requestResult && !fs.existsSync(responsePath)) {
      fs.writeFileSync(responsePath, requestResult.responseText || "", "utf8");
    }
    throw error;
  }

  console.log("");
  console.log(`Image saved: ${imagePath}`);
  if (options.debugArtifacts) {
    console.log(`Request metadata saved: ${payloadPath}`);
    console.log(`Response saved: ${responsePath}`);
  } else {
    fs.rmSync(payloadPath, { force: true });
    fs.rmSync(responsePath, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
