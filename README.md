# Codex Image Generation Skill

Generate images through the local Codex CLI by sending a raw streaming Responses payload to the hidden `codex responses` command. The image model is configured inside the `image_generation` tool and defaults to `gpt-image-2`.

The bundled entries support both text-to-image and reference-image generation. Reference images can be local files, HTTP(S) URLs, base64 data URLs, or OpenAI `file-*` IDs.

## What This Skill Contains

```text
codex-image-generation/
  SKILL.md
  agents/openai.yaml
  scripts/generate_codex_image.ps1
  scripts/generate_codex_image.mjs
```

This version keeps the original Windows/PowerShell entry and adds a separate macOS/Linux Node.js entry.

## Requirements

- Windows with PowerShell for `scripts/generate_codex_image.ps1`, or macOS/Linux with Node.js for `scripts/generate_codex_image.mjs`.
- Codex CLI `0.125.0` installed and available as `codex` on `PATH`.
- Codex CLI already logged in or configured with a provider that supports `codex responses`.

Recommended install or downgrade command:

```bash
npm install -g @openai/codex@0.125.0
```

## Install Location

Install this directory at one of these locations:

```text
Windows:
  C:\Users\<you>\.codex\skills\codex-image-generation

macOS/Linux:
  ~/.codex/skills/codex-image-generation
```

Example install on macOS/Linux from a local checkout:

```bash
mkdir -p "$HOME/.codex/skills"
cp -R ./codex-image-generation "$HOME/.codex/skills/codex-image-generation"
```

Restart Codex after installing or updating the skill so it can be discovered.

## Usage From Codex

Ask Codex to use the skill:

```text
Use $codex-image-generation to generate an image from this prompt: A cute cat astronaut, sticker style.
```

Codex should run the bundled script and report the saved image path.

For a reference image, ask Codex to include the image path or URL:

```text
Use $codex-image-generation to generate a polished anime portrait from this reference image: D:\images\character.png. Keep the pose and outfit, but improve lighting and detail.
```

## Direct Script Usage

From PowerShell on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir ".\generated-images"
```

Reference-image generation on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "Turn this reference into a polished anime portrait while preserving the pose and palette." -ReferenceImage ".\reference.png" -Action auto -Quality high -OutputDir ".\generated-images"
```

If `-Prompt` is omitted, the Windows script asks for it interactively:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1"
```

From `node` on macOS/Linux:

```bash
node "$HOME/.codex/skills/codex-image-generation/scripts/generate_codex_image.mjs" --prompt "A cute cat astronaut, sticker style" --output-dir "./generated-images"
```

Reference-image generation on macOS/Linux:

```bash
node "$HOME/.codex/skills/codex-image-generation/scripts/generate_codex_image.mjs" --prompt "Turn this reference into a polished anime portrait while preserving the pose and palette." --reference-image "./reference.png" --action auto --quality high --output-dir "./generated-images"
```

If `--prompt` is omitted, the macOS/Linux script asks for it interactively.

## Codex Version

This skill is written against Codex CLI `0.125.0`.

It depends on the hidden `codex responses` command path. Later Codex versions may keep the underlying Responses implementation but stop exposing a usable CLI entry for this workflow.

## Output

Successful runs write only the final image by default:

```text
image-YYYYMMDD-HHMMSS.png
```

Pass the debug-artifact flag to also keep the request and response files:

```text
payload-YYYYMMDD-HHMMSS.json
response-YYYYMMDD-HHMMSS.jsonl
```

The payload and response files are useful for debugging and reproducibility. Failed requests may leave these files in place so the failure can be inspected.

## Parameters

```text
Windows PowerShell:
  -Prompt, -OutputDir, -Model, -ImageModel, -Size, -Quality, -Format, -Action,
  -ReferenceImage, -DebugArtifacts, -DryRun

macOS/Linux Node.js:
  --prompt, --output-dir, --model, --image-model, --size, --quality, --format,
  --action, --reference-image, --debug-artifacts, --dry-run
```

## Payload Shape

For text-to-image, the script sends a payload shaped like:

```json
{
  "model": "gpt-5.5",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "A cute cat astronaut, sticker style"
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "action": "auto",
      "size": "1024x1024",
      "quality": "auto",
      "output_format": "png"
    }
  ],
  "tool_choice": {
    "type": "image_generation"
  },
  "stream": true
}
```

`gpt-image-2` is intentionally placed in the image tool, not the top-level `model`.

For reference-image generation, the message content also includes one or more `input_image` items:

```json
{
  "type": "input_image",
  "image_url": "data:image/png;base64,..."
}
```

`-Action auto` is the recommended default for both modes. Use `-Action generate` only for text-only generation, and `-Action edit` when a reference image is required.

## Troubleshooting

If `codex` is not found, install Codex CLI or add it to `PATH`.

If you are on a newer Codex CLI and this workflow stops working, first switch back to `0.125.0`:

```bash
npm install -g @openai/codex@0.125.0
```

If Codex reports `expected value at line 1 column 1`, stdin was empty or malformed. Use one of the bundled scripts instead of manually piping text.

If Codex reports `Access is denied` inside a sandboxed Codex session, rerun with escalated permissions.

If `generate` is used together with a reference image, the script stops before sending the request. Use `auto` or `edit` instead.

If `codex responses` is called from a non-interactive macOS/Linux shell where `TERM=dumb`, use `scripts/generate_codex_image.mjs`. It sets a fallback terminal type before invoking Codex.

If no image is saved, rerun with the debug-artifact flag and inspect `response-*.jsonl` to confirm it contains an `image_generation_call` item with a `result` field.
