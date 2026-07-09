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
   * Exporte la région in/out de la séquence active en WAV.
   * @param {string} presetPath  chemin absolu vers le preset .epr audio
   * @returns {Promise<{path:string, inPoint:any}>}
   */
  /*
   * Exporte UNIQUEMENT la plage [startTT, endTT] (celle du clip sélectionné) en
   * WAV. Comme exportSequence n'accepte pas de plage, on cale temporairement les
   * in/out de la séquence sur le clip, puis on restaure l'ancien état s'il était
   * valide.
   */
  async function exportClip(presetPath, startTT, endTT) {
    const { project, seq } = await getActiveSequence();
    const oldIn = await seq.getInPoint();
    const oldOut = await seq.getOutPoint();
    const dur = (secs(endTT) - secs(startTT)).toFixed(3);
    AppLog.info(
      `[export] plage clip : ${secs(startTT)}s -> ${secs(endTT)}s (durée ${dur}s) | ` +
        `ancien in/out ${secs(oldIn)}/${secs(oldOut)}`
    );

    // Cale les in/out sur le clip.
    project.executeTransaction((c) => {
      c.addAction(seq.createSetInPointAction(startTT));
      c.addAction(seq.createSetOutPointAction(endTT));
    });

    const work = await tempFolder();
    const name = `section_${Date.now()}.wav`;
    const outFile = await work.createFile(name, { overwrite: true });
    const outPath = outFile.nativePath;

    const encoder = await ppro.EncoderManager.getManager();
    if (typeof encoder.launchEncoder === "function") {
      try { await encoder.launchEncoder(); } catch (e) { /* best effort */ }
    }
    const exportType =
      (ppro.Constants && ppro.Constants.ExportType &&
        ppro.Constants.ExportType.IMMEDIATELY) || 0;

    const ok = await encoder.exportSequence(
      seq, exportType, outPath, presetPath, /* exportFull */ false
    );

    // Restaure l'état in/out précédent. S'il n'y en avait pas (-400000), ça
    // remet la séquence sans in/out -> les marqueurs sont retirés.
    try {
      project.executeTransaction((c) => {
        c.addAction(seq.createSetInPointAction(oldIn));
        c.addAction(seq.createSetOutPointAction(oldOut));
      });
      AppLog.info(`[export] in/out restaurés (${secs(oldIn)}/${secs(oldOut)})`);
    } catch (e) {
      AppLog.warn("[export] restauration in/out échouée : " + e);
    }

    if (!ok) throw new Error("exportSequence a échoué (preset .epr ou AME ?).");
    AppLog.info(`[export] WAV écrit : ${outPath}`);
    return { path: outPath, file: outFile };
  }

  /* Lit un fichier local en ArrayBuffer pour l'envoi au backend. */
  async function readFileBytes(entry) {
    return await entry.read({ format: uxp.storage.formats.binary });
  }

  /* Récupère le clip audio SÉLECTIONNÉ (scan des pistes). Lève si aucun. */
  async function getSelectedAudioClip() {
    const { seq } = await getActiveSequence();
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
    throw new Error("Sélectionne un clip audio dans la timeline.");
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
   * Importe TOUJOURS les deux stems, les place juste sous le clip sélectionné,
   * calés à `atTime`. Selon `keep`, mute la piste du stem non voulu :
   *   keep="vocals"    -> mute la piste bruit
   *   keep="no_vocals" -> mute la piste voix
   *   keep="both"      -> ne mute aucun stem
   * Mute aussi le clip d'origine si `muteOriginal`.
   *
   * @param {Record<string,string>} files  { vocals:path, no_vocals:path }
   * @param {any} atTime                    TickTime de placement
   * @param {string[]} order                stems à placer (ex: ["vocals","no_vocals"])
   * @param {object|null} selected          clip sélectionné {clip, trackIndex}
   * @param {boolean} muteOriginal
   * @param {"vocals"|"no_vocals"|"both"} keep  stem à garder audible
   */
  async function placeStems(files, atTime, order, selected, muteOriginal, keep) {
    const { project, seq } = await getActiveSequence();
    AppLog.info(`[place] placement à ${secs(atTime)}s | stems demandés : ${order.join(", ")}`);

    // Juste en dessous du clip sélectionné (index+1, +2). Si l'index dépasse le
    // nombre de pistes, createOverwriteItemAction en crée une nouvelle.
    const base = selected ? selected.trackIndex + 1 : await seq.getAudioTrackCount();
    const count = await seq.getAudioTrackCount();
    AppLog.info(
      `[place] ${count} piste(s) audio | clip sélectionné A${
        selected ? selected.trackIndex + 1 : "?"
      } -> stems sur A${base + 1}, A${base + 2}`
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
        (muteOriginal && selected ? "clip d'origine muté" : "clip d'origine non muté")
    );

    // Mute la piste du stem NON gardé (les deux sont toujours importés).
    const trackByKey = {};
    for (const t of toPlace) trackByKey[t.key] = t.audioTrackIndex;

    async function muteStemTrack(idx, label) {
      try {
        const tr = await seq.getAudioTrack(idx);
        await tr.setMute(true);
        AppLog.info(`[place] piste A${idx + 1} (${label}) mutée`);
      } catch (e) {
        AppLog.warn(`[place] mute piste ${idx} échoué : ${e}`);
      }
    }

    if (keep === "vocals" && trackByKey.no_vocals != null) {
      await muteStemTrack(trackByKey.no_vocals, "bruit");
    } else if (keep === "no_vocals" && trackByKey.vocals != null) {
      await muteStemTrack(trackByKey.vocals, "voix");
    } else {
      AppLog.info("[place] les deux stems restent audibles");
    }

    return { ok, placed: toPlace.length, keep };
  }

  return {
    getSelectedAudioClip,
    exportClip,
    placeStems,
    readFileBytes,
    getActiveSequence,
    tempFolder,
  };
})();
