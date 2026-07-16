/*
 * Orchestration UI (design custom : contrôles div, pastille coulissante animée).
 * Gère l'état backend et enchaîne clip -> extraction/séparation -> réimport.
 */
(() => {
  const byId = (id) => document.getElementById(id);
  const els = {
    check: byId("btn-check"),
    run: byId("btn-run"),
    stem: byId("stem-select"),
    quality: byId("quality-select"),
    muteToggle: byId("mute-toggle"),
    statusEl: byId("backend-status"),
    statusLabel: byId("backend-label"),
    statusText: byId("status-text"),
    progress: byId("progress"),
    progressBar: document.querySelector("#progress .bar"),
    installCard: byId("install-card"),
    install: byId("btn-install"),
    installHelp: byId("install-help"),
    settingsToggle: byId("settings-toggle"),
    settingsBody: byId("settings-body"),
    copy: byId("btn-copy"),
    logToggle: byId("log-toggle"),
    log: byId("log"),
  };

  const TRIGGER_URL = "http://localhost:8765/trigger";
  const KNOB_ON = 22; // track 46 - knob 21 - 3
  const KNOB_OFF = 3;

  let backendReady = false;
  let running = false;
  let modelDefaulted = false;

  /* ---------- Animation JS (UXP n'a pas de transition/animation CSS) ---------- */
  function animateProp(el, prop, to, unit, dur) {
    const from = parseFloat(el.style[prop]) || 0;
    const start = Date.now();
    (function tick() {
      const t = Math.min(1, (Date.now() - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.style[prop] = from + (to - from) * e + unit;
      if (t < 1) setTimeout(tick, 16);
    })();
  }

  /* ---------- Contrôles segmentés ---------- */
  function segWidth(group) {
    return 100 / group.querySelectorAll(".seg").length;
  }
  function readSeg(group, allowed, def) {
    const a = group.querySelector(".seg.active");
    const v = a ? a.dataset.value : def;
    return allowed.includes(v) ? v : def;
  }
  function setSeg(group, value) {
    const segs = Array.from(group.querySelectorAll(".seg"));
    const idx = segs.findIndex((s) => s.dataset.value === value);
    if (idx < 0) return;
    segs.forEach((s) => s.classList.remove("active"));
    segs[idx].classList.add("active");
    const ind = group.querySelector(".seg-ind");
    ind.style.left = idx * segWidth(group) + "%";
  }
  function initSegmented(group) {
    const segs = Array.from(group.querySelectorAll(".seg"));
    const ind = group.querySelector(".seg-ind");
    const w = segWidth(group);
    ind.style.width = w + "%";
    let ai = segs.findIndex((s) => s.classList.contains("active"));
    if (ai < 0) ai = 0;
    ind.style.left = ai * w + "%";
    segs.forEach((seg, i) => {
      seg.addEventListener("click", () => {
        segs.forEach((s) => s.classList.remove("active"));
        seg.classList.add("active");
        animateProp(ind, "left", i * w, "%", 200);
        saveSettings();
      });
    });
  }

  /* ---------- Toggle ---------- */
  function setToggle(on) {
    els.muteToggle.dataset.on = on ? "true" : "false";
    els.muteToggle.classList.toggle("on", on);
    els.muteToggle.querySelector(".knob").style.left = (on ? KNOB_ON : KNOB_OFF) + "px";
  }

  /* ---------- Lecture des réglages ---------- */
  function readStem() {
    return readSeg(els.stem, ["vocals", "no_vocals", "both"], "both");
  }
  function readQuality() {
    return readSeg(els.quality, ["kim_vocal_2", "mel_roformer", "bs_roformer"], "kim_vocal_2");
  }
  function readMute() {
    return els.muteToggle.dataset.on !== "false";
  }

  /* ---------- Persistance ---------- */
  function saveSettings() {
    try {
      localStorage.setItem("as_stem", readStem());
      localStorage.setItem("as_quality", readQuality());
      localStorage.setItem("as_mute", readMute() ? "true" : "false");
    } catch (e) {}
  }
  function loadSettings() {
    try {
      const s = localStorage.getItem("as_stem");
      const q = localStorage.getItem("as_quality");
      const m = localStorage.getItem("as_mute");
      if (s) setSeg(els.stem, s);
      if (q) { setSeg(els.quality, q); modelDefaulted = true; }
      if (m !== null) setToggle(m === "true");
    } catch (e) {}
  }

  /* ---------- Boutons (div) : état désactivé par classe ---------- */
  function setDisabled(el, disabled) { el.classList.toggle("is-disabled", !!disabled); }
  const isDisabled = (el) => el.classList.contains("is-disabled");

  /* ---------- Progression (pulse JS) ---------- */
  let pulseTimer = null;
  function startPulse() {
    stopPulse();
    let w = 8, dir = 1;
    els.progressBar.style.width = w + "%";
    pulseTimer = setInterval(() => {
      w += dir * 7;
      if (w >= 92) { w = 92; dir = -1; }
      else if (w <= 8) { w = 8; dir = 1; }
      els.progressBar.style.width = w + "%";
    }, 110);
  }
  function stopPulse() { if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; } }
  function setProgress(pct) {
    stopPulse();
    els.progressBar.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  function showInstallCard(show) {
    els.installCard.style.display = show ? "flex" : "none";
  }

  function setBackendState(state, label) {
    els.statusEl.className = `pill pill--${state}`;
    els.statusLabel.textContent = label;
    backendReady = state === "ok";
    setDisabled(els.run, !backendReady);
  }

  function setBusy(busy, text) {
    els.progress.style.display = busy ? "block" : "none";
    if (busy) startPulse();
    else stopPulse();
    setDisabled(els.run, busy || !backendReady);
    setDisabled(els.check, busy);
    if (text) els.statusText.textContent = text;
  }

  async function copyToClipboard(text) {
    const cb = navigator.clipboard;
    try { if (cb && cb.setContent) { await cb.setContent({ "text/plain": text }); return true; } } catch (e) {}
    try { if (cb && cb.writeText) { await cb.writeText(text); return true; } } catch (e) {}
    return false;
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
      if (!modelDefaulted) {
        modelDefaulted = true;
        setSeg(els.quality, h.device === "cuda" ? "mel_roformer" : "kim_vocal_2");
      }
      els.statusText.textContent = "Prêt. Sélectionne un clip audio dans la timeline.";
      AppLog.info("Backend OK", h);
    } else if (notInstalled) {
      setBackendState("down", "Non installé");
      showInstallCard(true);
      els.statusText.textContent = "Moteur non installé. Clique « Installer le moteur ».";
    } else {
      setBackendState("down", "Hors ligne");
      showInstallCard(false);
      els.statusText.textContent = "Moteur injoignable. Réessaie « Vérifier le backend ».";
      AppLog.warn("Backend injoignable :", h.reason);
    }
  }

  async function installEngine() {
    try {
      setDisabled(els.install, true);
      setBusy(true, "Téléchargement de l'installeur du moteur…");
      const { folder } = await Installer.downloadInstaller((pct, msg) => {
        setProgress(pct);
        els.statusText.textContent = `${msg} (${pct}%)`;
      });
      await Installer.revealInstaller(folder);
      setBusy(false, "Installeur téléchargé. Double-clique-le, installe, puis reviens ici.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
    } finally {
      setDisabled(els.install, false);
    }
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      setBusy(true, "1/3 — Clip sélectionné…");
      const selected = await Premiere.getSelectedAudioClip();
      const src = await Premiere.getClipAudioSource(selected);

      setBusy(true, "2/3 — Extraction + séparation…");
      const keep = readStem();
      const model = readQuality();
      const result = await Backend.separateClip(
        src.mediaPath, src.start, src.end, model,
        (pct, msg) => { setProgress(pct); els.statusText.textContent = `2/3 — ${msg} (${pct}%)`; }
      );

      if (result.durations) {
        const d = result.durations;
        for (const k of Object.keys(d)) {
          if (k === "input") continue;
          const match = d.input != null && d[k] != null && Math.abs(d[k] - d.input) <= 0.05;
          AppLog.info(`Durée ${k}: ${d[k]}s vs clip ${d.input}s -> ${match ? "MATCH ✅" : "MISMATCH ⚠️"}`);
        }
      }

      setBusy(true, "3/3 — Réimport dans la timeline…");
      await Premiere.placeStems(
        result.files, selected.startTime, ["vocals", "no_vocals"], selected, readMute(), keep
      );

      setBusy(false, "✅ Terminé. Stems ajoutés à la timeline.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      setBusy(false, `❌ ${e.message || e}`);
    } finally {
      running = false;
    }
  }

  /* ---------- Câblage ---------- */
  els.check.addEventListener("click", () => { if (!isDisabled(els.check)) checkBackend(); });
  els.run.addEventListener("click", () => { if (!isDisabled(els.run)) run(); });
  els.install.addEventListener("click", () => { if (!isDisabled(els.install)) installEngine(); });
  els.installHelp.addEventListener("click", () => {
    require("uxp").shell.openExternal(
      "https://github.com/Selgy/PremiereAudioSplit#installation",
      "Ouverture de l'aide d'installation"
    );
  });

  initSegmented(els.stem);
  initSegmented(els.quality);
  setToggle(els.muteToggle.dataset.on !== "false");
  els.muteToggle.addEventListener("click", () => {
    const now = els.muteToggle.dataset.on === "false";
    els.muteToggle.dataset.on = now ? "true" : "false";
    els.muteToggle.classList.toggle("on", now);
    animateProp(els.muteToggle.querySelector(".knob"), "left", now ? KNOB_ON : KNOB_OFF, "px", 160);
    saveSettings();
  });

  els.settingsToggle.addEventListener("click", () => els.settingsBody.classList.toggle("collapsed"));
  els.logToggle.addEventListener("click", () => els.log.classList.toggle("collapsed"));
  els.copy.addEventListener("click", async () => {
    const ok = await copyToClipboard(TRIGGER_URL);
    els.statusText.textContent = ok ? "URL du déclencheur copiée ✅" : `URL : ${TRIGGER_URL}`;
  });

  loadSettings();

  // Fondu à l'ouverture.
  (function fadeIn() {
    const app = document.querySelector(".app");
    app.style.opacity = "0";
    setTimeout(() => animateProp(app, "opacity", 1, "", 320), 30);
  })();

  // Déclenchement externe (Stream Deck).
  setInterval(async () => {
    if (!backendReady || running) return;
    if (await Backend.pollTrigger()) { AppLog.info("Déclenché via Stream Deck."); run(); }
  }, 1200);

  checkBackend();
})();
