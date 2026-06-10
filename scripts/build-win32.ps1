param(
  [string]$OutputDir = "dist\devops-medic-win32"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$target = Join-Path $root $OutputDir
$resolvedRoot = [System.IO.Path]::GetFullPath($root)
$resolvedTarget = [System.IO.Path]::GetFullPath($target)

if (-not $resolvedTarget.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside the project directory: $resolvedTarget"
}

if (Test-Path $resolvedTarget) {
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $resolvedTarget | Out-Null

$files = @(
  "index.html",
  "styles.css",
  "app.js",
  "server.js",
  "package.json",
  "package-lock.json",
  "README.md",
  "AGENT_POLICY.md",
  ".env.example"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $resolvedTarget
}

@"
@echo off
setlocal
cd /d %~dp0
node server.js
"@ | Set-Content -Encoding ASCII -Path (Join-Path $resolvedTarget "start-devops-medic.cmd")

@"
# DevOps Medic Win32 Package

This package is architecture-neutral JavaScript. For 32-bit Windows, install 32-bit Node.js and run:

```cmd
start-devops-medic.cmd
```

Then open:

```text
http://localhost:4173
```

To connect GitLab, copy `.env.example` to `.env` and set:

```text
GITLAB_BASE_URL=https://gitlab.com
GITLAB_PROJECT_ID=your-project-id
GITLAB_TOKEN=your-token
```

Use a GitLab token with `read_api` and `read_repository` for the current read-only integration.
"@ | Set-Content -Encoding ASCII -Path (Join-Path $resolvedTarget "WIN32_README.md")

Compress-Archive -Path (Join-Path $resolvedTarget "*") -DestinationPath (Join-Path $root "dist\devops-medic-win32.zip") -Force

Write-Host "Built $resolvedTarget"
Write-Host "Created dist\devops-medic-win32.zip"
