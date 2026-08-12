# Baut ein verteilbares ZIP der Erweiterung.
#
# Gepackt wird ausschliesslich aus src/, und zwar dessen INHALT: manifest.json
# muss in der Wurzel des ZIP liegen, nicht in einem Unterordner.
#
# Bewusst als ALLOWLIST: es wird nur eingepackt, was hier ausdruecklich steht.
# Eine Ausschlussliste waere gefaehrlich - im Projektordner liegen Test-Snapshots
# (.playwright-mcp/) mit echten Portalinhalten und Klarnamen, die niemals
# mitverteilt werden duerfen.
#
# Aufruf:
#   .\package.ps1
#   .\package.ps1 -DefaultPortal "https://deinefirma.mitarbeiterangebote.de"
#
# Mit -DefaultPortal wird die Portal-URL im Build vorbelegt - fuer private
# Builds, bei denen niemand mehr etwas eintippen soll. NIE fuer den Store-Build:
# das schriebe den Arbeitgeber in oeffentlichen Code.

param(
    [string]$DefaultPortal = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$src  = Join-Path $root "src"

# --- Was ins Paket gehoert ---
$allow = @(
    "manifest.json",
    "background.js",
    "common.js",
    "content-hints.js",
    "offscreen.html",
    "offscreen.js",
    "options.css",
    "options.html",
    "options.js",
    "popup.css",
    "popup.html",
    "popup.js",
    "theme.css",
    "fonts",
    "icons",
    "_locales"
)

$stage = Join-Path $env:TEMP "cb-deal-finder-build"
$dist  = Join-Path $root "dist"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist -Force | Out-Null }

foreach ($item in $allow) {
    $from = Join-Path $src $item
    if (-not (Test-Path $from)) { throw "Fehlende Datei im Allowlist: $item" }
    Copy-Item $from -Destination $stage -Recurse -Force
}

# Optional: Portal-URL vorbelegen
if ($DefaultPortal -ne "") {
    $commonPath = Join-Path $stage "common.js"
    $content = Get-Content $commonPath -Raw
    $content = $content -replace 'const CB_DEFAULT_PORTAL = "";', "const CB_DEFAULT_PORTAL = `"$DefaultPortal`";"
    Set-Content $commonPath $content -Encoding utf8 -NoNewline
    Write-Host "Portal vorbelegt: $DefaultPortal" -ForegroundColor Cyan
}

# --- Sicherheitsnetz: nichts Unerwartetes im Paket ---
$leaked = Get-ChildItem $stage -Recurse -File | Where-Object {
    $_.FullName -match '\.playwright-mcp|[\\/]test[\\/]|\.log$|\.yml$|dist'
}
if ($leaked) {
    $leaked | ForEach-Object { Write-Host "  ! $($_.FullName)" -ForegroundColor Red }
    throw "ABBRUCH: unerwartete Dateien im Paket (siehe oben)."
}

$version = (Get-Content (Join-Path $src "manifest.json") -Raw | ConvertFrom-Json).version
$zip = Join-Path $dist "cb-deal-finder-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Remove-Item $stage -Recurse -Force

$count = (Get-ChildItem $dist -Filter "*.zip" | Where-Object { $_.Name -eq "cb-deal-finder-$version.zip" }).Length
Write-Host ""
Write-Host "Fertig: $zip" -ForegroundColor Green
Write-Host ("Groesse: {0:N0} KB" -f ($count / 1KB))
Write-Host ""
Write-Host "Bereit zum Hochladen in die Chrome Web Store Developer Console." -ForegroundColor Yellow
