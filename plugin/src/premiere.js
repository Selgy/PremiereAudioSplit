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
    const { inPoint } = await getInOut(seq);

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

    return { path: outPath, file: outFile, inPoint };
  }

  /* Lit un fichier local en ArrayBuffer pour l'envoi au backend. */
  async function readFileBytes(entry) {
    return await entry.read({ format: uxp.storage.formats.binary });
  }

  /*
   * Importe un WAV produit par le backend dans le projet et l'ajoute sur une
   * nouvelle piste audio, calé au point d'entrée d'origine.
   * @param {string} wavPath   chemin absolu du stem (renvoyé par le backend)
   * @param {any} inPoint      TickTime du point d'entrée d'origine
   * @param {boolean} muteOriginal
   */
  async function importStem(wavPath, inPoint, muteOriginal) {
    const { project, seq } = await getActiveSequence();

    // TODO(verify): API d'import — project.importFiles([...]) renvoie les
    // ProjectItem importés, ou il faut ensuite les retrouver par nom.
    const imported = await project.importFiles(
      [wavPath],
      /* suppressUI */ true,
      /* targetBin */ await project.getRootItem?.()
    );
    const item = Array.isArray(imported) ? imported[0] : imported;

    // TODO(verify): insertion sur une piste audio à inPoint.
    // Piste audio cible : ajoute une nouvelle piste puis overwrite/insert.
    // seq.audioTracks[...] + track.insertClip(item, inPoint) selon API.
    AppLog.info("Stem importé :", wavPath);

    if (muteOriginal) {
      // TODO(verify): muter la piste audio source.
      AppLog.info("(option) muter l'audio d'origine — à câbler selon API pistes.");
    }

    return item;
  }

  return {
    exportSection,
    importStem,
    readFileBytes,
    getActiveSequence,
    tempFolder,
  };
})();
