#!/usr/bin/env node
// Genera DevFlow-Setup.ps1 con el .tgz embebido en base64
// Uso: node scripts/build-installer.js

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// Encontrar el .tgz más reciente
const tgzFiles = fs.readdirSync(rootDir)
  .filter((f) => f.startsWith('df-jira-') && f.endsWith('.tgz'))
  .sort()
  .reverse();

if (tgzFiles.length === 0) {
  console.error('Error: No se encontró df-jira-*.tgz. Ejecuta npm run pack:dist primero.');
  process.exit(1);
}

const tgzFile = tgzFiles[0];
const tgzPath = path.join(rootDir, tgzFile);
const tgzBase64 = fs.readFileSync(tgzPath).toString('base64');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

console.log(`Empaquetando ${tgzFile} (${(tgzBase64.length / 1024).toFixed(0)} KB en base64)...`);

const script = `# DevFlow (jdf) v${pkg.version} — Instalador
# Clic derecho → "Ejecutar con PowerShell"
# ================================================================
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  v $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  x $msg" -ForegroundColor Red; exit 1 }
function Write-Hr         { Write-Host "  $('-' * 50)" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  DevFlow (jdf) v${pkg.version} — Instalador" -ForegroundColor Cyan -BackgroundColor DarkBlue
Write-Host ""

# ── 1. Verificar Node.js ─────────────────────────────────────────
Write-Hr
Write-Step "Verificando Node.js..."

try {
    $nodeVer = & node --version 2>$null
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Ok "Node.js $nodeVer detectado."
} catch {
    Write-Fail "Node.js no esta instalado."
    Write-Host ""
    Write-Host "  Descargalo desde: https://nodejs.org  (version LTS)" -ForegroundColor Yellow
    Write-Host "  Luego vuelve a ejecutar este instalador." -ForegroundColor Gray
    Write-Host ""
    Start-Process "https://nodejs.org"
    Read-Host "  Presiona Enter para salir"
    exit 1
}

# ── 2. Extraer paquete embebido ──────────────────────────────────
Write-Hr
Write-Step "Preparando paquete..."

$tempDir = Join-Path $env:TEMP "devflow-setup-${pkg.version}"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$tgzPath = Join-Path $tempDir "${tgzFile}"

$base64 = "${tgzBase64}"
$bytes = [Convert]::FromBase64String($base64)
[IO.File]::WriteAllBytes($tgzPath, $bytes)
Write-Ok "Paquete listo."

# ── 3. Instalar globalmente ──────────────────────────────────────
Write-Hr
Write-Step "Instalando DevFlow globalmente..."

& npm install -g $tgzPath
if ($LASTEXITCODE -ne 0) { Write-Fail "Error al instalar el paquete npm." }
Write-Ok "DevFlow instalado correctamente."

# ── 4. Configurar VS Code ────────────────────────────────────────
Write-Hr
Write-Step "Configurando terminal en VS Code..."

$vscodeSettings = "$env:APPDATA\\Code\\User\\settings.json"
if (Test-Path $vscodeSettings) {
    try {
        $raw = Get-Content $vscodeSettings -Raw -Encoding UTF8
        $settings = $raw | ConvertFrom-Json
        $profileKey = "terminal.integrated.profiles.windows"

        if (-not ($settings.PSObject.Properties.Name -contains $profileKey)) {
            $settings | Add-Member -NotePropertyName $profileKey -NotePropertyValue ([PSCustomObject]@{})
        }

        $profileObj = [PSCustomObject]@{
            path  = "powershell.exe"
            args  = @("-NoExit", "-Command", "jdf shell")
            icon  = "rocket"
            color = "terminal.ansiCyan"
        }
        $settings.$profileKey | Add-Member -NotePropertyName "DevFlow (jdf)" -NotePropertyValue $profileObj -Force
        $settings | ConvertTo-Json -Depth 10 | Set-Content $vscodeSettings -Encoding UTF8
        Write-Ok 'Perfil "DevFlow (jdf)" agregado al terminal de VS Code.'
    } catch {
        Write-Warn "No se pudo configurar VS Code automaticamente: $_"
    }
} else {
    Write-Warn "VS Code no encontrado. Saltando configuracion de terminal."
}

# ── 5. Limpiar temporales ────────────────────────────────────────
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

# ── 6. Configuracion inicial ─────────────────────────────────────
Write-Hr
Write-Host ""
Write-Ok "Instalacion completada!"
Write-Host ""
Write-Host "  A continuacion se abrira la configuracion inicial." -ForegroundColor White
Write-Host "  Necesitaras:" -ForegroundColor Gray
Write-Host "    - URL de Jira  (ej: https://empresa.atlassian.net)" -ForegroundColor Gray
Write-Host "    - Tu email de Jira" -ForegroundColor Gray
Write-Host "    - API token desde: https://id.atlassian.com/manage-profile/security/api-tokens" -ForegroundColor Gray
Write-Host ""
Read-Host "  Presiona Enter para comenzar la configuracion"
Write-Host ""
& jdf init

Write-Host ""
Write-Host "  Listo! Abre VS Code y selecciona 'DevFlow (jdf)' en el terminal." -ForegroundColor Green
Write-Host ""
Read-Host "  Presiona Enter para salir"
`;

const outputPath = path.join(rootDir, 'DevFlow-Setup.ps1');
fs.writeFileSync(outputPath, script, 'utf8');

// Borrar el .tgz intermedio — solo se necesita el .ps1 para distribuir
fs.unlinkSync(tgzPath);

const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
console.log(`✓ Generado: DevFlow-Setup.ps1 (${sizeMB} MB)`);
console.log('  Comparte ese único archivo. El usuario solo hace clic derecho → Ejecutar con PowerShell.');
