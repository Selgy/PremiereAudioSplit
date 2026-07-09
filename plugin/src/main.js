/*
 * Orchestration UI : câble les boutons, gère l'état du backend, et enchaîne
 * export -> séparation -> réimport.
 */
(() => {
  const byId = (id) => document.getElementById(id);
  const els = {
    check: byId("btn-check"),
    run: byId("btn-run"),
    stemSeg: byId("stem-select"),
    muteToggle: byId("mute-toggle"),
    statusPill: byId("backend-status"),
    statusLabel: byId("backend-label"),
    statusText: byId("status-text"),
    progress: byId("progress"),
    progressBar: document.querySelector("#progress .bar"),
    installCard: byId("install-card"),
    install: byId("btn-install"),
    installHelp: byId("install-help"),
    logToggle: byId("log-toggle"),
    log: byId("log"),
  };

  function showInstallCard(show) {
    els.installCard.style.display = show ? "flex" : "none";
  }

  // Contrôle segmenté : la valeur = data-value du bouton actif.
  function readStem() {
    const active = els.stemSeg.querySelector(".seg.active");
    const v = active ? active.dataset.value : "both";
    return ["vocals", "no_vocals", "both"].includes(v) ? v : "both";
  }
  // Toggle : data-on = "true"/"false".
  function readMute() {
    return els.muteToggle.dataset.on !== "false";
  }

  // Progression : barre custom (largeur %) + mode indéterminé animé.
  function setProgress(pct) {
    els.progress.classList.remove("indeterminate");
    els.progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  let backendReady = false;

  function setBackendState(state, label) {
    els.statusPill.className = `pill pill--${state}`;
    els.statusLabel.textContent = label;
    backendReady = state === "ok";
    els.run.disabled = !backendReady;
  }

  function setBusy(busy, text) {
    els.progress.style.display = busy ? "block" : "none";
    if (busy) els.progress.classList.add("indeterminate");
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
        // openExternal a échoué -> le schéma audiosplit:// n'est pas enregistré
        // -> le moteur n'est pas installé.
        notInstalled = true;
        AppLog.warn("Schéma audiosplit:// indisponible : moteur non installé.");
      }
    }

    if (h.ok) {
      setBackendState("ok", `Prêt (${h.device || "cpu"})`);
      showInstallCard(false);
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
    try {
      setBusy(true, "1/3 — Clip sélectionné…");
      // Tout est piloté par le clip audio sélectionné.
      const selected = await Premiere.getSelectedAudioClip();
      const src = await Premiere.getClipAudioSource(selected);

      setBusy(true, "2/3 — Extraction + séparation (GPU)…");
      // On sépare TOUJOURS les deux ; le picker choisit lequel reste audible.
      const keep = readStem();
      const result = await Backend.separateClip(
        src.mediaPath,
        src.start,
        src.end,
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

      setBusy(false, "✅ Terminé. Stems ajoutés à la timeline.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
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

  // Contrôle segmenté « Garder audible ».
  els.stemSeg.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", () => {
      els.stemSeg.querySelectorAll(".seg").forEach((s) => s.classList.remove("active"));
      seg.classList.add("active");
    });
  });

  // Toggle « Muter l'audio d'origine ».
  els.muteToggle.addEventListener("click", () => {
    const on = els.muteToggle.dataset.on !== "false";
    els.muteToggle.dataset.on = (!on).toString();
    els.muteToggle.classList.toggle("on", !on);
  });

  // Journal repliable.
  els.logToggle.addEventListener("click", () => {
    els.log.classList.toggle("collapsed");
  });

  // Vérification au démarrage.
  checkBackend();
})();
