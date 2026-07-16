import React, { useEffect, useRef, useState } from "react";
import { Button } from "@swc-react/button";
import { RadioGroup, Radio } from "@swc-react/radio";
import { Switch } from "@swc-react/switch";
import { FieldLabel } from "@swc-react/field-label";

import { AppLog } from "./log.js";
import { Backend } from "./backend.js";
import { Installer } from "./installer.js";
import { Premiere } from "./premiere.js";

const TRIGGER_URL = "http://localhost:8765/trigger";

const load = (k, def) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? def : v;
  } catch (e) {
    return def;
  }
};

export default function App() {
  const [stem, setStem] = useState(() => load("as_stem", "both"));
  const [quality, setQuality] = useState(() => load("as_quality", "mel_roformer"));
  const [mute, setMute] = useState(() => load("as_mute", "true") === "true");

  const [status, setStatus] = useState({ state: "unknown", label: "…" });
  const [statusText, setStatusText] = useState("Sélectionne un clip audio dans la timeline.");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // null=caché, -1=pulse, 0..100
  const [installVisible, setInstallVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const readyRef = useRef(false);
  const runningRef = useRef(false);
  const modelDefaulted = useRef(false);
  const stemRef = useRef(stem);
  const qualityRef = useRef(quality);
  const muteRef = useRef(mute);
  useEffect(() => { stemRef.current = stem; }, [stem]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { muteRef.current = mute; }, [mute]);

  // Persistance
  useEffect(() => { try { localStorage.setItem("as_stem", stem); } catch (e) {} }, [stem]);
  useEffect(() => {
    try { localStorage.setItem("as_quality", quality); } catch (e) {}
    modelDefaulted.current = true;
  }, [quality]);
  useEffect(() => { try { localStorage.setItem("as_mute", mute ? "true" : "false"); } catch (e) {} }, [mute]);

  function busyOn(text) { setBusy(true); setProgress(-1); if (text) setStatusText(text); }
  function busyOff(text) { setBusy(false); setProgress(null); if (text) setStatusText(text); }

  async function checkBackend() {
    setStatus({ state: "busy", label: "Vérification…" });
    let h = await Backend.health();
    let notInstalled = false;
    if (!h.ok) {
      setStatusText("Démarrage du moteur de séparation…");
      const launched = await Backend.autostart();
      if (launched) {
        h = await Backend.waitUntilReady(20000, (n) => setStatusText(`Démarrage du moteur… (${n})`));
      } else {
        notInstalled = true;
      }
    }
    if (h.ok) {
      readyRef.current = true;
      setStatus({ state: "ok", label: `Prêt (${h.device || "cpu"})` });
      setInstallVisible(false);
      if (!modelDefaulted.current) {
        modelDefaulted.current = true;
        setQuality(h.device === "cuda" ? "mel_roformer" : "kim_vocal_2");
      }
      setStatusText("Prêt. Sélectionne un clip audio dans la timeline.");
    } else if (notInstalled) {
      readyRef.current = false;
      setStatus({ state: "down", label: "Non installé" });
      setInstallVisible(true);
      setStatusText("Moteur non installé. Clique « Installer le moteur ».");
    } else {
      readyRef.current = false;
      setStatus({ state: "down", label: "Hors ligne" });
      setInstallVisible(false);
      setStatusText("Moteur injoignable. Réessaie « Vérifier le backend ».");
    }
  }

  async function installEngine() {
    try {
      busyOn("Téléchargement de l'installeur du moteur…");
      const { folder } = await Installer.downloadInstaller((pct, msg) => {
        setProgress(pct); setStatusText(`${msg} (${pct}%)`);
      });
      await Installer.revealInstaller(folder);
      busyOff("Installeur téléchargé. Double-clique-le, installe, puis reviens ici.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      busyOff(`❌ ${e.message || e}`);
    }
  }

  async function run() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      busyOn("1/3 — Clip sélectionné…");
      const selected = await Premiere.getSelectedAudioClip();
      const src = await Premiere.getClipAudioSource(selected);

      busyOn("2/3 — Extraction + séparation…");
      const keep = stemRef.current;
      const result = await Backend.separateClip(
        src.mediaPath, src.start, src.end, qualityRef.current,
        (pct, msg) => { setProgress(pct); setStatusText(`2/3 — ${msg} (${pct}%)`); }
      );

      if (result.durations) {
        const d = result.durations;
        for (const k of Object.keys(d)) {
          if (k === "input") continue;
          const match = d.input != null && d[k] != null && Math.abs(d[k] - d.input) <= 0.05;
          AppLog.info(`Durée ${k}: ${d[k]}s vs clip ${d.input}s -> ${match ? "MATCH ✅" : "MISMATCH ⚠️"}`);
        }
      }

      busyOn("3/3 — Réimport dans la timeline…");
      await Premiere.placeStems(
        result.files, selected.startTime, ["vocals", "no_vocals"], selected, muteRef.current, keep
      );
      busyOff("✅ Terminé. Stems ajoutés à la timeline.");
    } catch (e) {
      AppLog.error(e && e.stack ? e.stack : String(e));
      busyOff(`❌ ${e.message || e}`);
    } finally {
      runningRef.current = false;
    }
  }

  async function copyUrl() {
    const cb = navigator.clipboard;
    let ok = false;
    try { if (cb && cb.setContent) { await cb.setContent({ "text/plain": TRIGGER_URL }); ok = true; } } catch (e) {}
    if (!ok) { try { if (cb && cb.writeText) { await cb.writeText(TRIGGER_URL); ok = true; } } catch (e) {} }
    setStatusText(ok ? "URL du déclencheur copiée ✅" : `URL : ${TRIGGER_URL}`);
  }

  // Montage : vérif backend + poll Stream Deck.
  useEffect(() => {
    checkBackend();
    const id = setInterval(async () => {
      if (!readyRef.current || runningRef.current) return;
      if (await Backend.pollTrigger()) { AppLog.info("Déclenché via Stream Deck."); run(); }
    }, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line
  }, []);

  const disabled = busy || !status || status.state !== "ok";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </div>
          <span className="brand-title">Audio Split</span>
        </div>
        <div className={`pill pill--${status.state}`}>
          <span className="dot" /><span>{status.label}</span>
        </div>
      </header>

      {installVisible && (
        <div className="card card--warn">
          <div className="card-title">Moteur non installé</div>
          <div className="card-desc">Installe-le une fois — il démarrera ensuite tout seul.</div>
          <Button variant="accent" onClick={installEngine}>Installer le moteur</Button>
        </div>
      )}

      <div className="card">
        <div className="field">
          <FieldLabel>Garder audible</FieldLabel>
          <RadioGroup horizontal selected={stem} name="stem" onChange={(e) => setStem(e.target.selected)}>
            <Radio value="both">Les deux</Radio>
            <Radio value="vocals">Voix</Radio>
            <Radio value="no_vocals">Bruit</Radio>
          </RadioGroup>
        </div>

        <div className="field">
          <FieldLabel>Qualité</FieldLabel>
          <RadioGroup horizontal selected={quality} name="quality" onChange={(e) => setQuality(e.target.selected)}>
            <Radio value="kim_vocal_2">Rapide</Radio>
            <Radio value="mel_roformer">Max</Radio>
          </RadioGroup>
        </div>

        <Switch checked={mute} onChange={(e) => setMute(e.target.checked)}>
          Muter l'audio d'origine
        </Switch>
      </div>

      <Button variant="accent" size="l" disabled={disabled} onClick={run}>
        Séparer la voix
      </Button>

      {progress !== null && (
        <div className="progress">
          <div className="bar" style={{ width: progress < 0 ? "40%" : progress + "%" }} />
        </div>
      )}
      <div className="status-text">{statusText}</div>

      <Button variant="secondary" treatment="outline" disabled={busy} onClick={checkBackend}>
        Vérifier le backend
      </Button>

      <div className="foldable">
        <div className="fold-head" onClick={() => setSettingsOpen((v) => !v)}>
          <span>⚙&nbsp; Réglages / Stream Deck</span><span>{settingsOpen ? "▴" : "▾"}</span>
        </div>
        {settingsOpen && (
          <div className="fold-body">
            <FieldLabel>Déclencheur HTTP (GET)</FieldLabel>
            <div className="urlbox">{TRIGGER_URL}</div>
            <Button variant="secondary" treatment="outline" onClick={copyUrl}>Copier l'URL</Button>
            <div className="hint">
              Stream Deck : bouton Système › Site Web, colle cette URL, coche « Requête GET
              en arrière-plan ». Le panneau doit rester ouvert.
            </div>
          </div>
        )}
      </div>

      <div className="foldable">
        <div className="fold-head" onClick={() => setLogOpen((v) => !v)}>
          <span>Journal</span><span>{logOpen ? "▴" : "▾"}</span>
        </div>
        <pre id="log" className={"log" + (logOpen ? "" : " collapsed")} />
      </div>

      <div className="footer">Audio Split • fait avec 💜</div>
    </div>
  );
}
