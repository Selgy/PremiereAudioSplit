/*
 * Orchestration UI (widgets Spectrum sp-*) : câble les contrôles, gère l'état
 * du backend, et enchaîne clip sélectionné -> extraction/séparation -> réimport.
 */
(() => {
  const byId = (id) => document.getElementById(id);
  const els = {
    check: byId("btn-check"),
    run: byId("btn-run"),
    stem: byId("stem-select"),
    quality: byId("quality-select"),
    mute: byId("mute-original"),
    statusEl: byId("backend-status"),
    statusLabel: byId("backend-label"),
    statusText: byId("status-text"),
    progress: byId("progress"),
    installCard: byId("install-card"),
    install: byId("btn-install"),
    installHelp: byId("install-help"),
    logToggle: byId("log-toggle"),
    log: byId("log"),
  };

  function showInstallCard(show) {
    els.installCard.style.display = show ? "flex" : "none";
  }

  // Lecture des contrôles Spectrum (propriété -> attribut -> défaut).
  function readStem() {
    const v = els.stem.selected || els.stem.getAttribute("selected") || "both";
    return ["vocals", "no_vocals", "both"].includes(v) ? v : "both";
  }
  function readQuality() {
    const v =
      els.quality.selected || els.quality.getAttribute("selected") || "mel_roformer";
    return ["kim_vocal_2", "mel_roformer", "bs_roformer"].includes(v)
      ? v
      : "mel_roformer";
  }
  function readMute() {
    if (els.mute.checked !== undefined && els.mute.checked !== null)
      return !!els.mute.checked;
    return els.mute.hasAttribute("checked");
  }

  function setProgress(pct) {
    els.progress.removeAttribute("indeterminate");
    els.progress.value = Math.max(0, Math.min(100, pct));
  }

  let backendReady = false;
  let running = false;
  let modelDefaulted = false;

  function setBackendState(state, label) {
    els.statusEl.className = `status status--${state}`;
    els.statusLabel.textContent = label;
    backendReady = state === "ok";
    els.run.disabled = !backendReady;
  }

  function setBusy(busy, text) {
    els.progress.style.display = busy ? "block" : "none";
    if (busy) els.progress.setAttribute("indeterminate", "");
    els.run.disabled = busy || !backendReady;
    els.check.disabled = busy;
    if (text) els.statusText.textContent = text;
  }

  // Vérifie le backend, et le démarre automatiquement s'il est hors ligne.
  async function checkBackend({ autostart = true } = {}) {
    setBackendState("busy", "Vérification…");
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
        notInstalled = true;
        AppLog.warn("Schéma audiosplit:// indisponible : moteur non installé.");
      }
    }

    if (h.ok) {
      setBackendState("ok", `Prêt (${h.device || "cpu"})`);
      showInstallCard(false);
      // Défaut modèle selon le matériel : GPU -> Max, sinon Rapide (RoFormer
      // très lent en CPU). L'utilisateur peut toujours changer.
      if (!modelDefaulted) {
        modelDefaulted = true;
        const def = h.device === "cuda" ? "mel_roformer" : "kim_vocal_2";
        try { els.quality.selected = def; } catch (e) {}
      }
      els.statusText.textContent =
        "Prêt. Sélectionne un clip audio dans la timeline.";
      AppLog.info("Backend OK", h);
    } else if (notInstalled) {
      setBackendState("down", "Non installé");
      showInstallCard(true);
      els.statusText.textContent =
        "Moteur non installé. Clique « Installer le moteur ».";
    } else {
      setBackendState("down", "Hors ligne");
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
        setProgress(pct);
        els.statusText.textContent = `${msg} (${pct}%)`;
      });
      await Installer.revealInstaller(folder);
      setBusy(false,
        "Installeur téléchargé. Double-clique-le, suis l'installation, puis reviens ici.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
    } finally {
      els.install.disabled = false;
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      setBusy(true, "1/3 — Clip sélectionné…");
      const selected = await Premiere.getSelectedAudioClip();
      const src = await Premiere.getClipAudioSource(selected);

      setBusy(true, "2/3 — Extraction + séparation (GPU)…");
      const keep = readStem();
      const model = readQuality();
      const result = await Backend.separateClip(
        src.mediaPath,
        src.start,
        src.end,
        model,
        (pct, msg) => {
          setProgress(pct);
          els.statusText.textContent = `2/3 — ${msg} (${pct}%)`;
        }
      );

      // Contrôle durée : le clip extrait doit matcher les stems.
      if (result.durations) {
        const d = result.durations;
        const inDur = d.input;
        for (const k of Object.keys(d)) {
          if (k === "input") continue;
          const match =
            inDur != null && d[k] != null && Math.abs(d[k] - inDur) <= 0.05;
          AppLog.info(
            `Durée ${k}: ${d[k]}s vs clip ${inDur}s -> ${
              match ? "MATCH ✅" : "MISMATCH ⚠️"
            }`
          );
        }
      }

      setBusy(true, "3/3 — Réimport dans la timeline…");
      const muteOriginal = readMute();
      await Premiere.placeStems(
        result.files,
        selected.startTime,
        ["vocals", "no_vocals"],
        selected,
        muteOriginal,
        keep
      );

      setBusy(false, "✅ Terminé. Stems ajoutés à la timeline.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
    } finally {
      running = false;
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
  els.logToggle.addEventListener("click", () => {
    els.log.classList.toggle("collapsed");
  });

  // Force la sélection par défaut (l'attribut selected ne suffit pas toujours).
  try { els.stem.selected = "both"; } catch (e) {}
  try { els.quality.selected = "mel_roformer"; } catch (e) {}

  // Déclenchement externe (Stream Deck) : on relève le drapeau backend ~1x/s.
  setInterval(async () => {
    if (!backendReady || running) return;
    if (await Backend.pollTrigger()) {
      AppLog.info("Déclenché via Stream Deck.");
      run();
    }
  }, 1200);

  // Vérification au démarrage.
  checkBackend();
})();
