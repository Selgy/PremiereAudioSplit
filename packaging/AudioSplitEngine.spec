# PyInstaller spec — construit le moteur en binaire autonome (onedir).
# Build : depuis packaging/ ->  pyinstaller AudioSplitEngine.spec
#
# NB : torch/onnxruntime rendent le bundle volumineux. Les MODÈLES ne sont PAS
# embarqués (audio-separator les télécharge à la demande au 1er usage).
# hiddenimports/datas peuvent nécessiter des ajustements selon la version des libs.

from PyInstaller.utils.hooks import collect_all

_pkgs = [
    "audio_separator",
    "onnxruntime",
    "librosa",
    "soundfile",
    "torch",
    "torchaudio",
]

datas, binaries, hiddenimports = [], [], []
for _p in _pkgs:
    try:
        d, b, h = collect_all(_p)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as _e:  # noqa: BLE001
        print(f"[spec] collect_all({_p}) ignoré: {_e}")

a = Analysis(
    ["../backend/server.py"],
    pathex=["../backend"],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AudioSplitEngine",
    console=False,          # pas de fenêtre console (lancé via audiosplit://)
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    name="AudioSplitEngine",
)
