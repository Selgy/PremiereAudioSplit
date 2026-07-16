/*
 * Installeur first-run du moteur de séparation.
 *
 * UXP ne peut pas EXÉCUTER un installeur (pas de spawn ; openPath ne lance pas
 * les .exe). Stratégie : télécharger le bon installeur selon l'OS, l'écrire sur
 * le disque, puis OUVRIR le dossier (openPath) pour que l'utilisateur
 * double-clique une fois. C'est le maximum possible dans les limites d'UXP.
 */
export const Installer = (() => {
  // ⚙️ CONFIG — dépôt GitHub hébergeant les releases du moteur.
  const REPO = "Selgy/PremiereAudioSplit";

  const ASSETS = {
    win32: "AudioSplit-Engine-Windows.exe",
    darwin: "AudioSplit-Engine-macOS.pkg",
  };

  function platform() {
    try {
      return require("os").platform(); // "win32" | "darwin"
    } catch (e) {
      const p = (navigator.platform || "").toLowerCase();
      if (p.includes("win")) return "win32";
      if (p.includes("mac")) return "darwin";
      return "unknown";
    }
  }

  function isConfigured() {
    return /^[^/]+\/[^/]+$/.test(REPO);
  }

  function assetUrl(plat) {
    const name = ASSETS[plat];
    if (!name) return null;
    // Dernière release publiée par la CI.
    return `https://github.com/${REPO}/releases/latest/download/${name}`;
  }

  /*
   * Télécharge l'installeur adapté à l'OS et le range dans un dossier temporaire.
   * @returns {Promise<{folder:any, file:any, plat:string}>}
   */
  async function downloadInstaller(onProgress) {
    const plat = platform();
    const url = assetUrl(plat);
    if (!url) throw new Error(`OS non supporté : ${plat}`);
    if (!isConfigured()) {
      throw new Error(
        "Hébergement non configuré (REPO dans installer.js). Voir docs/INSTALL.md."
      );
    }

    if (onProgress) onProgress(0, "Téléchargement de l'installeur…");
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Téléchargement échoué (HTTP ${res.status}).`);
    }
    const buf = await res.arrayBuffer();

    const uxp = require("uxp");
    const fs = uxp.storage.localFileSystem;
    const folder = await fs.getTemporaryFolder();
    const file = await folder.createFile(ASSETS[plat], { overwrite: true });
    await file.write(buf, { format: uxp.storage.formats.binary });
    if (onProgress) onProgress(100, "Téléchargé");
    return { folder, file, plat };
  }

  /* Ouvre le dossier contenant l'installeur pour que l'utilisateur le lance. */
  async function revealInstaller(folder) {
    const { shell } = require("uxp");
    await shell.openPath(
      folder.nativePath,
      "Ouverture du dossier de l'installeur du moteur"
    );
  }

  return { platform, isConfigured, assetUrl, downloadInstaller, revealInstaller };
})();
