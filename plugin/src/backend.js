/*
 * Client du backend Python de séparation.
 * UXP expose fetch / WebSocket dans le scope global (permissions réseau
 * déclarées dans manifest.json pour http://localhost:8765).
 */
export const Backend = (() => {
  // 127.0.0.1 (pas "localhost") : sur Windows, localhost peut résoudre vers
  // IPv6 (::1) alors que le backend écoute en IPv4 -> "Network request failed".
  const BASE = "http://127.0.0.1:8765";

  /*
   * Déclenche le démarrage du backend via le schéma d'URL custom "audiosplit://"
   * enregistré par backend/install.ps1. UXP n'a pas de spawn : c'est la seule
   * voie supportée pour lancer un process externe (shell.openExternal).
   * Ne fait rien si le schéma n'est pas enregistré (install pas encore faite).
   */
  async function autostart() {
    try {
      const { shell } = require("uxp");
      const r = await shell.openExternal(
        "audiosplit://start",
        "Démarrage du moteur de séparation audio"
      );
      // openExternal renvoie "" en cas de succès.
      return r === "" || r === undefined;
    } catch (e) {
      return false;
    }
  }

  /* Attend que /health réponde, jusqu'à timeoutMs. */
  async function waitUntilReady(timeoutMs = 15000, onTick) {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      const h = await health();
      if (h.ok) return h;
      attempt++;
      if (onTick) onTick(attempt);
      await new Promise((r) => setTimeout(r, 600));
    }
    return { ok: false, reason: "timeout" };
  }

  async function health() {
    try {
      const res = await fetch(`${BASE}/health`, { method: "GET" });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const body = await res.json();
      return { ok: true, ...body };
    } catch (e) {
      return { ok: false, reason: String(e && e.message ? e.message : e) };
    }
  }

  /*
   * Envoie un fichier WAV au backend pour séparation.
   * @param {ArrayBuffer} wavBytes  contenu du WAV exporté
   * @param {string} filename       nom logique du fichier
   * @param {"vocals"|"no_vocals"|"both"} stems
   * @param {(pct:number, msg:string)=>void} onProgress
   * @returns {Promise<{jobId:string, files:Record<string,string>}>}
   *          files: mapping stem -> chemin absolu du WAV produit par le backend
   */
  async function separate(wavBytes, filename, stems, onProgress) {
    const form = new FormData();
    form.append("stems", stems);
    form.append(
      "file",
      new Blob([wavBytes], { type: "audio/wav" }),
      filename
    );

    const res = await fetch(`${BASE}/separate`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Séparation échouée (HTTP ${res.status}) ${txt}`);
    }
    const body = await res.json();
    // Le backend renvoie soit un résultat direct, soit un jobId à suivre.
    if (body.jobId && !body.files) {
      return await pollJob(body.jobId, onProgress);
    }
    if (onProgress) onProgress(100, "Terminé");
    return body;
  }

  /*
   * Sépare directement l'audio d'un clip depuis son fichier source : le backend
   * extrait la plage [start, end] avec ffmpeg puis sépare. Isole le clip
   * sélectionné (pas le mix de la séquence). Sépare toujours les deux stems.
   */
  async function separateClip(mediaPath, start, end, model, onProgress) {
    const form = new FormData();
    form.append("media_path", mediaPath);
    form.append("start", String(start));
    form.append("end", String(end));
    form.append("stems", "both");
    form.append("model", model || "kim_vocal_2");

    const res = await fetch(`${BASE}/separate_clip`, { method: "POST", body: form });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Séparation échouée (HTTP ${res.status}) ${txt}`);
    }
    const body = await res.json();
    if (onProgress) onProgress(100, "Terminé");
    return body;
  }

  async function pollJob(jobId, onProgress) {
    // Fallback polling si le backend traite en asynchrone.
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const res = await fetch(`${BASE}/jobs/${jobId}`);
      if (!res.ok) throw new Error(`Suivi du job échoué (HTTP ${res.status})`);
      const body = await res.json();
      if (onProgress && typeof body.progress === "number") {
        onProgress(body.progress, body.stage || "Traitement…");
      }
      if (body.status === "done") return body;
      if (body.status === "error") throw new Error(body.error || "Erreur backend");
    }
  }

  /* Relève le drapeau de déclenchement externe (Stream Deck). */
  async function pollTrigger() {
    try {
      const res = await fetch(`${BASE}/trigger/poll`);
      if (!res.ok) return false;
      const body = await res.json();
      return !!body.pending;
    } catch (e) {
      return false;
    }
  }

  return {
    health, separate, separateClip, pollTrigger, autostart, waitUntilReady, BASE,
  };
})();
