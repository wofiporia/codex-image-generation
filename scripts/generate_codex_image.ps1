param(
  [string]$Prompt,
  [string]$ConfigPath,
  [string]$OutputDir = (Join-Path (Get-Location) "generated-images"),
  [string]$Model = "gpt-image-2",
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
Add-Type -AssemblyName System.Net.Http

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $PSScriptRoot "..\config.json"
}
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "Missing config file: $ConfigPath. Copy config.example.json to config.json and fill in base_url and key."
}

try {
  $config = (Get-Content -LiteralPath $ConfigPath -Raw) | ConvertFrom-Json
} catch {
  throw "Cannot parse config file ${ConfigPath}: $($_.Exception.Message)"
}

$baseUrl = if ($null -ne $config.base_url) { [string]$config.base_url } else { "" }
$apiKey = if ($null -ne $config.key) { [string]$config.key } else { "" }
$baseUrl = $baseUrl.Trim().TrimEnd("/")
$apiKey = $apiKey.Trim()
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
  throw "Config field 'base_url' is required in $ConfigPath."
}
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Config field 'key' is required in $ConfigPath."
}
try {
  $parsedBaseUrl = [Uri]$baseUrl
  if ($parsedBaseUrl.Scheme -notin @("http", "https")) {
    throw "Config field 'base_url' must use http or https."
  }
} catch {
  throw "Config field 'base_url' is not a valid URL: $baseUrl"
}

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

$referenceImages = @($ReferenceImage | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($Action -eq "generate" -and $referenceImages.Count -gt 0) {
  throw "Action 'generate' cannot use reference images. Use -Action auto or -Action edit."
}
if ($Action -eq "edit" -and $referenceImages.Count -eq 0) {
  throw "Action 'edit' requires at least one -ReferenceImage."
}

$promptText = $Prompt
if (-not $PSBoundParameters.ContainsKey("Prompt")) {
  $promptText = Read-Host "Enter image prompt"
}
if ([string]::IsNullOrWhiteSpace($promptText)) {
  throw "Prompt cannot be empty."
}

function Get-Endpoint {
  param(
    [string]$BaseUrl,
    [string]$Route
  )

  $match = [regex]::Match($BaseUrl, "/images/(generations|edits)$", [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($match.Success) {
    return $BaseUrl.Substring(0, $match.Index) + "/images/$Route"
  }
  return "$BaseUrl/images/$Route"
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

function Get-ExtensionForMimeType {
  param([string]$MimeType)

  switch ($MimeType.ToLowerInvariant().Split(";")[0]) {
    "image/jpeg" { return ".jpg" }
    "image/png" { return ".png" }
    "image/webp" { return ".webp" }
    "image/gif" { return ".gif" }
    default { return ".png" }
  }
}

function Get-RemoteBytes {
  param(
    [string]$Url,
    [string]$Key,
    [string]$ApiBaseUrl
  )

  $client = [System.Net.Http.HttpClient]::new()
  try {
    if ($Key -and $ApiBaseUrl) {
      $urlUri = [Uri]$Url
      $baseUri = [Uri]$ApiBaseUrl
      if ($urlUri.Scheme -eq $baseUri.Scheme -and $urlUri.Host -eq $baseUri.Host -and $urlUri.Port -eq $baseUri.Port) {
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Key)
      }
    }
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    try {
      $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
      $mimeType = "image/png"
      if ($null -ne $response.Content.Headers.ContentType -and $response.Content.Headers.ContentType.MediaType) {
        $mimeType = $response.Content.Headers.ContentType.MediaType
      }
      if (-not $response.IsSuccessStatusCode -and -not $mimeType.ToLowerInvariant().StartsWith("image/")) {
        throw "Remote image request failed with $($response.StatusCode) $($response.ReasonPhrase)."
      }
      if (-not $mimeType.ToLowerInvariant().StartsWith("image/")) {
        throw "Remote URL did not return an image."
      }
      return [PSCustomObject]@{
        Bytes = $bytes
        MimeType = $mimeType
      }
    } finally {
      $response.Dispose()
    }
  } finally {
    $client.Dispose()
  }
}

function Get-ReferenceImageData {
  param(
    [string]$Reference,
    [int]$Index
  )

  $trimmed = $Reference.Trim()
  if ($trimmed -match "(?s)^data:(image/[^;]+);base64,(.*)$") {
    $mimeType = $Matches[1].ToLowerInvariant()
    try {
      $bytes = [Convert]::FromBase64String(($Matches[2] -replace "\s", ""))
    } catch {
      throw "Reference image data URL is not valid base64."
    }
    return [PSCustomObject]@{
      Bytes = $bytes
      MimeType = $mimeType
      FileName = "reference-$($Index + 1)$(Get-ExtensionForMimeType $mimeType)"
    }
  }
  if ($trimmed -match "^file-[A-Za-z0-9_-]+$") {
    throw "Reference image file IDs are not supported by the direct Images API: $trimmed"
  }
  if ($trimmed -match "^https?://") {
    $remote = Get-RemoteBytes -Url $trimmed
    if (-not $remote.MimeType.ToLowerInvariant().StartsWith("image/")) {
      throw "Reference URL did not return an image: $trimmed"
    }
    $fileName = "reference-$($Index + 1)$(Get-ExtensionForMimeType $remote.MimeType)"
    try {
      $uri = [Uri]$trimmed
      $candidate = [IO.Path]::GetFileName($uri.AbsolutePath)
      if ($candidate -and [IO.Path]::GetExtension($candidate)) {
        $fileName = $candidate
      }
    } catch {
    }
    return [PSCustomObject]@{
      Bytes = $remote.Bytes
      MimeType = $remote.MimeType
      FileName = $fileName
    }
  }

  $resolvedPath = Resolve-Path -LiteralPath $trimmed -ErrorAction Stop
  if ($resolvedPath.Provider.Name -ne "FileSystem") {
    throw "Reference image is not a filesystem path: $trimmed"
  }
  $localPath = $resolvedPath.ProviderPath
  return [PSCustomObject]@{
    Bytes = [IO.File]::ReadAllBytes($localPath)
    MimeType = Get-ImageMimeType -Path $localPath
    FileName = [IO.Path]::GetFileName($localPath)
  }
}

function New-ApiClient {
  param([string]$Key)

  $client = [System.Net.Http.HttpClient]::new()
  $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Key)
  return $client
}

function Invoke-ImageRequest {
  param(
    [System.Net.Http.HttpClient]$Client,
    [string]$Endpoint,
    [string]$RequestAction,
    [string]$RequestModel,
    [string]$RequestPrompt,
    [string]$RequestSize,
    [string]$RequestQuality,
    [string]$RequestFormat,
    [object[]]$ReferenceFiles
  )

  if ($RequestAction -eq "generate") {
    $body = [ordered]@{
      model = $RequestModel
      prompt = $RequestPrompt
      n = 1
      size = $RequestSize
      quality = $RequestQuality
      output_format = $RequestFormat
    }
    $bodyJson = $body | ConvertTo-Json -Depth 20
    $content = [System.Net.Http.StringContent]::new($bodyJson, [Text.Encoding]::UTF8, "application/json")
    try {
      $response = $Client.PostAsync($Endpoint, $content).GetAwaiter().GetResult()
    } finally {
      $content.Dispose()
    }
  } else {
    $multipart = [System.Net.Http.MultipartFormDataContent]::new()
    try {
      $multipart.Add([System.Net.Http.StringContent]::new($RequestModel), "model")
      $multipart.Add([System.Net.Http.StringContent]::new($RequestPrompt), "prompt")
      $multipart.Add([System.Net.Http.StringContent]::new("1"), "n")
      $multipart.Add([System.Net.Http.StringContent]::new($RequestSize), "size")
      $multipart.Add([System.Net.Http.StringContent]::new($RequestQuality), "quality")
      $multipart.Add([System.Net.Http.StringContent]::new($RequestFormat), "output_format")
      foreach ($reference in $ReferenceFiles) {
        $fileContent = [System.Net.Http.ByteArrayContent]::new($reference.Bytes)
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new($reference.MimeType)
        $multipart.Add($fileContent, "image", $reference.FileName)
      }
      $response = $Client.PostAsync($Endpoint, $multipart).GetAwaiter().GetResult()
    } finally {
      $multipart.Dispose()
    }
  }

  try {
    $responseBytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $responseText = [Text.Encoding]::UTF8.GetString($responseBytes)
    $contentType = ""
    if ($null -ne $response.Content.Headers.ContentType -and $response.Content.Headers.ContentType.MediaType) {
      $contentType = $response.Content.Headers.ContentType.MediaType
    }
    return [PSCustomObject]@{
      Response = $response
      Bytes = $responseBytes
      Text = $responseText
      ContentType = $contentType
    }
  } catch {
    $response.Dispose()
    throw
  }
}

function Get-ImageBytesFromResponse {
  param(
    [byte[]]$ResponseBytes,
    [string]$ResponseText,
    [string]$ContentType,
    [string]$Key,
    [string]$ApiBaseUrl
  )

  if ($ContentType.ToLowerInvariant().StartsWith("image/")) {
    return ,$ResponseBytes
  }

  try {
    $json = $ResponseText | ConvertFrom-Json
  } catch {
    throw "Image API returned a response that is neither JSON nor an image."
  }
  $items = @($json.data)
  $item = if ($items.Count -gt 0) { $items[0] } else { $null }
  if ($null -ne $item -and $item.b64_json) {
    $cleanBase64 = ([string]$item.b64_json) -replace "^data:image/[^;]+;base64,", ""
    $cleanBase64 = $cleanBase64 -replace "\s", ""
    try {
      return ,([Convert]::FromBase64String($cleanBase64))
    } catch {
      throw "Image API returned invalid base64 image data."
    }
  }
  if ($null -ne $item -and $item.url) {
    $remote = Get-RemoteBytes -Url ([string]$item.url) -Key $Key -ApiBaseUrl $ApiBaseUrl
    return ,$remote.Bytes
  }
  throw "Image API response did not contain data[0].b64_json or data[0].url."
}

function Get-ApiErrorMessage {
  param(
    [System.Net.Http.HttpResponseMessage]$Response,
    [string]$ResponseText,
    [string]$Key
  )

  $detail = $ResponseText.Trim()
  try {
    $json = $ResponseText | ConvertFrom-Json
    if ($json.error.message) {
      $detail = [string]$json.error.message
    } elseif ($json.message) {
      $detail = [string]$json.message
    }
  } catch {
    if ($detail.Length -gt 4000) {
      $detail = $detail.Substring(0, 4000)
    }
  }
  if ($Key) {
    $detail = $detail.Replace($Key, "[redacted]")
  }
  $suffix = if ($detail) { " $detail" } else { "" }
  return "Image API request failed with $($Response.StatusCode) $($Response.ReasonPhrase).$suffix"
}

$requestAction = if ($Action -eq "auto") {
  if ($referenceImages.Count -gt 0) { "edit" } else { "generate" }
} else {
  $Action
}
$endpoint = Get-Endpoint -BaseUrl $baseUrl -Route $(if ($requestAction -eq "edit") { "edits" } else { "generations" })
$outputDir = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$payloadPath = Join-Path $outputDir "payload-$stamp.json"
$responsePath = Join-Path $outputDir "response-$stamp.json"
$imagePath = Join-Path $outputDir "image-$stamp.$Format"

$requestMetadata = [ordered]@{
  endpoint = $endpoint
  model = $Model
  prompt = $promptText
  n = 1
  size = $Size
  quality = $Quality
  output_format = $Format
  action = $requestAction
  reference_images = @($referenceImages)
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$payloadJson = $requestMetadata | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($payloadPath, $payloadJson, $utf8NoBom)

if ($DryRun) {
  Write-Host "Dry run enabled. Request metadata saved: $payloadPath"
  if ($referenceImages.Count -gt 0) {
    Write-Host "Reference images included: $($referenceImages.Count)"
  }
  return
}

$client = New-ApiClient -Key $apiKey
$requestResult = $null
try {
  $referenceFiles = @()
  if ($requestAction -eq "edit") {
    for ($index = 0; $index -lt $referenceImages.Count; $index += 1) {
      $referenceFiles += Get-ReferenceImageData -Reference $referenceImages[$index] -Index $index
    }
  }
  $requestResult = Invoke-ImageRequest `
    -Client $client `
    -Endpoint $endpoint `
    -RequestAction $requestAction `
    -RequestModel $Model `
    -RequestPrompt $promptText `
    -RequestSize $Size `
    -RequestQuality $Quality `
    -RequestFormat $Format `
    -ReferenceFiles $referenceFiles
  [IO.File]::WriteAllText($responsePath, $requestResult.Text, $utf8NoBom)
  if (-not $requestResult.Response.IsSuccessStatusCode -and -not $requestResult.ContentType.ToLowerInvariant().StartsWith("image/")) {
    throw (Get-ApiErrorMessage -Response $requestResult.Response -ResponseText $requestResult.Text -Key $apiKey)
  }
  $imageBytes = Get-ImageBytesFromResponse `
    -ResponseBytes $requestResult.Bytes `
    -ResponseText $requestResult.Text `
    -ContentType $requestResult.ContentType `
    -Key $apiKey `
    -ApiBaseUrl $baseUrl
  [IO.File]::WriteAllBytes($imagePath, $imageBytes)
} finally {
  if ($null -ne $requestResult) {
    $requestResult.Response.Dispose()
  }
  $client.Dispose()
}

Write-Host ""
Write-Host "Image saved: $imagePath"
if ($DebugArtifacts) {
  Write-Host "Request metadata saved: $payloadPath"
  Write-Host "Response saved: $responsePath"
} else {
  Remove-Item -LiteralPath $payloadPath, $responsePath -Force -ErrorAction SilentlyContinue
}
