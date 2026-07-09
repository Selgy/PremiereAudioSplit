# Lance le backend de séparation.
# Usage : .\run.ps1   (crée le venv au premier lancement)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    Write-Host "Création du venv..." -ForegroundColor Cyan
    python -m venv .venv
    & .\.venv\Scripts\Activate.ps1
    python -m pip install --upgrade pip
    pip install -r requirements.txt
} else {
    & .\.venv\Scripts\Activate.ps1
}

Write-Host "Démarrage du backend sur http://localhost:8765 ..." -ForegroundColor Green
python server.py
