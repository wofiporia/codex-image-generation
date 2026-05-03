param(
  [string]$Prompt,
  [string]$OutputDir = (Join-Path (Get-Location) "generated-images"),
  [string]$Model = "gpt-5.4",
  [string]$ImageModel = "gpt-image-2",
  [string]$Size = "1024x1024",
  [string]$Quality = "auto",
  [string]$Format = "png"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$allowedQualities = @("auto", "low", "medium", "high")
$allowedFormats = @("png", "jpeg", "webp")
if ($allowedQualities -notcontains $Quality) {
  throw "Invalid quality: $Quality"
}
if ($allowedFormats -notcontains $Format) {
  throw "Invalid format: $Format"
}

$promptText = $Prompt
if (-not $PSBoundParameters.ContainsKey("Prompt")) {
  $promptText = Read-Host "Enter image prompt"
}
if ([string]::IsNullOrWhiteSpace($promptText)) {
  throw "Prompt cannot be empty."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$payloadPath = Join-Path $OutputDir "payload-$stamp.json"
$responsePath = Join-Path $OutputDir "response-$stamp.jsonl"
$imagePath = Join-Path $OutputDir "image-$stamp.$Format"

$payload = [ordered]@{
  model = $Model
  instructions = ""
  input = @(
    [ordered]@{
      type = "message"
      role = "user"
      content = @(
        [ordered]@{
          type = "input_text"
          text = $promptText
        }
      )
    }
  )
  tools = @(
    [ordered]@{
      type = "image_generation"
      model = $ImageModel
      action = "generate"
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
Write-Host "Payload saved: $payloadPath"
Write-Host "Response saved: $responsePath"
if ($revisedPrompt) {
  Write-Host ""
  Write-Host "Revised prompt:"
  Write-Host $revisedPrompt
}
