# Packaging & release

Deux livrables : le **moteur** (installeurs par OS, construits par la CI) et le
**plugin** (`.ccx`, packagé à la main via UDT).

## 1. Moteur — via GitHub Actions (auto)

La CI [`build-engine.yml`](../.github/workflows/build-engine.yml) construit et publie
les installeurs à chaque tag `v*` :

```bash
git tag v0.1.0
git push origin v0.1.0
```

Produit et attache à la release :
- `AudioSplit-Engine-Windows.exe` (Inno Setup, enregistre le schéma `audiosplit://`)
- `AudioSplit-Engine-macOS.pkg` (non notarisé, signature ad-hoc)

Le moteur embarque **ffmpeg** (via `imageio-ffmpeg`, collecté par PyInstaller) et
télécharge les modèles à la demande. Build **CPU** par défaut (compatible partout).

> Re-taguer une version existante : `git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0`
> puis recréer le tag sur le nouveau commit.

### Notes build
- **MAX_PATH Windows** : torch a des chemins profonds ; la CI copie le build vers
  `C:\ase` (court) avant Inno Setup (`/DDistDir`). Ne pas retirer.
- **PyInstaller** : `packaging/AudioSplitEngine.spec`. Si un import manque au
  runtime, l'ajouter à `_pkgs` (collect_all).

## 2. Plugin — build (SWC/React) puis `.ccx` via UDT

L'UI est en **Spectrum Web Components** (React + webpack) → il faut **builder** avant.

```bash
cd plugin
yarn install     # une fois
yarn build       # produit plugin/dist/
```

Puis packaging via l'UXP Developer Tool (le `.ccx` ne se signe pas) :

1. Ouvre **UXP Developer Tool**.
2. Ajoute le plugin en pointant sur **`plugin/dist/manifest.json`** (le build, pas les sources).
3. Menu **•••** de la ligne du plugin → **Package**.
4. Renomme le fichier produit en **`AudioSplit.ccx`**.
5. Attache-le à la [release GitHub](https://github.com/Selgy/PremiereAudioSplit/releases)
   du même tag.

> Dev : `yarn watch` rebuild à chaque modif ; recharge ensuite dans UDT.

> ID plugin : garder un ID **différent** de celui du Marketplace pour éviter les
> conflits d'installation (voir `manifest.json`).

## 3. Checklist release

- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` → CI verte, 2 installeurs attachés
- [ ] UDT → Package → `AudioSplit.ccx` → attaché à la release
- [ ] Tester : installer le `.ccx` (double-clic) + « Installer le moteur » sur une
      machine propre
- [ ] Mettre à jour la version dans `manifest.json` et `installer.iss` si besoin

## macOS (Gatekeeper)

Le `.pkg` n'est pas notarisé (pas de compte Apple Developer). L'utilisateur doit
autoriser manuellement — voir [INSTALL.md](INSTALL.md#macos). Pour notariser plus
tard : compte Apple Developer + `xcrun notarytool` dans la CI macOS.
