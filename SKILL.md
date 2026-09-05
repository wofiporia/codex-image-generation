---
name: codex-image-generation
description: Generate and save images by running the bundled script against the configured OpenAI-compatible Images API. Use whenever the user asks Codex to generate, edit, or batch-generate images, use gpt-image models, create images from reference files, or save generated image files. The script reads the endpoint and API key from config.json in this skill directory; do not call deprecated codex responses commands directly.
---

# Image Generation

Use the bundled script for every image-generation request. It reads `base_url` and `key` from `<skill-dir>/config.json`, calls the Images API, and saves the returned image. Never print, copy, or expose the configured key.

## Configuration

The skill directory must contain `config.json`:

```json
{
  "base_url": "https://api.openai.com/v1",
  "key": "sk-your-api-key"
}
```

If it is missing, tell the user to copy `config.example.json` to `config.json` and fill in the two fields. Keep `config.json` local and private; it is ignored by git. `base_url` is the API base URL, normally ending in `/v1`. The script appends `/images/generations` for generation and `/images/edits` for reference-image editing. A URL that already ends in either image route is also accepted.

## Running the Script

Determine the absolute skill directory, then run the platform-specific entry point. Use an output directory inside the current workspace unless the user requests another location.

Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir "<workspace>\generated-images"
```

macOS/Linux:

```bash
node "<skill-dir>/scripts/generate_codex_image.mjs" --prompt "A cute cat astronaut, sticker style" --output-dir "<workspace>/generated-images"
```

The default model is `gpt-image-2`. Pass `-Model` or `--model` when the configured endpoint uses another supported model. The script supports `png`, `jpeg`, and `webp` output, `auto`, `low`, `medium`, and `high` quality, and `1024x1024` size by default.

For reference-image editing, pass one or more local paths, HTTP(S) URLs, or base64 data URLs:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>\scripts\generate_codex_image.ps1" -Prompt "Turn this into a polished anime portrait while preserving the pose." -ReferenceImage "<workspace>\reference.png" -Action auto -OutputDir "<workspace>\generated-images"
```

```bash
node "<skill-dir>/scripts/generate_codex_image.mjs" --prompt "Turn this into a polished anime portrait while preserving the pose." --reference-image "<workspace>/reference.png" --action auto --output-dir "<workspace>/generated-images"
```

`auto` selects generation without references and editing with references. Use `generate` only for text-to-image and `edit` only when at least one reference image is supplied. Direct Images API editing does not accept `file-*` IDs; download the file first or provide a local file, URL, or data URL.

## Script Options

Both entries expose the same options:

- Prompt: `-Prompt` or `--prompt`
- Config file: `-ConfigPath` or `--config`
- Output directory: `-OutputDir` or `--output-dir`
- Model: `-Model` or `--model`
- Size: `-Size` or `--size`
- Quality: `-Quality` or `--quality`
- Format: `-Format` or `--format`
- Action: `-Action` or `--action`
- Reference images: `-ReferenceImage` or `--reference-image`
- Keep request/response artifacts: `-DebugArtifacts` or `--debug-artifacts`
- Validate configuration and request metadata without calling the API: `-DryRun` or `--dry-run`

Use `--config` or `-ConfigPath` only when the configuration is stored somewhere other than the skill directory. The key is never included in request metadata or normal output.

## Output and Errors

Successful runs save one image named `image-YYYYMMDD-HHMMSS.<format>` and report its absolute path. The API response may contain `b64_json`, a temporary `url`, or image bytes; the script handles all three. Request metadata and the raw response are removed after a successful run unless the debug flag is used. Failed requests preserve those artifacts when available so the response can be inspected.

If the configuration is missing or invalid, stop and report the exact config path and the required fields. If the API returns an error, report its status and safe error message without revealing the key. Do not fall back to `codex responses` or make a direct API call from the model; invoke the bundled script instead.
