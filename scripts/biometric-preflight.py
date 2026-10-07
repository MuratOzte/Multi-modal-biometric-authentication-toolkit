"""Check imports without loading models, downloading weights or reading samples."""
import contextlib
import importlib
import io
import json
import sys

MODULES = {
    "face": ["numpy", "PIL", "torch", "torchvision", "facenet_pytorch"],
    "voice": ["numpy", "torch", "torchaudio", "whisper", "speechbrain", "imageio_ffmpeg"],
    # main.py tries the legacy CLIP module (which imports torch) before OCR.
    # Paddle-first imports can cause Windows DLL collisions with torch.
    "card": ["numpy", "PIL", "cv2", "yaml", "rapidfuzz", "skimage", "torch", "open_clip", "paddle", "paddleocr"],
}
module = sys.argv[1]
checks = []
for name in MODULES[module]:
    try:
        # Third-party imports may print paths or warnings; keep the report bounded
        # and do not persist exception messages containing local configuration.
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            imported = importlib.import_module(name)
        checks.append({"name": name, "passed": True})
    except Exception as error:
        checks.append({"name": name, "passed": False, "errorType": type(error).__name__})

if module in ("face", "voice") and any(c["name"] == "torch" and c["passed"] for c in checks):
    import os
    import torch
    device = os.environ.get(f"{module.upper()}_DEVICE", os.environ.get(f"{module.title()}__Device", "auto"))
    required = os.environ.get(f"{module.upper()}_REQUIRE_GPU", os.environ.get(f"{module.title()}__RequireGpu", "")).lower() in ("1", "true", "yes")
    cuda = torch.cuda.is_available()
    checks.append({"name": "device", "passed": cuda or not (required or device == "cuda"), "cudaAvailable": cuda})
if module == "voice":
    import shutil
    available = shutil.which("ffmpeg") is not None
    if not available:
        try:
            from pathlib import Path
            import imageio_ffmpeg
            available = Path(imageio_ffmpeg.get_ffmpeg_exe()).is_file()
        except Exception:
            pass
    checks.append({"name": "ffmpeg", "passed": available})
if module == "card":
    # main.py optionally imports the legacy OpenAI CLIP path. Detect it without
    # importing that local module, which loads/downloads a model at import time.
    checks.append({"name": "legacy-clip-optional", "passed": importlib.util.find_spec("clip") is not None, "optional": True})
print(json.dumps({"module": module, "pythonVersion": sys.version.split()[0], "checks": checks}))
