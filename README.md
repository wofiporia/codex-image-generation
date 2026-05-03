# Codex Image Generation Skill

Generate images through the local Codex CLI by sending a raw streaming Responses payload to the hidden `codex responses` command. The image model is configured inside the `image_generation` tool and defaults to `gpt-image-2`.

The script supports both text-to-image and reference-image generation. Reference images can be local files, HTTP(S) URLs, base64 data URLs, or OpenAI `file-*` IDs.

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

For a reference image, ask Codex to include the image path or URL:

```text
Use $codex-image-generation to generate a polished anime portrait from this reference image: D:\images\character.png. Keep the pose and outfit, but improve lighting and detail.
```

## Direct Script Usage

From PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir ".\generated-images"
```

Reference-image generation:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "Turn this reference into a polished anime portrait while preserving the pose and palette." -ReferenceImage ".\reference.png" -Action auto -Quality high -OutputDir ".\generated-images"
```

If `-Prompt` is omitted, the script asks for it interactively:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1"
```

## Output

Successful runs write only the final image by default:

```text
image-YYYYMMDD-HHMMSS.png
```

Pass `-DebugArtifacts` to also keep the request and response files:

```text
payload-YYYYMMDD-HHMMSS.json
response-YYYYMMDD-HHMMSS.jsonl
```

The payload and response files are useful for debugging and reproducibility. Failed requests may leave these files in place so the failure can be inspected.

## Parameters

```text
-Prompt       Image prompt. If omitted, prompts interactively.
-OutputDir    Output directory. Defaults to generated-images under the current directory.
-Model        Top-level Responses model. Default: gpt-5.5.
-ImageModel   Image tool model. Default: gpt-image-2.
-Size         Image size. Default: 1024x1024.
-Quality      auto, low, medium, or high. Default: auto.
-Format       png, jpeg, or webp. Default: png.
-Action       auto, generate, or edit. Default: auto.
-ReferenceImage
              Optional local path, HTTP(S) URL, base64 data URL, or OpenAI file-* ID.
              Can be passed multiple times.
-DebugArtifacts
              Keep payload and response JSONL files after a successful run.
-DryRun       Save payload JSON without calling codex responses.
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

If Codex reports `expected value at line 1 column 1`, stdin was empty or malformed. Use the bundled script instead of manually piping text from PowerShell.

If Codex reports `Access is denied` inside a sandboxed Codex session, rerun with escalated permissions.

If `-Action generate` is used with `-ReferenceImage`, the script stops before sending the request. Use `-Action auto` or `-Action edit`.

If no image is saved, rerun with `-DebugArtifacts` and inspect `response-*.jsonl` to confirm it contains an `image_generation_call` item with a `result` field.
