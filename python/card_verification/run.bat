@echo off
setlocal

chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

set CONFIG=config.yaml
set CPU_CONFIG=config.cpu.yaml
set DEBUG_DIR=runs/debug
set MATRIX_OUT=runs/matrix.json
set PAIR_OUT=runs/pair.json

if "%~1"=="" goto help
if /I "%~1"=="help" goto help
if /I "%~1"=="doctor" goto doctor
if /I "%~1"=="emre-emre2" goto emre_emre2
if /I "%~1"=="emre-emre3" goto emre_emre3
if /I "%~1"=="emre2-emre3" goto emre2_emre3
if /I "%~1"=="murat-murat2" goto murat_murat2
if /I "%~1"=="emre-mert" goto emre_mert
if /I "%~1"=="emre-murat" goto emre_murat
if /I "%~1"=="mert-murat" goto mert_murat
if /I "%~1"=="pair" goto pair
if /I "%~1"=="json" goto json
if /I "%~1"=="quiet" goto quiet
if /I "%~1"=="save" goto save
if /I "%~1"=="matrix" goto matrix
if /I "%~1"=="matrix-json" goto matrix_json
if /I "%~1"=="cpu-json" goto cpu_json
if /I "%~1"=="all-pairs" goto matrix_json

echo Bilinmeyen komut: %~1
echo Yardim icin: run.bat help
exit /b 1

:help
echo Kullanim:
echo   run.bat emre-emre3
echo   run.bat emre-emre2
echo   run.bat pair emre.jpeg emre3.jpeg
echo   run.bat json mert.jpeg murat.jpeg
echo   run.bat quiet emre.jpeg emre3.jpeg
echo   run.bat save emre.jpeg emre3.jpeg
echo   run.bat matrix-json
echo   run.bat cpu-json emre.jpeg emre3.jpeg
echo.
echo Direkt Python:
echo   python card_compare.py emre.jpeg emre3.jpeg --config config.yaml --debug-dir runs/debug --json
echo   python card_compare.py --matrix "*.jpeg" --config config.yaml --debug-dir runs/debug --out runs/matrix.json --json
exit /b 0

:doctor
python --version
python -m pip --version
python -c "import cv2, numpy, yaml, rapidfuzz, skimage; print('Temel paketler OK')"
python -c "import paddle; print('Paddle CUDA:', paddle.device.is_compiled_with_cuda())"
python -c "import torch, open_clip; print('OpenCLIP paketleri OK; Torch CUDA:', torch.cuda.is_available())"
exit /b %ERRORLEVEL%

:emre_emre2
call :run_json emre.jpeg emre2.jpeg
exit /b %ERRORLEVEL%

:emre_emre3
call :run_json emre.jpeg emre3.jpeg
exit /b %ERRORLEVEL%

:emre2_emre3
call :run_json emre2.jpeg emre3.jpeg
exit /b %ERRORLEVEL%

:murat_murat2
call :run_json murat.jpeg murat2.jpeg
exit /b %ERRORLEVEL%

:emre_mert
call :run_json emre.jpeg mert.jpeg
exit /b %ERRORLEVEL%

:emre_murat
call :run_json emre.jpeg murat.jpeg
exit /b %ERRORLEVEL%

:mert_murat
call :run_json mert.jpeg murat.jpeg
exit /b %ERRORLEVEL%

:pair
if "%~2"=="" goto missing_pair
if "%~3"=="" goto missing_pair
python card_compare.py "%~2" "%~3" --config %CONFIG% --debug-dir %DEBUG_DIR%
exit /b %ERRORLEVEL%

:json
if "%~2"=="" goto missing_pair
if "%~3"=="" goto missing_pair
call :run_json "%~2" "%~3"
exit /b %ERRORLEVEL%

:quiet
if "%~2"=="" goto missing_pair
if "%~3"=="" goto missing_pair
python card_compare.py "%~2" "%~3" --config %CONFIG% --debug-dir %DEBUG_DIR% --json --quiet
exit /b %ERRORLEVEL%

:save
if "%~2"=="" goto missing_pair
if "%~3"=="" goto missing_pair
python card_compare.py "%~2" "%~3" --config %CONFIG% --debug-dir %DEBUG_DIR% --json --out %PAIR_OUT%
exit /b %ERRORLEVEL%

:matrix
python card_compare.py --matrix "*.jpeg" --config %CONFIG% --debug-dir %DEBUG_DIR% --out %MATRIX_OUT%
exit /b %ERRORLEVEL%

:matrix_json
python card_compare.py --matrix "*.jpeg" --config %CONFIG% --debug-dir %DEBUG_DIR% --out %MATRIX_OUT% --json
exit /b %ERRORLEVEL%

:cpu_json
if "%~2"=="" goto missing_pair
if "%~3"=="" goto missing_pair
python card_compare.py "%~2" "%~3" --config %CPU_CONFIG% --debug-dir %DEBUG_DIR% --json
exit /b %ERRORLEVEL%

:run_json
python card_compare.py "%~1" "%~2" --config %CONFIG% --debug-dir %DEBUG_DIR% --json
exit /b %ERRORLEVEL%

:missing_pair
echo Iki dosya vermen lazim.
echo Ornek: run.bat json emre.jpeg emre3.jpeg
exit /b 1
