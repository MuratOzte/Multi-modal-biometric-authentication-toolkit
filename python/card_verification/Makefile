PYTHON ?= python
PIP ?= $(PYTHON) -m pip
POWERSHELL ?= powershell -NoProfile -ExecutionPolicy Bypass
MAKE_BIN := $(notdir $(lastword $(MAKE)))

CONFIG ?= config.yaml
CPU_CONFIG ?= config.cpu.yaml
DEBUG_DIR ?= runs/debug
OUT ?= runs/matrix.json
PAIR_OUT ?= runs/pair.json
PATTERN ?= *.jpeg
A ?= emre.jpeg
B ?= emre3.jpeg

COMMON_FLAGS = --config $(CONFIG) --debug-dir $(DEBUG_DIR)

.DEFAULT_GOAL := help

.PHONY: help install install-cpu setup-gpu doctor clean
.PHONY: run compare json quiet save matrix matrix-json matrix-quiet
.PHONY: cpu-run cpu-json cpu-matrix
.PHONY: emre-emre2 emre-emre3 emre2-emre3 murat-murat2
.PHONY: emre-mert emre-murat emre-murat2 mert-murat mert-murat2
.PHONY: quick all-pairs

help:
	@echo Kullanim:
	@echo   $(MAKE_BIN) install-cpu                  CPU kurulumu
	@echo   $(MAKE_BIN) setup-gpu                    GPU kurulumu: setup_gpu.ps1 calistirir
	@echo   $(MAKE_BIN) doctor                       Python ve paket kontrolu
	@echo   $(MAKE_BIN) run                          Varsayilan: emre.jpeg vs emre3.jpeg
	@echo   $(MAKE_BIN) json                         Sonucu JSON ile yazdirir
	@echo   $(MAKE_BIN) quiet                        Sadece JSON yazdirir
	@echo   $(MAKE_BIN) save                         Ikili sonucu runs/pair.json dosyasina yazar
	@echo   $(MAKE_BIN) matrix                       Tum JPEG ciftlerini runs/matrix.json dosyasina yazar
	@echo   $(MAKE_BIN) matrix-json                  Matrix sonucunu hem dosyaya hem terminale JSON basar
	@echo   $(MAKE_BIN) cpu-run                      CPU config ile varsayilan ikili karsilastirma
	@echo   $(MAKE_BIN) cpu-matrix                   CPU config ile tum JPEG ciftleri
	@echo   $(MAKE_BIN) A=mert.jpeg B=murat.jpeg json
	@echo.
	@echo Hazir kombinasyonlar:
	@echo   $(MAKE_BIN) emre-emre2      $(MAKE_BIN) emre-emre3      $(MAKE_BIN) emre2-emre3
	@echo   $(MAKE_BIN) murat-murat2    $(MAKE_BIN) emre-mert       $(MAKE_BIN) emre-murat
	@echo   $(MAKE_BIN) emre-murat2     $(MAKE_BIN) mert-murat      $(MAKE_BIN) mert-murat2
	@echo   $(MAKE_BIN) quick           $(MAKE_BIN) all-pairs

install: install-cpu

install-cpu:
	$(PIP) install --upgrade pip
	$(PIP) install paddlepaddle
	$(PIP) install -r requirements.txt

setup-gpu:
	$(POWERSHELL) -File ./setup_gpu.ps1

doctor:
	$(PYTHON) --version
	$(PIP) --version
	$(PYTHON) -c "import cv2, numpy, yaml, rapidfuzz, skimage; print('Temel paketler OK')"
	$(PYTHON) -c "import paddle; print('Paddle CUDA:', paddle.device.is_compiled_with_cuda())"
	$(PYTHON) -c "import torch, open_clip; print('OpenCLIP paketleri OK; Torch CUDA:', torch.cuda.is_available())"

run compare:
	$(PYTHON) card_compare.py $(A) $(B) $(COMMON_FLAGS)

json:
	$(PYTHON) card_compare.py $(A) $(B) $(COMMON_FLAGS) --json

quiet:
	$(PYTHON) card_compare.py $(A) $(B) $(COMMON_FLAGS) --json --quiet

save:
	$(PYTHON) card_compare.py $(A) $(B) $(COMMON_FLAGS) --json --out $(PAIR_OUT)

matrix:
	$(PYTHON) card_compare.py --matrix "$(PATTERN)" $(COMMON_FLAGS) --out $(OUT)

matrix-json:
	$(PYTHON) card_compare.py --matrix "$(PATTERN)" $(COMMON_FLAGS) --out $(OUT) --json

matrix-quiet:
	$(PYTHON) card_compare.py --matrix "$(PATTERN)" $(COMMON_FLAGS) --out $(OUT) --json --quiet

cpu-run:
	$(MAKE) run CONFIG=$(CPU_CONFIG)

cpu-json:
	$(MAKE) json CONFIG=$(CPU_CONFIG)

cpu-matrix:
	$(MAKE) matrix CONFIG=$(CPU_CONFIG)

emre-emre2:
	$(MAKE) json A=emre.jpeg B=emre2.jpeg

emre-emre3:
	$(MAKE) json A=emre.jpeg B=emre3.jpeg

emre2-emre3:
	$(MAKE) json A=emre2.jpeg B=emre3.jpeg

murat-murat2:
	$(MAKE) json A=murat.jpeg B=murat2.jpeg

emre-mert:
	$(MAKE) json A=emre.jpeg B=mert.jpeg

emre-murat:
	$(MAKE) json A=emre.jpeg B=murat.jpeg

emre-murat2:
	$(MAKE) json A=emre.jpeg B=murat2.jpeg

mert-murat:
	$(MAKE) json A=mert.jpeg B=murat.jpeg

mert-murat2:
	$(MAKE) json A=mert.jpeg B=murat2.jpeg

quick: emre-emre3 murat-murat2 emre-mert

all-pairs: matrix-json

clean:
	$(POWERSHELL) -Command "Remove-Item -Recurse -Force '$(DEBUG_DIR)' -ErrorAction SilentlyContinue; Remove-Item -Force '$(OUT)' -ErrorAction SilentlyContinue; Remove-Item -Force '$(PAIR_OUT)' -ErrorAction SilentlyContinue"
