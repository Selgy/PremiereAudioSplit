# PremiereAudioSplit

Extension **UXP pour Adobe Premiere Pro** qui prend l'audio d'une section de la timeline
(points in/out), le sépare en **voix** / **bruit de fond** via un modèle (Demucs), et
réimporte le stem « voix » dans le projet.

## Architecture

```
┌───────────────────────┐   fetch / WebSocket    ┌──────────────────────────┐
│  Panel UXP (plugin/)   │ ─────────────────────► │  Backend Python (backend/)│
│  - UI HTML/JS/CSS      │                        │  FastAPI + Demucs         │
│  - API premierepro     │ ◄───────────────────── │  htdemucs (vocals/noise)  │
└───────────────────────┘   stems .wav séparés    └──────────────────────────┘
        │ 1. exportSequence(in/out) -> section.wav
        │ 4. import vocals.wav -> nouvelle piste audio
        ▼
   Timeline Premiere
```

Flux :
1. **Export** de la région in/out de la séquence active en WAV via `EncoderManager.exportSequence(..., exportFull=false)` + preset `.epr` audio.
2. **Envoi** du WAV au backend local (`POST http://localhost:8765/separate`).
3. **Séparation** Demucs → `vocals.wav` + `no_vocals.wav`.
4. **Réimport** du stem voix dans le projet, calé sur le point d'entrée.

## Prérequis

- **Premiere Pro ≥ 25.6**
- **UXP Developer Tools ≥ 2.2.1** (pour charger/débugger le plugin)
- **Python ≥ 3.10** + un GPU conseillé (CPU fonctionne mais lent)
- **Adobe Media Encoder** (utilisé par `exportSequence`)

## Démarrage rapide

### 1. Backend (installation one-time)
```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
`install.ps1` crée le venv, installe Demucs/PyTorch (**plusieurs Go**), et enregistre
le schéma d'URL `audiosplit://`. Après ça, **le panneau démarre le backend tout seul**
à son ouverture (via `shell.openExternal`, lancé sans fenêtre par `pythonw`).

Pour un lancement manuel/debug en avant-plan : `.\run.ps1`.

### 2. Preset d'export audio
Voir [presets/README.md](presets/README.md) pour générer `audio-wav.epr` une fois
depuis Media Encoder, puis le placer dans `presets/`.

### 3. Plugin UXP
- Ouvrir **UXP Developer Tools** → *Add Plugin* → sélectionner `plugin/manifest.json`
- *Load* → le panneau apparaît dans Premiere (menu *Window > Extensions*)

## État d'avancement

Voir les phases dans [docs/PLAN.md](docs/PLAN.md).
Le POC critique est la **Phase 2** (export de la section) : à valider en premier.

## Structure

```
plugin/      Extension UXP (HTML/JS/CSS + manifest)
backend/     Serveur FastAPI + séparation Demucs
presets/     Presets .epr d'export audio (à générer localement)
docs/        Plan détaillé
```
