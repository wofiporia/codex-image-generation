# Codex Image Generation Skill

Generate or edit images through a configured OpenAI-compatible Images API. Codex invokes the bundled script; the script reads the endpoint and API key from `config.json` in the skill directory and saves the image locally.

## Files

```text
codex-image-generation/
  SKILL.md
  README.md
  config.example.json
  scripts/generate_codex_image.ps1
  scripts/generate_codex_image.mjs
```

Create the private configuration file beside `config.example.json`:

```powershell
Copy-Item .\config.example.json .\config.json
```

Then edit `config.json`:

```json
{
  "base_url": "https://api.openai.com/v1",
  "key": "sk-your-api-key"
}
```

`base_url` is the API base URL. The script appends `/images/generations` or `/images/edits`; it also accepts a URL that already ends with one of those routes. `config.json` is git-ignored so the key is not accidentally committed.

## Requirements

- Windows with PowerShell for `scripts/generate_codex_image.ps1`, or Node.js 18+ for `scripts/generate_codex_image.mjs`.
- A configured endpoint that implements the OpenAI-compatible Images API.
- A model supported by that endpoint. The default is `gpt-image-2`; override it with `-Model` or `--model` if needed.

## Usage From Codex

Ask Codex to use the skill:

```text
Use $codex-image-generation to generate an image from this prompt: A cute cat astronaut, sticker style.
```

Codex should run the bundled script and report the saved image path. If `config.json` is missing, create it from `config.example.json` and fill in `base_url` and `key` before retrying.

## Direct Script Usage

Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "A cute cat astronaut, sticker style" -OutputDir ".\generated-images"
```

macOS/Linux:

```bash
node "$HOME/.codex/skills/codex-image-generation/scripts/generate_codex_image.mjs" --prompt "A cute cat astronaut, sticker style" --output-dir "./generated-images"
```

Reference-image editing accepts local files, HTTP(S) URLs, and base64 data URLs:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\codex-image-generation\scripts\generate_codex_image.ps1" -Prompt "Polish this portrait while preserving the pose and palette." -ReferenceImage ".\reference.png" -Action auto -OutputDir ".\generated-images"
```

```bash
node "$HOME/.codex/skills/codex-image-generation/scripts/generate_codex_image.mjs" --prompt "Polish this portrait while preserving the pose and palette." --reference-image "./reference.png" --action auto --output-dir "./generated-images"
```

Use `--dry-run` or `-DryRun` to validate the configuration and inspect request metadata without making a network request. Use `--debug-artifacts` or `-DebugArtifacts` to keep the request metadata and raw response after a successful run.

## Request Shape

Text-to-image requests use `POST {base_url}/images/generations` with JSON similar to:

```json
{
  "model": "gpt-image-2",
  "prompt": "A cute cat astronaut, sticker style",
  "n": 1,
  "size": "1024x1024",
  "quality": "auto",
  "output_format": "png"
}
```

Reference-image requests use `POST {base_url}/images/edits` as multipart form data. The returned image can be `data[0].b64_json`, `data[0].url`, or direct image bytes. The script handles each response form.

## Troubleshooting

If the config file is not found, copy `config.example.json` to `config.json` inside the skill directory. If the API returns `401`, check `key`; if it returns `404`, check that `base_url` is the provider's API base URL and not a dashboard URL. If the model is unsupported, pass the model name required by the configured endpoint.
