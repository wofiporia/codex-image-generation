---
name: codex-image-generation
description: Generate and save images through the local Codex CLI hidden `codex responses` command using a raw Responses API payload with the `image_generation` tool. Use when the user asks Codex to directly call `gpt-image-2`, generate images through Codex/Codex auth, reproduce image generation with `codex responses`, create a batch/scripted image-generation workflow, or save generated images from an image_generation_call result.
---

# Codex Image Generation

## Quick Start

Use the bundled script for prompt-to-image work:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\generate_codex_image.ps1" -Prompt "<image prompt>" -OutputDir "<workspace>\generated-images"
```

The script:

- Builds a raw streaming Responses payload.
- Sets top-level `model` to `gpt-5.4` by default.
- Adds `tools[0] = { type: "image_generation", model: "gpt-image-2", ... }`.
- Forces `tool_choice = { type: "image_generation" }`.
- Sends the payload with `codex responses`.
- Saves the PNG/JPEG/WEBP result plus the payload and JSONL response.

## Workflow

1. Locate this skill directory and run `scripts/generate_codex_image.ps1`.
2. Prefer passing `-Prompt` non-interactively when the user already gave a prompt.
3. Use an output directory inside the current workspace unless the user asks for another location.
4. After generation, report the saved image path and include the payload/response paths if useful for debugging.

Example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\10296\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir "D:\coding\subagent\image2\generated-images"
```

## Important Details

- `gpt-image-2` belongs inside the `image_generation` tool, not the top-level `model`.
- `codex responses` expects valid JSON on stdin and requires `"stream": true`.
- On Windows, avoid piping text from PowerShell directly into `codex responses`; use the script's `cmd.exe /c "type payload.json | codex responses"` approach.
- Write payload JSON as UTF-8 without BOM. A BOM or empty stdin can cause `failed to parse Responses API JSON payload: expected value at line 1 column 1`.
- In Codex sandboxes, running `codex responses` may fail with `Access is denied`; rerun the same command with escalated permissions when needed.
- Do not print or expose auth tokens. The Codex CLI handles authentication from the user's local Codex config.

## Script Parameters

`scripts/generate_codex_image.ps1` supports:

- `-Prompt`: image prompt. If omitted, the script prompts interactively.
- `-OutputDir`: output folder. Defaults to `generated-images` under the current working directory.
- `-Model`: top-level Responses model, default `gpt-5.4`.
- `-ImageModel`: image tool model, default `gpt-image-2`.
- `-Size`: default `1024x1024`.
- `-Quality`: `auto`, `low`, `medium`, or `high`; default `auto`.
- `-Format`: `png`, `jpeg`, or `webp`; default `png`.
