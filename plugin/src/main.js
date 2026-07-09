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

  // sp-picker/sp-checkbox ne reflètent pas toujours .value/.checked sans
  // interaction : on lit propriété -> attribut -> défaut.
  function readStem() {
    const el = els.stem;
    const v = (el && (el.value || el.getAttribute("value"))) || "both";
    return ["vocals", "no_vocals", "both"].includes(v) ? v : "both";
  }
  function readMute() {
    const el = els.mute;
    if (el && el.checked !== undefined && el.checked !== null) return !!el.checked;
    return el ? el.hasAttribute("checked") : false;
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
      setBusy(true, "1/4 — Clip sélectionné + export…");
      const preset = await presetPath().catch(() => {
        throw new Error(
          "Preset 'presets/audio-wav.epr' manquant. Voir presets/README.md."
        );
      });

      // Tout est piloté par le clip audio sélectionné.
      const selected = await Premiere.getSelectedAudioClip();
      const { file } = await Premiere.exportClip(
        preset,
        selected.startTime,
        selected.endTime
      );
      AppLog.info("Section exportée.");

      setBusy(true, "2/4 — Envoi au modèle…");
      const bytes = await Premiere.readFileBytes(file);

      setBusy(true, "3/4 — Séparation voix / bruit…");
      // On sépare TOUJOURS les deux ; le picker choisit lequel reste audible.
      const keep = readStem();
      const result = await Backend.separate(bytes, file.name, "both", (pct, msg) => {
        els.progress.removeAttribute("indeterminate");
        els.progress.value = pct;
        els.statusText.textContent = `3/4 — ${msg} (${pct}%)`;
      });

      // Contrôle durée : la section exportée doit matcher les stems.
      if (result.durations) {
        const d = result.durations;
        const inDur = d.input;
        for (const k of Object.keys(d)) {
          if (k === "input") continue;
          const match =
            inDur != null && d[k] != null && Math.abs(d[k] - inDur) <= 0.05;
          AppLog.info(
            `Durée ${k}: ${d[k]}s vs section ${inDur}s -> ${
              match ? "MATCH ✅" : "MISMATCH ⚠️"
            }`
          );
        }
      }

      setBusy(true, "4/4 — Réimport dans la timeline…");
      const muteOriginal = readMute();
      // Placement à la position du clip, juste en dessous. Les deux stems sont
      // importés ; `keep` détermine lequel reste audible (l'autre est muté).
      await Premiere.placeStems(
        result.files,
        selected.startTime,
        ["vocals", "no_vocals"],
        selected,
        muteOriginal,
        keep
      );

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
