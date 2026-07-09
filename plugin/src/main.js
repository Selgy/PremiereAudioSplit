/*
 * Orchestration UI : câble les boutons, gère l'état du backend, et enchaîne
 * export -> séparation -> réimport.
 */
(() => {
  const els = {
    check: document.getElementById("btn-check"),
    run: document.getElementById("btn-run"),
    stem: document.getElementById("stem-select"),
    mute: document.getElementById("mute-original"),
    status: document.getElementById("backend-status"),
    statusLabel: document.getElementById("backend-label"),
    statusText: document.getElementById("status-text"),
    progress: document.getElementById("progress"),
    installCard: document.getElementById("install-card"),
    install: document.getElementById("btn-install"),
    installHelp: document.getElementById("install-help"),
  };

  function showInstallCard(show) {
    els.installCard.style.display = show ? "flex" : "none";
  }

  let backendReady = false;

  function setBackendState(state, label) {
    els.status.className = `status status--${state}`;
    els.statusLabel.textContent = `Backend : ${label}`;
    backendReady = state === "ok";
    els.run.disabled = !backendReady;
  }

  function setBusy(busy, text) {
    els.progress.style.display = busy ? "block" : "none";
    els.run.disabled = busy || !backendReady;
    els.check.disabled = busy;
    if (text) els.statusText.textContent = text;
  }

  // Vérifie le backend, et le démarre automatiquement s'il est hors ligne.
  async function checkBackend({ autostart = true } = {}) {
    setBackendState("busy", "vérification…");
    let h = await Backend.health();

    let notInstalled = false;
    if (!h.ok && autostart) {
      AppLog.info("Backend hors ligne — tentative de démarrage automatique…");
      els.statusText.textContent = "Démarrage du moteur de séparation…";
      const launched = await Backend.autostart();
      if (launched) {
        h = await Backend.waitUntilReady(20000, (n) => {
          els.statusText.textContent = `Démarrage du moteur… (${n})`;
        });
      } else {
        // openExternal a échoué -> le schéma audiosplit:// n'est pas enregistré
        // -> le moteur n'est pas installé.
        notInstalled = true;
        AppLog.warn("Schéma audiosplit:// indisponible : moteur non installé.");
      }
    }

    if (h.ok) {
      setBackendState("ok", `prêt (${h.device || "cpu"})`);
      showInstallCard(false);
      els.statusText.textContent =
        "Prêt. Sélectionne une région (in/out) dans la timeline.";
      AppLog.info("Backend OK", h);
    } else if (notInstalled) {
      setBackendState("down", "non installé");
      showInstallCard(true);
      els.statusText.textContent =
        "Moteur non installé. Clique « Installer le moteur ».";
    } else {
      setBackendState("down", "hors ligne");
      showInstallCard(false);
      els.statusText.textContent =
        "Moteur installé mais injoignable. Réessaie « Vérifier le backend ».";
      AppLog.warn("Backend injoignable :", h.reason);
    }
  }

  // Bouton « Installer le moteur » : télécharge l'installeur et ouvre le dossier.
  async function installEngine() {
    try {
      els.install.disabled = true;
      setBusy(true, "Téléchargement de l'installeur du moteur…");
      const { folder } = await Installer.downloadInstaller((pct, msg) => {
        els.progress.removeAttribute("indeterminate");
        els.progress.value = pct;
        els.statusText.textContent = `${msg} (${pct}%)`;
      });
      await Installer.revealInstaller(folder);
      setBusy(false,
        "Installeur téléchargé. Double-clique-le, suis l'installation, puis reviens ici.");
      els.progress.setAttribute("indeterminate", "");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
    } finally {
      els.install.disabled = false;
    }
  }

  // Chemin du preset .epr embarqué avec le plugin.
  async function presetPath() {
    const uxp = require("uxp");
    const pluginFolder = await uxp.storage.localFileSystem.getPluginFolder();
    // presets copiés dans le plugin au packaging (voir presets/README.md)
    const preset = await pluginFolder.getEntry("presets/audio-wav.epr");
    return preset.nativePath;
  }

  async function run() {
    try {
      setBusy(true, "1/4 — Export de la section (in/out)…");
      const preset = await presetPath().catch(() => {
        throw new Error(
          "Preset 'presets/audio-wav.epr' manquant. Voir presets/README.md."
        );
      });

      const { file, inPoint } = await Premiere.exportSection(preset);
      AppLog.info("Section exportée.");

      setBusy(true, "2/4 — Envoi au modèle…");
      const bytes = await Premiere.readFileBytes(file);

      setBusy(true, "3/4 — Séparation voix / bruit…");
      const stems = els.stem.value;
      const result = await Backend.separate(bytes, file.name, stems, (pct, msg) => {
        els.progress.removeAttribute("indeterminate");
        els.progress.value = pct;
        els.statusText.textContent = `3/4 — ${msg} (${pct}%)`;
      });

      setBusy(true, "4/4 — Réimport dans la timeline…");
      const muteOriginal = !!els.mute.checked;
      const wanted =
        stems === "both" ? ["vocals", "no_vocals"] : [stems];
      for (const key of wanted) {
        const p = result.files && result.files[key];
        if (p) await Premiere.importStem(p, inPoint, muteOriginal && key === "vocals");
      }

      setBusy(false, "✅ Terminé. Stem(s) ajouté(s) à la timeline.");
      els.progress.setAttribute("indeterminate", "");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
      els.progress.setAttribute("indeterminate", "");
    }
  }

  els.check.addEventListener("click", () => checkBackend());
  els.run.addEventListener("click", run);
  els.install.addEventListener("click", installEngine);
  els.installHelp.addEventListener("click", (e) => {
    e.preventDefault();
    require("uxp").shell.openExternal(
      "https://github.com/Selgy/PremiereAudioSplit#installation",
      "Ouverture de l'aide d'installation"
    );
  });

  // Vérification au démarrage.
  checkBackend();
})();
