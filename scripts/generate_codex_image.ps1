param(
  [string]$Prompt,
  [string]$OutputDir = (Join-Path (Get-Location) "generated-images"),
  [string]$Model = "gpt-5.5",
  [string]$ImageModel = "gpt-image-2",
  [string]$Size = "1024x1024",
  [string]$Quality = "auto",
  [string]$Format = "png",
  [string]$Action = "auto",
  [string[]]$ReferenceImage = @(),
  [switch]$DebugArtifacts,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Quality = $Quality.ToLowerInvariant()
$Format = $Format.ToLowerInvariant()
$Action = $Action.ToLowerInvariant()

$allowedQualities = @("auto", "low", "medium", "high")
$allowedFormats = @("png", "jpeg", "webp")
$allowedActions = @("auto", "generate", "edit")
if ($allowedQualities -notcontains $Quality) {
  throw "Invalid quality: $Quality"
}
if ($allowedFormats -notcontains $Format) {
  throw "Invalid format: $Format"
}
if ($allowedActions -notcontains $Action) {
  throw "Invalid action: $Action"
}

$promptText = $Prompt
if (-not $PSBoundParameters.ContainsKey("Prompt")) {
  $promptText = Read-Host "Enter image prompt"
}
if ([string]::IsNullOrWhiteSpace($promptText)) {
  throw "Prompt cannot be empty."
}

$referenceImages = @($ReferenceImage | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($Action -eq "generate" -and $referenceImages.Count -gt 0) {
  throw "Action 'generate' cannot use reference images. Use -Action auto or -Action edit."
}
if ($Action -eq "edit" -and $referenceImages.Count -eq 0) {
  throw "Action 'edit' requires at least one -ReferenceImage."
}

function Get-ImageMimeType {
  param([string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".png" { return "image/png" }
    ".webp" { return "image/webp" }
    ".gif" { return "image/gif" }
    default {
      throw "Unsupported reference image extension: $Path. Use jpg, jpeg, png, webp, or gif."
    }
  }
}

function ConvertTo-InputImageContent {
  param([string]$Reference)

  $trimmed = $Reference.Trim()
  if ($trimmed -match "^data:image/[^;]+;base64,") {
    return [ordered]@{
      type = "input_image"
      image_url = $trimmed
    }
  }
  if ($trimmed -match "^https?://") {
    return [ordered]@{
      type = "input_image"
      image_url = $trimmed
    }
  }
  if ($trimmed -match "^file-[A-Za-z0-9_-]+$") {
    return [ordered]@{
      type = "input_image"
      file_id = $trimmed
    }
  }

  $resolvedPath = Resolve-Path -LiteralPath $trimmed -ErrorAction Stop
  if ($resolvedPath.Provider.Name -ne "FileSystem") {
    throw "Reference image is not a filesystem path: $trimmed"
  }

  $localPath = $resolvedPath.ProviderPath
  $mimeType = Get-ImageMimeType -Path $localPath
  $imageBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($localPath))
  return [ordered]@{
    type = "input_image"
    image_url = "data:$mimeType;base64,$imageBase64"
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$payloadPath = Join-Path $OutputDir "payload-$stamp.json"
$responsePath = Join-Path $OutputDir "response-$stamp.jsonl"
$imagePath = Join-Path $OutputDir "image-$stamp.$Format"

$messageContent = @(
  [ordered]@{
    type = "input_text"
    text = $promptText
  }
)
foreach ($reference in $referenceImages) {
  $messageContent += ConvertTo-InputImageContent -Reference $reference
}

$payload = [ordered]@{
  model = $Model
  instructions = ""
  input = @(
    [ordered]@{
      type = "message"
      role = "user"
      content = @($messageContent)
    }
  )
  tools = @(
    [ordered]@{
      type = "image_generation"
      model = $ImageModel
      action = $Action
      size = $Size
      quality = $Quality
      output_format = $Format
    }
  )
  tool_choice = [ordered]@{
    type = "image_generation"
  }
  parallel_tool_calls = $true
  reasoning = [ordered]@{
    effort = "high"
  }
  store = $false
  stream = $true
  text = [ordered]@{
    verbosity = "low"
  }
}

$payloadJson = $payload | ConvertTo-Json -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($payloadPath, $payloadJson, $utf8NoBom)

if ($DryRun) {
  Write-Host "Dry run enabled. Payload saved: $payloadPath"
  if ($referenceImages.Count -gt 0) {
    Write-Host "Reference images included: $($referenceImages.Count)"
  }
  return
}

Write-Host "Sending request through: codex responses"
$cmdPayloadPath = $payloadPath.Replace('"', '""')
$responseLines = & cmd.exe /d /s /c "chcp 65001 >nul && type ""$cmdPayloadPath"" | codex responses"
$codexExitCode = $LASTEXITCODE
$responseLines | Set-Content -LiteralPath $responsePath -Encoding UTF8

if ($codexExitCode -ne 0) {
  throw "codex responses failed with exit code $codexExitCode. Response saved to: $responsePath"
}

$imageBase64 = $null
$revisedPrompt = $null

foreach ($line in $responseLines) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  try {
    $event = $line | ConvertFrom-Json
  } catch {
    continue
  }

  if ($event.type -eq "response.output_item.done" -and $event.item.type -eq "image_generation_call") {
    if ($event.item.revised_prompt) {
      $revisedPrompt = $event.item.revised_prompt
    }
    if ($event.item.result) {
      $imageBase64 = $event.item.result
    }
  }
}

if (-not $imageBase64) {
  throw "No image_generation_call.result found. Response saved to: $responsePath"
}

$cleanBase64 = $imageBase64 -replace "\s", ""
[IO.File]::WriteAllBytes($imagePath, [Convert]::FromBase64String($cleanBase64))

Write-Host ""
Write-Host "Image saved: $imagePath"
if ($DebugArtifacts) {
  Write-Host "Payload saved: $payloadPath"
  Write-Host "Response saved: $responsePath"
} else {
  Remove-Item -LiteralPath $payloadPath, $responsePath -Force -ErrorAction SilentlyContinue
}
if ($revisedPrompt) {
  Write-Host ""
  Write-Host "Revised prompt:"
  Write-Host $revisedPrompt
}
