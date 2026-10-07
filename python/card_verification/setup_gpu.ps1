$ErrorActionPreference = "Stop"

python -m pip install --upgrade pip

# PaddleOCR needs PaddlePaddle itself. This uses the official CUDA 13.0 wheel index.
python -m pip install paddlepaddle-gpu==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu130/
python -m pip install -r requirements.txt

@'
import os
import site
from pathlib import Path

handles = []
for site_dir in site.getsitepackages() + [site.getusersitepackages()]:
    nvidia_root = Path(site_dir) / "nvidia"
    if not nvidia_root.exists():
        continue
    for dll_path in nvidia_root.rglob("*.dll"):
        dll_dir = str(dll_path.parent)
        if dll_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = dll_dir + os.pathsep + os.environ.get("PATH", "")
        try:
            handles.append(os.add_dll_directory(dll_dir))
        except Exception:
            pass

import paddle
paddle.utils.run_check()
print("Paddle CUDA available:", paddle.device.is_compiled_with_cuda())
'@ | python -

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
