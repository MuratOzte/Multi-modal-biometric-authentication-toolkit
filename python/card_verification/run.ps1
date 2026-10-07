param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
chcp.com 65001 > $null

$Python = "python"
$Config = "config.yaml"
$CpuConfig = "config.cpu.yaml"
$DebugDir = "runs/debug"
$MatrixOut = "runs/matrix.json"
$PairOut = "runs/pair.json"
$DefaultA = "emre.jpeg"
$DefaultB = "emre3.jpeg"
$Pattern = "*.jpeg"

$Pairs = @{
    "emre-emre2"  = @("emre.jpeg", "emre2.jpeg")
    "emre-emre3"  = @("emre.jpeg", "emre3.jpeg")
    "emre2-emre3" = @("emre2.jpeg", "emre3.jpeg")
    "murat-murat2" = @("murat.jpeg", "murat2.jpeg")
    "emre-mert"   = @("emre.jpeg", "mert.jpeg")
    "emre-murat"  = @("emre.jpeg", "murat.jpeg")
    "emre-murat2" = @("emre.jpeg", "murat2.jpeg")
    "mert-murat"  = @("mert.jpeg", "murat.jpeg")
    "mert-murat2" = @("mert.jpeg", "murat2.jpeg")
}

function Show-Help {
    Write-Host "Kullanim:"
    Write-Host "  .\run.ps1 doctor"
    Write-Host "  .\run.ps1 pair emre.jpeg emre2.jpeg"
    Write-Host "  .\run.ps1 json emre.jpeg emre2.jpeg"
    Write-Host "  .\run.ps1 quiet emre.jpeg emre2.jpeg"
    Write-Host "  .\run.ps1 save emre.jpeg emre2.jpeg"
    Write-Host "  .\run.ps1 matrix"
    Write-Host "  .\run.ps1 matrix-json"
    Write-Host "  .\run.ps1 cpu-run"
    Write-Host "  .\run.ps1 cpu-json emre.jpeg emre2.jpeg"
    Write-Host "  .\run.ps1 cpu-matrix"
    Write-Host ""
    Write-Host "Hazir kombinasyonlar:"
    Write-Host "  .\run.ps1 emre-emre2"
    Write-Host "  .\run.ps1 emre-emre3"
    Write-Host "  .\run.ps1 emre2-emre3"
    Write-Host "  .\run.ps1 murat-murat2"
    Write-Host "  .\run.ps1 emre-mert"
    Write-Host "  .\run.ps1 emre-murat"
    Write-Host "  .\run.ps1 emre-murat2"
    Write-Host "  .\run.ps1 mert-murat"
    Write-Host "  .\run.ps1 mert-murat2"
    Write-Host "  .\run.ps1 quick"
    Write-Host "  .\run.ps1 all-pairs"
    Write-Host ""
    Write-Host "Direkt Python ornekleri:"
    Write-Host "  python card_compare.py emre.jpeg emre2.jpeg --config config.yaml --debug-dir runs/debug --json"
    Write-Host "  python card_compare.py --matrix `"*.jpeg`" --config config.yaml --debug-dir runs/debug --out runs/matrix.json --json"
}

function Invoke-Python {
    param([string[]]$CliArgs)

    Write-Host ""
    Write-Host "> $Python $($CliArgs -join ' ')"
    & $Python @CliArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Host "Komut hata kodu ile bitti: $code" -ForegroundColor Red
        Write-Host "Not: 120 genelde Windows/Python cikti encoding veya Paddle GPU kapanis hatasi olur." -ForegroundColor Yellow
        Write-Host "Tekrar denemek icin: .\run.ps1 cpu-json emre.jpeg emre3.jpeg" -ForegroundColor Yellow
        exit $code
    }
}

function Get-PairArgs {
    param([string[]]$Items)

    $a = $DefaultA
    $b = $DefaultB

    if ($Items.Count -ge 1 -and $Items[0]) {
        $a = $Items[0]
    }
    if ($Items.Count -ge 2 -and $Items[1]) {
        $b = $Items[1]
    }

    return @($a, $b)
}

function Invoke-Pair {
    param(
        [string]$A,
        [string]$B,
        [string]$ConfigPath = $Config,
        [switch]$Json,
        [switch]$Quiet,
        [switch]$Save
    )

    $cli = @("card_compare.py", $A, $B, "--config", $ConfigPath, "--debug-dir", $DebugDir)
    if ($Json) {
        $cli += "--json"
    }
    if ($Quiet) {
        $cli += @("--json", "--quiet")
    }
    if ($Save) {
        $cli += @("--json", "--out", $PairOut)
    }

    Invoke-Python $cli
}

function Invoke-Matrix {
    param(
        [string]$ConfigPath = $Config,
        [switch]$Json,
        [switch]$Quiet
    )

    $matrixPattern = $Pattern
    if ($Rest.Count -ge 1 -and $Rest[0]) {
        $matrixPattern = $Rest[0]
    }

    $cli = @("card_compare.py", "--matrix", $matrixPattern, "--config", $ConfigPath, "--debug-dir", $DebugDir, "--out", $MatrixOut)
    if ($Json) {
        $cli += "--json"
    }
    if ($Quiet) {
        $cli += @("--json", "--quiet")
    }

    Invoke-Python $cli
}

Push-Location $PSScriptRoot

try {
    $cmd = $Command.ToLowerInvariant()

    switch ($cmd) {
        "help" {
            Show-Help
        }
        "doctor" {
            Invoke-Python @("--version")
            Invoke-Python @("-m", "pip", "--version")
            Invoke-Python @("-c", "import cv2, numpy, yaml, rapidfuzz, skimage; print('Temel paketler OK')")
            Invoke-Python @("-c", "import paddle; print('Paddle CUDA:', paddle.device.is_compiled_with_cuda())")
            Invoke-Python @("-c", "import torch, open_clip; print('OpenCLIP paketleri OK; Torch CUDA:', torch.cuda.is_available())")
        }
        "install-cpu" {
            Invoke-Python @("-m", "pip", "install", "--upgrade", "pip")
            Invoke-Python @("-m", "pip", "install", "paddlepaddle")
            Invoke-Python @("-m", "pip", "install", "-r", "requirements.txt")
        }
        "setup-gpu" {
            .\setup_gpu.ps1
        }
        { $_ -in @("pair", "run", "compare") } {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1]
        }
        "json" {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1] -Json
        }
        "quiet" {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1] -Quiet
        }
        "save" {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1] -Save
        }
        "matrix" {
            Invoke-Matrix
        }
        "matrix-json" {
            Invoke-Matrix -Json
        }
        "matrix-quiet" {
            Invoke-Matrix -Quiet
        }
        "cpu-run" {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1] -ConfigPath $CpuConfig
        }
        "cpu-json" {
            $images = Get-PairArgs $Rest
            Invoke-Pair -A $images[0] -B $images[1] -ConfigPath $CpuConfig -Json
        }
        "cpu-matrix" {
            Invoke-Matrix -ConfigPath $CpuConfig
        }
        "quick" {
            Invoke-Pair -A "emre.jpeg" -B "emre3.jpeg" -Json
            Invoke-Pair -A "murat.jpeg" -B "murat2.jpeg" -Json
            Invoke-Pair -A "emre.jpeg" -B "mert.jpeg" -Json
        }
        "all-pairs" {
            Invoke-Matrix -Json
        }
        default {
            if ($Pairs.ContainsKey($cmd)) {
                $images = $Pairs[$cmd]
                Invoke-Pair -A $images[0] -B $images[1] -Json
            } else {
                Write-Error "Bilinmeyen komut: $Command. Yardim icin: .\run.ps1 help"
                exit 1
            }
        }
    }
}
finally {
    Pop-Location
}
