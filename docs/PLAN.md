# Plan de développement — PremiereAudioSplit

Extension UXP (voie A : backend Python local + Demucs).

## Faits vérifiés (doc UXP, 2026)

- UXP officiel dans Premiere ≥ **25.6** ; UDT ≥ **2.2.1**. ExtendScript supporté jusqu'à sept. 2026.
- `require("premierepro")` : Project / Sequence / tracks / clips / markers, import, in/out, export.
- **`EncoderManager`** : `exportSequence(seq, exportType, out, preset, exportFull)` — `exportFull=false` exporte la région **in/out**. Utilise des presets `.epr` (via AME).
- Manifest **v5** ; `network.domains` supporte `http://localhost:8765` ; `fetch`/`WebSocket` dispos.
- Nouveau : **Hybrid Plugins** (C++ natif) — piste v2 pour embarquer le modèle.

## Phases

| # | Phase | État | Notes |
|---|-------|------|-------|
| 0 | Setup (Premiere 25.6, UDT, venv, sample `premiere-api`) | ⬜ | |
| 1 | Squelette panel + manifest | ✅ scaffoldé | `plugin/` |
| 2 | **POC export section (in/out → WAV)** | 🚧 à valider | brique critique, `premiere.js` |
| 3 | Backend Demucs (FastAPI) | ✅ scaffoldé | `backend/` |
| 4 | Réimport du stem dans la timeline | 🚧 à câbler | `importStem()` TODO(verify) |
| 5 | Robustesse & UX | 🚧 | détection moteur + carte install faites |
| 6 | Packaging + distribution | 🚧 scaffoldé | voir ci-dessous |

## Moteur (mis à jour)

- Demucs remplacé par **`audio-separator`** (modèles UVR).
- Défaut : **Kim Vocal 2** (Mel-Band RoFormer, rapide). Option : **RoFormer** (qualité max).
- Accélération auto : **CUDA** (Windows NVIDIA) / **CoreML** (Mac). Modèles téléchargés à la demande.

## Distribution (Phase 6)

- **Plugin** → `.ccx` (Creative Cloud), identique Mac + Windows.
- **Moteur** → binaire PyInstaller par OS, publié sur **GitHub Releases** via **CI** (`.github/workflows/build-engine.yml`).
  - Windows : installeur Inno Setup (`packaging/windows/installer.iss`) + schéma `audiosplit://` (HKCU).
  - macOS : `.pkg` **non notarisé** (`packaging/macos/`) + schéma via `Info.plist`. Contournement Gatekeeper documenté dans `docs/INSTALL.md`.
- **Install first-run** : le panneau détecte le moteur absent → carte « Installer le moteur » → télécharge l'installeur adapté → ouvre le dossier (`plugin/src/installer.js`).

## À FAIRE pour rendre la distribution opérationnelle

1. Créer le dépôt GitHub, renseigner **`REPO`** dans `plugin/src/installer.js` et le lien d'aide dans `main.js`.
2. Faire une **première passe de build réelle** de la CI (PyInstaller + torch/onnxruntime = ajustements hiddenimports probables).
3. Générer `presets/audio-wav.epr` (Phase 2) et packager le plugin en `.ccx`.
4. Créer un compte Apple *gratuit* → signature ad-hoc uniquement (pas de notarisation).

## Points `TODO(verify)` dans le code (à confirmer sur la vraie API)

1. `seq.getInPoint()/getOutPoint()` — noms/format exacts (TickTime).
2. `Constants.ExportType.IMMEDIATELY` vs `QUEUE`.
3. `project.importFiles([...])` — valeur de retour et bin cible.
4. Insertion d'un clip audio sur une piste à un TickTime + mute de la piste source.

→ Les valider avec le sample officiel **`premiere-api`** (couvre import/export/encoder).

## Ordre recommandé

1. **Phase 2 d'abord** : générer `presets/audio-wav.epr`, charger le plugin dans
   Premiere via UDT, poser des in/out, cliquer « Séparer » et vérifier que le WAV
   de la section est bien produit (sans même lancer le backend).
2. Puis brancher le backend (Phase 3, déjà prêt).
3. Puis fiabiliser le réimport (Phase 4).

## Risques

- Latence de première ouverture d'AME (`launchEncoder`).
- Install du backend Python côté utilisateur final (prévoir PyInstaller en Phase 6).
- Demucs sur CPU = lent ; documenter l'install torch CUDA.
