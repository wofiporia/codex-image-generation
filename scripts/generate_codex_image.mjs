#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const DEFAULTS = {
  outputDir: path.join(process.cwd(), "generated-images"),
  model: "gpt-5.5",
  imageModel: "gpt-image-2",
  size: "1024x1024",
  quality: "auto",
  format: "png",
  action: "auto",
};

const ALLOWED_QUALITIES = new Set(["auto", "low", "medium", "high"]);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const ALLOWED_ACTIONS = new Set(["auto", "generate", "edit"]);

function printHelp() {
  console.log(`Usage:
  node scripts/generate_codex_image.mjs [options]

Options:
  --prompt <text>              Image prompt. If omitted, prompts interactively.
  --output-dir <dir>           Output directory. Default: ./generated-images
  --model <name>               Top-level Responses model. Default: gpt-5.5
  --image-model <name>         Image tool model. Default: gpt-image-2
  --size <size>                Image size. Default: 1024x1024
  --quality <value>            auto, low, medium, or high. Default: auto
  --format <value>             png, jpeg, or webp. Default: png
  --action <value>             auto, generate, or edit. Default: auto
  --reference-image <value>    Local path, URL, data URL, or file-* ID. Repeatable.
  --debug-artifacts            Keep payload/response files after success.
  --dry-run                    Save payload without calling codex responses.
  -h, --help                   Show this help.
`);
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    prompt: undefined,
    outputDir: DEFAULTS.outputDir,
    model: DEFAULTS.model,
    imageModel: DEFAULTS.imageModel,
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
        index += 1;
        options.prompt = argv[index];
        break;
      case "--output-dir":
        index += 1;
        options.outputDir = argv[index];
        break;
      case "--model":
        index += 1;
        options.model = argv[index];
        break;
      case "--image-model":
        index += 1;
        options.imageModel = argv[index];
        break;
      case "--size":
        index += 1;
        options.size = argv[index];
        break;
      case "--quality":
        index += 1;
        options.quality = argv[index];
        break;
      case "--format":
        index += 1;
        options.format = argv[index];
        break;
      case "--action":
        index += 1;
        options.action = argv[index];
        break;
      case "--reference-image":
        index += 1;
        options.referenceImages.push(argv[index]);
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

    if (
      [
        "--prompt",
        "--output-dir",
        "--model",
        "--image-model",
        "--size",
        "--quality",
        "--format",
        "--action",
        "--reference-image",
      ].includes(argument) &&
      typeof argv[index] === "undefined"
    ) {
      fail(`Missing value for ${argument}`);
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

async function promptForInput(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail("Prompt cannot be empty. Pass --prompt when running non-interactively.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await new Promise((resolve) => {
      rl.question(question, resolve);
    });
    return answer;
  } finally {
    rl.close();
  }
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

function convertToInputImageContent(reference) {
  const trimmed = reference.trim();
  if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
    return {
      type: "input_image",
      image_url: trimmed,
    };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      type: "input_image",
      image_url: trimmed,
    };
  }
  if (/^file-[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      type: "input_image",
      file_id: trimmed,
    };
  }

  const resolvedPath = path.resolve(trimmed);
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    fail(`Reference image is not a file: ${trimmed}`);
  }

  const mimeType = getImageMimeType(resolvedPath);
  const imageBase64 = fs.readFileSync(resolvedPath).toString("base64");
  return {
    type: "input_image",
    image_url: `data:${mimeType};base64,${imageBase64}`,
  };
}

function buildTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseImageFromResponse(responseText) {
  let imageBase64 = null;
  let revisedPrompt = null;

  for (const line of responseText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
      if (event.item.revised_prompt) {
        revisedPrompt = event.item.revised_prompt;
      }
      if (event.item.result) {
        imageBase64 = event.item.result;
      }
    }
  }

  if (!imageBase64) {
    fail("No image_generation_call.result found in the response.");
  }

  return {
    imageBase64: imageBase64.replace(/\s+/g, ""),
    revisedPrompt,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  validateOptions(options);

  let promptText = options.prompt;
  if (typeof promptText === "undefined") {
    promptText = await promptForInput("Enter image prompt: ");
  }
  if (!promptText || !promptText.trim()) {
    fail("Prompt cannot be empty.");
  }

  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const stamp = buildTimestamp(new Date());
  const payloadPath = path.join(outputDir, `payload-${stamp}.json`);
  const responsePath = path.join(outputDir, `response-${stamp}.jsonl`);
  const imagePath = path.join(outputDir, `image-${stamp}.${options.format}`);

  const messageContent = [
    {
      type: "input_text",
      text: promptText,
    },
    ...options.referenceImages.map(convertToInputImageContent),
  ];

  const payload = {
    model: options.model,
    instructions: "",
    input: [
      {
        type: "message",
        role: "user",
        content: messageContent,
      },
    ],
    tools: [
      {
        type: "image_generation",
        model: options.imageModel,
        action: options.action,
        size: options.size,
        quality: options.quality,
        output_format: options.format,
      },
    ],
    tool_choice: {
      type: "image_generation",
    },
    parallel_tool_calls: true,
    reasoning: {
      effort: "high",
    },
    store: false,
    stream: true,
    text: {
      verbosity: "low",
    },
  };

  const payloadJson = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(payloadPath, payloadJson, "utf8");

  if (options.dryRun) {
    console.log(`Dry run enabled. Payload saved: ${payloadPath}`);
    if (options.referenceImages.length > 0) {
      console.log(`Reference images included: ${options.referenceImages.length}`);
    }
    return;
  }

  console.log("Sending request through: codex responses");
  const env = { ...process.env };
  if (!env.TERM || env.TERM === "dumb") {
    env.TERM = "xterm-256color";
  }

  const result = spawnSync("codex", ["responses"], {
    input: payloadJson,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  fs.writeFileSync(responsePath, result.stdout ?? "", "utf8");

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    const stderrSuffix = result.stderr?.trim() ? ` Stderr: ${result.stderr.trim()}` : "";
    fail(`codex responses failed with exit code ${exitCode}. Response saved to: ${responsePath}.${stderrSuffix}`);
  }

  const { imageBase64, revisedPrompt } = parseImageFromResponse(result.stdout ?? "");
  fs.writeFileSync(imagePath, Buffer.from(imageBase64, "base64"));

  console.log("");
  console.log(`Image saved: ${imagePath}`);

  if (options.debugArtifacts) {
    console.log(`Payload saved: ${payloadPath}`);
    console.log(`Response saved: ${responsePath}`);
  } else {
    fs.rmSync(payloadPath, { force: true });
    fs.rmSync(responsePath, { force: true });
  }

  if (revisedPrompt) {
    console.log("");
    console.log("Revised prompt:");
    console.log(revisedPrompt);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
