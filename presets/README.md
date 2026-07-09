# Preset d'export audio (`audio-wav.epr`)

`EncoderManager.exportSequence(...)` a besoin d'un preset Media Encoder `.epr`.
On en génère **un seul**, une fois, pour exporter en WAV.

## Générer le preset

1. Ouvre **Adobe Media Encoder**.
2. Dans le **Preset Browser** : `+` → **Create Encoding Preset**.
3. Réglages :
   - **Format** : `Waveform Audio` (WAV)
   - **Preset Name** : `audio-wav`
   - **Audio** : 48000 Hz, 16 ou 24 bit, Stéréo
4. Enregistre, puis clic droit sur le preset → **Export Preset…**
5. Sauvegarde le fichier ici sous **`presets/audio-wav.epr`**.

## Emplacement attendu par le plugin

Le plugin lit `presets/audio-wav.epr` **relatif au dossier du plugin**
(`getPluginFolder()`), donc au packaging le dossier `presets/` doit être copié
à l'intérieur du bundle du plugin (ou ajuste le chemin dans `main.js` →
`presetPath()`).

## Alternative

Si tu préfères, tu peux passer un chemin `.epr` absolu configurable via un champ
de réglage plutôt que de l'embarquer.
