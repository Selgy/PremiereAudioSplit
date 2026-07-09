/*
 * Intégration Premiere Pro (DOM API UXP).
 *
 * ⚠️ PHASE 2 = brique critique. Les signatures ci-dessous suivent la doc UXP
 * actuelle (EncoderManager.exportSequence + import de fichiers). Certaines
 * peuvent varier selon la version exacte de Premiere : les points à vérifier
 * sont marqués « TODO(verify) ». Utiliser le sample officiel `premiere-api`
 * comme référence pour ajuster.
 *
 * Doc : https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/encodermanager/
 */
const Premiere = (() => {
  const ppro = require("premierepro");
  const uxp = require("uxp");
  const fs = uxp.storage.localFileSystem;

  // Dossier de travail temporaire (plugin data storage, accès garanti).
  async function tempFolder() {
    const dataFolder = await fs.getDataFolder();
    let work;
    try {
      work = await dataFolder.getEntry("work");
    } catch {
      work = await dataFolder.createFolder("work");
    }
    return work;
  }

  async function getActiveSequence() {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("Aucun projet ouvert.");
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("Aucune séquence active.");
    return { project, seq };
  }

  /* Lit une TickTime en secondes (robuste, pour les logs). */
  function secs(tt) {
    try {
      if (tt == null) return null;
      if (typeof tt.seconds === "number") return Math.round(tt.seconds * 1000) / 1000;
      if (typeof tt.ticksNumber === "number") return Math.round((tt.ticksNumber / 254016000000) * 1000) / 1000;
    } catch (e) {}
    return null;
  }

  /*
   * Récupère les points in/out de la séquence active.
   * Retourne des TickTime. Si aucun in/out n'est posé, on lève une erreur
   * (on ne veut pas exporter toute la timeline par accident).
   */
  async function getInOut(seq) {
    // TODO(verify): noms exacts selon version — getInPoint()/getOutPoint()
    // ou getInPointAsTickTime()/getOutPointAsTickTime().
    const inPoint = await seq.getInPoint();
    const outPoint = await seq.getOutPoint();
    if (!inPoint || !outPoint) {
      throw new Error("Pose des points d'entrée/sortie (I / O) sur la séquence.");
    }
    return { inPoint, outPoint };
  }

  /*
   * Exporte la région in/out de la séquence active en WAV.
   * @param {string} presetPath  chemin absolu vers le preset .epr audio
   * @returns {Promise<{path:string, inPoint:any}>}
   */
  async function exportSection(presetPath) {
    const { seq } = await getActiveSequence();
    const { inPoint, outPoint } = await getInOut(seq);
    const inS = secs(inPoint);
    const outS = secs(outPoint);
    AppLog.info(
      `[export] séquence in/out : ${inS}s -> ${outS}s (durée ${
        inS != null && outS != null ? (outS - inS).toFixed(3) : "?"
      }s)`
    );

    const work = await tempFolder();
    const name = `section_${Date.now()}.wav`;
    const outFile = await work.createFile(name, { overwrite: true });
    const outPath = outFile.nativePath;

    const encoder = await ppro.EncoderManager.getManager();

    // S'assure qu'AME est prêt (v26.3+ : launchEncoder). Ignoré si indisponible.
    if (typeof encoder.launchEncoder === "function") {
      try { await encoder.launchEncoder(); } catch (e) { /* best effort */ }
    }

    // exportFull=false -> exporte uniquement la région in/out.
    // TODO(verify): ExportType — IMMEDIATELY vs QUEUE selon Constants.
    const exportType =
      (ppro.Constants && ppro.Constants.ExportType &&
        ppro.Constants.ExportType.IMMEDIATELY) || 0;

    const ok = await encoder.exportSequence(
      seq,
      exportType,
      outPath,
      presetPath,
      /* exportFull */ false
    );
    if (!ok) throw new Error("exportSequence a échoué (preset .epr ou AME ?).");

    AppLog.info(`[export] WAV écrit : ${outPath}`);
    return { path: outPath, file: outFile, inPoint };
  }

  /* Lit un fichier local en ArrayBuffer pour l'envoi au backend. */
  async function readFileBytes(entry) {
    return await entry.read({ format: uxp.storage.formats.binary });
  }

  /* Trouve le clip audio SÉLECTIONNÉ (scan des pistes) + son index de piste. */
  async function findSelectedAudioClip(seq) {
    const CLIP =
      (ppro.Constants &&
        ppro.Constants.TrackItemType &&
        ppro.Constants.TrackItemType.CLIP) != null
        ? ppro.Constants.TrackItemType.CLIP
        : 1;
    const count = await seq.getAudioTrackCount();
    for (let i = 0; i < count; i++) {
      const track = await seq.getAudioTrack(i);
      const items = await track.getTrackItems(CLIP, false);
      AppLog.info(`[sel] piste A${i + 1} (index ${i}) : ${items.length} clip(s)`);
      for (const it of items) {
        if (await it.getIsSelected()) {
          let name = "";
          let start = null;
          let end = null;
          let dur = null;
          try { name = await it.getName(); } catch (e) {}
          try { start = await it.getStartTime(); } catch (e) {}
          try { end = await it.getEndTime(); } catch (e) {}
          try { dur = await it.getDuration(); } catch (e) {}
          AppLog.info(
            `[sel] CLIP SÉLECTIONNÉ : "${name}" | piste A${i + 1} (index ${i}) | ` +
              `début ${secs(start)}s | fin ${secs(end)}s | durée ${secs(dur)}s`
          );
          return { clip: it, trackIndex: i, startTime: start, endTime: end };
        }
      }
    }
    AppLog.warn("[sel] Aucun clip audio sélectionné.");
    return null;
  }

  /*
   * Importe un fichier dans le projet et renvoie le ProjectItem créé.
   * importFiles renvoie un booléen -> on retrouve l'item par diff du bin racine.
   */
  async function importWav(project, wavPath) {
    const root = await project.getRootItem();
    const before = new Set();
    for (const it of await root.getItems()) before.add(it.getId());

    const ok = await project.importFiles([wavPath], true, root, false);
    if (!ok) throw new Error("importFiles a échoué : " + wavPath);

    for (const it of await root.getItems()) {
      if (!before.has(it.getId())) {
        AppLog.info(`[import] OK -> ProjectItem id=${it.getId()}`);
        return it;
      }
    }
    throw new Error("ProjectItem importé introuvable : " + wavPath);
  }

  /*
   * Importe les stems et les place sur de NOUVELLES pistes audio (créées en bas
   * pour ne rien écraser), calés à `atTime`. Mute le clip sélectionné si demandé.
   * Le tout dans une seule transaction annulable (Ctrl+Z).
   *
   * @param {Record<string,string>} files  { vocals?:path, no_vocals?:path }
   * @param {any} atTime                    TickTime de placement (point d'entrée)
   * @param {boolean} muteOriginal
   * @param {string[]} order                ordre des stems à placer
   */
  async function placeStems(files, atTime, muteOriginal, order) {
    const { project, seq } = await getActiveSequence();
    AppLog.info(`[place] placement à ${secs(atTime)}s | stems demandés : ${order.join(", ")}`);
    const selected = await findSelectedAudioClip(seq);

    // Nouvelles pistes en bas : index >= nb de pistes => créées automatiquement.
    const base = await seq.getAudioTrackCount();
    AppLog.info(
      `[place] ${base} piste(s) audio existante(s) -> stems sur A${base + 1}+` +
        (selected ? ` | clip sélectionné sur A${selected.trackIndex + 1}` : "")
    );

    // Import (async) AVANT la transaction : on a besoin des ProjectItem.
    const toPlace = [];
    let offset = 0;
    for (const key of order) {
      const p = files && files[key];
      if (!p) {
        AppLog.warn(`[place] pas de chemin pour "${key}" -> ignoré`);
        continue;
      }
      AppLog.info(`[place] import "${key}" : ${p}`);
      const item = await importWav(project, p);
      const target = base + offset;
      AppLog.info(`[place] "${key}" -> piste audio A${target + 1} (index ${target})`);
      toPlace.push({ key, item, audioTrackIndex: target });
      offset++;
    }
    if (toPlace.length === 0) throw new Error("Aucun stem à placer.");

    const editor = await ppro.SequenceEditor.getEditor(seq);

    const ok = project.executeTransaction((compound) => {
      for (const { item, audioTrackIndex } of toPlace) {
        // (projectItem, time, videoTrackIndex, audioTrackIndex)
        const action = editor.createOverwriteItemAction(
          item,
          atTime,
          0,
          audioTrackIndex
        );
        compound.addAction(action);
      }
      if (muteOriginal && selected) {
        compound.addAction(selected.clip.createSetDisabledAction(true));
      }
    });

    AppLog.info(
      `[place] transaction ok=${ok} | ${toPlace.length} stem(s) placé(s) | ` +
        (muteOriginal && selected
          ? "clip sélectionné muté"
          : selected
          ? "mute désactivé"
          : "aucun clip sélectionné -> pas de mute")
    );
    return { ok, placed: toPlace.length, muted: !!(muteOriginal && selected) };
  }

  return {
    exportSection,
    placeStems,
    readFileBytes,
    getActiveSequence,
    tempFolder,
  };
})();
