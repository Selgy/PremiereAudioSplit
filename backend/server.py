"""
Backend FastAPI de séparation voix / bruit de fond pour l'extension UXP.

Endpoints :
  GET  /health          -> état + device (cpu/cuda/mps)
  POST /separate        -> multipart (file=wav, stems=vocals|no_vocals|both)
                           traitement synchrone ; renvoie { files: {stem: path} }
  GET  /jobs/{id}       -> suivi (pour le mode asynchrone, non requis par défaut)

Écoute sur http://localhost:8765 (déclaré dans le manifest UXP).
Le plugin lit ensuite directement les .wav produits via leur chemin absolu.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

# Lancé via audiosplit:// -> pythonw.exe, sans console : sys.stdout/stderr valent
# None et uvicorn plante en configurant ses logs. On redirige vers un fichier :
# ça évite le crash ET donne un log persistant du moteur.
_LOG_DIR = Path(tempfile.gettempdir()) / "premiere-audio-split"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
if sys.stdout is None or sys.stderr is None:
    _logf = open(_LOG_DIR / "engine.log", "a", buffering=1, encoding="utf-8")
    sys.stdout = _logf
    sys.stderr = _logf

# audio-separator a besoin de ffmpeg. On l'embarque dans bin/ (les utilisateurs
# finaux ne l'ont pas) et on préfixe le PATH pour que le sous-processus le trouve.
# _MEIPASS : emplacement des données quand empaqueté par PyInstaller.
_BIN_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "bin"
if _BIN_DIR.is_dir():
    os.environ["PATH"] = str(_BIN_DIR) + os.pathsep + os.environ.get("PATH", "")

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import separate as sep

app = FastAPI(title="PremiereAudioSplit backend", version="0.1.0")

# UXP fait des requêtes cross-origin ; on autorise localhost large en dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORK_ROOT = Path(tempfile.gettempdir()) / "premiere-audio-split"
WORK_ROOT.mkdir(parents=True, exist_ok=True)


# Déclencheur externe (Stream Deck : GET en arrière-plan sur /trigger).
# Le backend ne parle pas à Premiere -> il pose un drapeau que le panneau relève.
_trigger_pending = False


@app.get("/trigger")
def trigger():
    """Stream Deck appelle ceci -> met la séparation en file pour le panneau."""
    global _trigger_pending
    _trigger_pending = True
    return {"ok": True, "queued": True}


@app.get("/trigger/poll")
def trigger_poll():
    """Le panneau relève et remet à zéro le drapeau."""
    global _trigger_pending
    p = _trigger_pending
    _trigger_pending = False
    return {"pending": p}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": sep.get_device(),
        "models": list(sep.MODELS.keys()),
        "defaultModel": "kim_vocal_2",
    }


@app.post("/separate")
async def separate_endpoint(
    file: UploadFile = File(...),
    stems: str = Form("vocals"),
    model: str = Form("kim_vocal_2"),
):
    if stems not in ("vocals", "no_vocals", "both"):
        return JSONResponse(
            status_code=400, content={"error": f"stems invalide: {stems}"}
        )
    if model not in sep.MODELS:
        return JSONResponse(
            status_code=400, content={"error": f"model invalide: {model}"}
        )

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    in_path = job_dir / (file.filename or "input.wav")
    with open(in_path, "wb") as f:
        f.write(await file.read())

    try:
        result = sep.separate(
            str(in_path),
            str(job_dir),
            stems=stems,
            model_key=model,
            progress_cb=None,  # synchrone : pas de suivi intermédiaire
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(e)})

    return {
        "jobId": job_id,
        "files": result["files"],
        "durations": result.get("durations", {}),
    }


@app.post("/separate_clip")
async def separate_clip_endpoint(
    media_path: str = Form(...),
    start: float = Form(0.0),
    end: float = Form(0.0),
    stems: str = Form("both"),
    model: str = Form("kim_vocal_2"),
):
    """
    Extrait la plage [start, end] de l'audio du fichier source `media_path` via
    ffmpeg, puis sépare. Donne exactement l'audio du clip sélectionné (isolé),
    sans passer par le mix de la séquence.
    """
    if stems not in ("vocals", "no_vocals", "both"):
        return JSONResponse(status_code=400, content={"error": f"stems invalide: {stems}"})
    if model not in sep.MODELS:
        return JSONResponse(status_code=400, content={"error": f"model invalide: {model}"})
    if not os.path.isfile(media_path):
        return JSONResponse(status_code=400, content={"error": f"média introuvable: {media_path}"})
    dur = round(max(0.0, end - start), 3)
    if dur <= 0:
        return JSONResponse(
            status_code=400, content={"error": f"durée invalide (start={start}, end={end})"}
        )

    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    ff = shutil.which("ffmpeg") or "ffmpeg"

    def _ff(args):
        subprocess.run([ff, "-y", *args], check=True, capture_output=True)

    raw = job_dir / "clip_raw.wav"
    clip_wav = job_dir / "clip.wav"
    # 1) Extrait la plage du clip.
    print(f"[clip] ffmpeg extract start={start} dur={dur} <- {media_path}", flush=True)
    try:
        _ff(["-ss", str(start), "-i", media_path, "-t", str(dur),
             "-vn", "-acodec", "pcm_s16le", "-ar", "48000", "-ac", "2", str(raw)])
    except FileNotFoundError:
        return JSONResponse(status_code=500, content={"error": "ffmpeg introuvable"})
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode(errors="ignore")[-500:]
        return JSONResponse(status_code=500, content={"error": "ffmpeg: " + err})

    # 2) Les modèles échouent sur les clips très courts -> on complète au silence
    #    jusqu'à MIN_DUR, puis on retaillera les stems à la durée d'origine.
    MIN_DUR = 3.0
    padded = dur < MIN_DUR
    if padded:
        try:
            _ff(["-i", str(raw), "-af", f"apad=whole_dur={MIN_DUR}",
                 "-acodec", "pcm_s16le", str(clip_wav)])
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode(errors="ignore")[-500:]
            return JSONResponse(status_code=500, content={"error": "ffmpeg apad: " + err})
    else:
        clip_wav = raw

    try:
        result = sep.separate(str(clip_wav), str(job_dir), stems=stems, model_key=model)
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": str(e)})

    if not result.get("files"):
        return JSONResponse(
            status_code=500,
            content={"error": "La séparation n'a produit aucun stem (clip trop court/silencieux ?)."},
        )

    # Écrit les stems À CÔTÉ du média (retaillés à la durée d'origine si padding).
    media_dir = os.path.dirname(media_path)
    stem_name = os.path.splitext(os.path.basename(media_path))[0]
    labels = {"vocals": "Voix", "no_vocals": "Bruit"}
    final_files = {}
    durations = {"input": dur}
    for key, path in result["files"].items():
        dst = os.path.join(media_dir, f"{stem_name} - {labels.get(key, key)}.wav")
        try:
            if padded:
                _ff(["-i", path, "-t", str(dur), "-acodec", "pcm_s16le", dst])
            else:
                shutil.copyfile(path, dst)
            final_files[key] = dst
        except Exception as e:  # noqa: BLE001
            print(f"[clip] écriture à côté du média échouée ({dst}): {e}", flush=True)
            # repli : garde le fichier temp (retaillé si besoin)
            if padded:
                trimmed = str(job_dir / f"{key}_trim.wav")
                try:
                    _ff(["-i", path, "-t", str(dur), "-acodec", "pcm_s16le", trimmed])
                    final_files[key] = trimmed
                except Exception:
                    final_files[key] = path
            else:
                final_files[key] = path
        durations[key] = sep._duration(final_files[key])
        print(f"[clip] stem: {final_files[key]} ({durations[key]}s)", flush=True)

    return {"jobId": job_id, "files": final_files, "durations": durations}


def _port_in_use(host: str, port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0


if __name__ == "__main__":
    import sys

    HOST, PORT = "127.0.0.1", 8765

    # Lancé via le schéma audiosplit:// à chaque ouverture du panneau : si une
    # instance tourne déjà, on sort proprement (pas de crash en arrière-plan).
    if _port_in_use(HOST, PORT):
        print(f"Backend déjà en cours sur {HOST}:{PORT} — sortie.")
        sys.exit(0)

    import uvicorn

    # reload=False : on garde le modèle chargé en mémoire.
    uvicorn.run(app, host=HOST, port=PORT, reload=False)
