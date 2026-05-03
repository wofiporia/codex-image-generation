# Codex Image Generation Skill

Generate images through the local Codex CLI by sending a raw streaming Responses payload to the hidden `codex responses` command. The image model is configured inside the `image_generation` tool and defaults to `gpt-image-2`.

## What This Skill Contains

```text
codex-image-generation/
  SKILL.md
  agents/openai.yaml
  scripts/generate_codex_image.ps1
```

This version is Windows/PowerShell-focused.

## Requirements

- Windows with PowerShell.
- Codex CLI installed and available as `codex` on `PATH`.
- Codex CLI already logged in or configured with a provider that supports `codex responses`.

## Install Location

Recommended location:

```text
C:\Users\<you>\.codex\skills\codex-image-generation
```

Restart Codex after installing or updating the skill so it can be discovered.

## Usage From Codex

Ask Codex to use the skill:

```text
Use $codex-image-generation to generate an image from this prompt: A cute cat astronaut, sticker style.
```

Codex should run the bundled script and report the saved image path.

## Direct Script Usage

From PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir ".\generated-images"
```

If `-Prompt` is omitted, the script asks for it interactively:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1"
```

## Output

Each run writes three files:

```text
image-YYYYMMDD-HHMMSS.png
payload-YYYYMMDD-HHMMSS.json
response-YYYYMMDD-HHMMSS.jsonl
```

The image file is the final result. The payload and response files are saved for debugging and reproducibility.

## Parameters

```text
-Prompt       Image prompt. If omitted, prompts interactively.
-OutputDir    Output directory. Defaults to generated-images under the current directory.
-Model        Top-level Responses model. Default: gpt-5.4.
-ImageModel   Image tool model. Default: gpt-image-2.
-Size         Image size. Default: 1024x1024.
-Quality      auto, low, medium, or high. Default: auto.
-Format       png, jpeg, or webp. Default: png.
```

## Payload Shape

The script sends a payload shaped like:

```json
{
  "model": "gpt-5.4",
  "tools": [
    {
      "type": "image_generation",
      "model": "gpt-image-2",
      "action": "generate",
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

## Troubleshooting

If `codex` is not found, install Codex CLI or add it to `PATH`.

If Codex reports `expected value at line 1 column 1`, stdin was empty or malformed. Use the bundled script instead of manually piping text from PowerShell.

If Codex reports `Access is denied` inside a sandboxed Codex session, rerun with escalated permissions.

If no image is saved, inspect `response-*.jsonl` and confirm it contains an `image_generation_call` item with a `result` field.
