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
   * Récupère la source audio ISOLÉE du clip sélectionné : le chemin de son
   * fichier média + les points de trim (relatifs au média). Le backend extraira
   * cette plage avec ffmpeg — c'est exactement l'audio du clip, sans le mix des
   * autres pistes (contrairement à un export de séquence).
   * @returns {Promise<{mediaPath:string, start:number, end:number}>}
   */
  async function getClipAudioSource(selected) {
    const clip = selected.clip;
    const pItem = await clip.getProjectItem();
    let cItem = pItem;
    try {
      if (ppro.ClipProjectItem && ppro.ClipProjectItem.cast) {
        cItem = ppro.ClipProjectItem.cast(pItem) || pItem;
      }
    } catch (e) {}
    const mediaPath = await cItem.getMediaFilePath();

    // getInPoint/getOutPoint du trackItem = trim relatif au média source.
    const inTT = await clip.getInPoint();
    const outTT = await clip.getOutPoint();
    const start = secs(inTT);
    const end = secs(outTT);
    AppLog.info(
      `[src] média : ${mediaPath}\n[src] trim source ${start}s -> ${end}s ` +
        `(durée ${end != null && start != null ? (end - start).toFixed(3) : "?"}s)`
    );
    if (!mediaPath) throw new Error("Chemin du média introuvable pour ce clip.");
    return { mediaPath, start, end };
  }

  /* Scan des pistes audio -> premier clip sélectionné (ou null). */
  async function scanSelectedAudioClip(seq, verbose) {
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
      if (verbose) AppLog.info(`[sel] piste A${i + 1} (index ${i}) : ${items.length} clip(s)`);
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
          if (verbose)
            AppLog.info(
              `[sel] CLIP SÉLECTIONNÉ : "${name}" | piste A${i + 1} (index ${i}) | ` +
                `début ${secs(start)}s | fin ${secs(end)}s | durée ${secs(dur)}s`
            );
          return { clip: it, trackIndex: i, startTime: start, endTime: end };
        }
      }
    }
    return null;
  }

  /* Récupère le clip audio SÉLECTIONNÉ. Lève si aucun. */
  async function getSelectedAudioClip() {
    const { seq } = await getActiveSequence();
    const sel = await scanSelectedAudioClip(seq, true);
    if (!sel) throw new Error("Sélectionne un clip audio dans la timeline.");
    return sel;
  }

  /*
   * Importe un fichier dans le projet et renvoie l'ID du ProjectItem créé.
   * (On ne garde PAS la référence : les objets ProjectItem se périment entre
   * deux getItems() -> "script object is no longer valid". On re-résout par ID
   * juste avant la transaction.)
   */
  async function importWav(project, wavPath) {
    const root = await project.getRootItem();
    const before = new Set();
    for (const it of await root.getItems()) before.add(it.getId());

    const ok = await project.importFiles([wavPath], true, root, false);
    if (!ok) throw new Error("importFiles a échoué : " + wavPath);

    for (const it of await root.getItems()) {
      const id = it.getId();
      if (!before.has(id)) {
        AppLog.info(`[import] OK -> ProjectItem id=${id}`);
        return id;
      }
    }
    throw new Error("ProjectItem importé introuvable : " + wavPath);
  }

  /* Retrouve un clip audio par piste + temps de début (pour re-cibler frais). */
  async function findClipAt(seq, trackIndex, startSec) {
    const CLIP =
      (ppro.Constants &&
        ppro.Constants.TrackItemType &&
        ppro.Constants.TrackItemType.CLIP) != null
        ? ppro.Constants.TrackItemType.CLIP
        : 1;
    const tr = await seq.getAudioTrack(trackIndex);
    const items = await tr.getTrackItems(CLIP, false);
    for (const it of items) {
      let st = null;
      try { st = secs(await it.getStartTime()); } catch (e) {}
      if (st != null && Math.abs(st - startSec) < 0.01) return it;
    }
    return null;
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
    const { project, seq: seq0 } = await getActiveSequence();
    AppLog.info(`[place] placement à ${secs(atTime)}s | stems demandés : ${order.join(", ")}`);

    // Juste en dessous du clip sélectionné (index+1, +2). Si l'index dépasse le
    // nombre de pistes, createOverwriteItemAction en crée une nouvelle.
    const base = selected ? selected.trackIndex + 1 : await seq0.getAudioTrackCount();

    // Import (async) AVANT la transaction : on ne garde que les IDs.
    const toPlace = [];
    let offset = 0;
    for (const key of order) {
      const p = files && files[key];
      if (!p) {
        AppLog.warn(`[place] pas de chemin pour "${key}" -> ignoré`);
        continue;
      }
      AppLog.info(`[place] import "${key}" : ${p}`);
      const id = await importWav(project, p);
      const target = base + offset;
      AppLog.info(`[place] "${key}" -> piste audio A${target + 1} (index ${target})`);
      toPlace.push({ key, id, audioTrackIndex: target });
      offset++;
    }
    if (toPlace.length === 0) throw new Error("Aucun stem à placer.");

    // 1) PLACEMENT. Les réf ProjectItem se périment à chaque getItems() : on les
    //    résout par ID en TOUT DERNIER, sans aucun await avant executeTransaction.
    const { seq } = await getActiveSequence();
    const editor = await ppro.SequenceEditor.getEditor(seq);
    const root = await project.getRootItem();
    const byId = {};
    for (const it of await root.getItems()) byId[it.getId()] = it; // dernier await
    const ok = project.executeTransaction((compound) => {
      for (const { key, id, audioTrackIndex } of toPlace) {
        const item = byId[id];
        if (!item) throw new Error(`ProjectItem introuvable (${key}, id=${id})`);
        // (projectItem, time, videoTrackIndex, audioTrackIndex)
        compound.addAction(
          editor.createOverwriteItemAction(item, atTime, 0, audioTrackIndex)
        );
      }
    });
    AppLog.info(`[place] placement ok=${ok} | ${toPlace.length} stem(s) placé(s)`);

    // 2) MUTE DU CLIP D'ORIGINE — transaction séparée, clip retrouvé par position
    //    (réf fraîche ; évite une sélection changée par le placement).
    if (muteOriginal && selected) {
      try {
        const { seq: seqM } = await getActiveSequence();
        const orig = await findClipAt(
          seqM, selected.trackIndex, secs(selected.startTime)
        );
        if (orig) {
          project.executeTransaction((c) =>
            c.addAction(orig.createSetDisabledAction(true))
          );
          AppLog.info("[place] clip d'origine muté");
        } else {
          AppLog.warn("[place] clip d'origine introuvable pour le mute");
        }
      } catch (e) {
        AppLog.warn(`[place] mute clip d'origine échoué : ${e}`);
      }
    }

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
    getClipAudioSource,
    placeStems,
    getActiveSequence,
    tempFolder,
  };
})();
