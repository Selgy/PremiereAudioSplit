"""
Séparation voix / bruit de fond via `audio-separator` (modèles UVR).

Par défaut : **Kim Vocal 2** (Mel-Band RoFormer, rapide, excellente qualité voix).
Option qualité max : un modèle **BS/MelBand RoFormer** plus lourd.

audio-separator utilise onnxruntime et choisit automatiquement l'accélération
disponible : CUDA (Windows/Linux NVIDIA) ou CoreML (Mac Apple Silicon), sinon CPU.
Les fichiers de modèle sont téléchargés à la demande au premier usage.

Produit :
  - vocals.wav     : la voix isolée
  - no_vocals.wav  : le reste (bruit de fond / ambiance / musique) = stem "Instrumental"
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

# Modèles UVR (noms tels qu'attendus par audio-separator).
MODELS = {
    # rapide, défaut
    "kim_vocal_2": "Kim_Vocal_2.onnx",
    # qualité supérieure (plus lent, plus lourd) — RoFormer
    "roformer": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
}

_SEPARATORS: dict[str, object] = {}


def get_device() -> str:
    """Renvoie l'accélération détectée par onnxruntime (info d'affichage)."""
    try:
        import onnxruntime as ort

        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" in providers:
            return "cuda"
        if "CoreMLExecutionProvider" in providers:
            return "coreml"
    except Exception:
        pass
    return "cpu"


def _get_separator(model_key: str, out_dir: str):
    """Charge (et met en cache) un Separator pour le modèle demandé."""
    from audio_separator.separator import Separator

    model_file = MODELS.get(model_key, MODELS["kim_vocal_2"])
    cache_key = f"{model_key}"
    sep = _SEPARATORS.get(cache_key)
    if sep is None:
        sep = Separator(output_dir=out_dir, output_format="WAV")
        sep.load_model(model_filename=model_file)
        _SEPARATORS[cache_key] = sep
    else:
        # réutilise le modèle chargé, mais écrit dans le bon dossier
        sep.output_dir = out_dir
    return sep


def separate(
    input_wav: str,
    out_dir: str,
    stems: str = "vocals",
    model_key: str = "kim_vocal_2",
    progress_cb=None,
) -> dict[str, str]:
    """
    Sépare `input_wav` et écrit les stems demandés dans `out_dir`.

    stems: "vocals" | "no_vocals" | "both"
    model_key: "kim_vocal_2" (défaut) | "roformer"
    Retourne {stem: chemin_absolu}.
    """
    os.makedirs(out_dir, exist_ok=True)
    if progress_cb:
        progress_cb(10, f"Chargement du modèle ({model_key})…")

    sep = _get_separator(model_key, out_dir)

    if progress_cb:
        progress_cb(30, "Séparation en cours…")

    # audio-separator renvoie la liste des fichiers produits (Vocals / Instrumental).
    produced = sep.separate(input_wav)
    produced_paths = [str(Path(out_dir) / p) if not os.path.isabs(p) else p for p in produced]

    if progress_cb:
        progress_cb(85, "Écriture des stems…")

    # Range les sorties par type via le nom de fichier.
    def _find(marker: str) -> str | None:
        for p in produced_paths:
            if marker.lower() in os.path.basename(p).lower():
                return p
        return None

    vocals_src = _find("(vocals)") or _find("vocals")
    noise_src = _find("(instrumental)") or _find("instrumental")

    out: dict[str, str] = {}

    def _publish(src: str | None, key: str):
        if not src or not os.path.exists(src):
            return
        dst = str(Path(out_dir) / f"{key}.wav")
        if os.path.abspath(src) != os.path.abspath(dst):
            shutil.copyfile(src, dst)
        out[key] = dst

    if stems in ("vocals", "both"):
        _publish(vocals_src, "vocals")
    if stems in ("no_vocals", "both"):
        _publish(noise_src, "no_vocals")

    if progress_cb:
        progress_cb(100, "Terminé")
    return out


if __name__ == "__main__":
    import sys

    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else "out"
    print(separate(src, dst, stems="both", progress_cb=lambda p, s: print(p, s)))
