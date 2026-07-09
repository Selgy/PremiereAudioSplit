#!/usr/bin/env bash
# Construit le .app + .pkg Mac du moteur (NON notarisé — signature ad-hoc).
# Prérequis : pyinstaller a déjà produit ../dist/AudioSplitEngine/
# Usage : bash build-pkg.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DIST="$HERE/../dist/AudioSplitEngine"
APP="$HERE/../dist/AudioSplitEngine.app"
PKG="$HERE/../dist/AudioSplit-Engine-macOS.pkg"
ID="com.premiereaudiosplit.engine"
VERSION="0.1.0"

echo "== Assemblage du .app =="
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
# Copie le bundle PyInstaller dans MacOS/
cp -R "$DIST/." "$APP/Contents/MacOS/"

echo "== Signature ad-hoc (sans compte Apple) =="
# Signature "-" : suffisante pour tourner localement après contournement Gatekeeper.
codesign --force --deep --sign - "$APP" || echo "codesign ad-hoc: à vérifier"

echo "== Construction du .pkg =="
# Installe dans /Applications
pkgbuild \
  --install-location /Applications \
  --identifier "$ID" \
  --version "$VERSION" \
  --component "$APP" \
  "$PKG"

echo "OK -> $PKG"
echo "NB : non notarisé. Voir docs/INSTALL.md pour le contournement Gatekeeper."
