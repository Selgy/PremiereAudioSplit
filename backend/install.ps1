# Installation one-time du backend PremiereAudioSplit.
#   - crée le venv + installe les dépendances (PyTorch/Demucs, plusieurs Go)
#   - enregistre le schéma d'URL "audiosplit://" pour l'auto-démarrage depuis le panneau
#
# Usage : clic droit > Exécuter avec PowerShell, ou :
#   powershell -ExecutionPolicy Bypass -File .\install.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== 1/2  Environnement Python ==" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

$pythonw = Join-Path $PSScriptRoot ".venv\Scripts\pythonw.exe"
$server  = Join-Path $PSScriptRoot "server.py"
if (-not (Test-Path $pythonw)) { throw "pythonw introuvable : $pythonw" }

Write-Host "== 2/2  Enregistrement du schema audiosplit:// ==" -ForegroundColor Cyan
# HKCU : pas besoin de droits admin. pythonw = pas de fenetre console.
$root = "HKCU:\Software\Classes\audiosplit"
New-Item -Path $root -Force | Out-Null
Set-ItemProperty -Path $root -Name "(Default)"   -Value "URL:AudioSplit Protocol"
Set-ItemProperty -Path $root -Name "URL Protocol" -Value ""

$cmdKey = "$root\shell\open\command"
New-Item -Path $cmdKey -Force | Out-Null
# %1 = l'URL (audiosplit://start) ; server.py l'ignore.
$command = "`"$pythonw`" `"$server`" `"%1`""
Set-ItemProperty -Path $cmdKey -Name "(Default)" -Value $command

Write-Host ""
Write-Host "Installe. Le panneau demarrera le backend automatiquement." -ForegroundColor Green
Write-Host "Commande enregistree : $command" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Test rapide : dans un navigateur ou Win+R, tape  audiosplit://start" -ForegroundColor DarkGray
