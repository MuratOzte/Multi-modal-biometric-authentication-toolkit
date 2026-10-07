# SecureKit

**Biyometrik ve bağlamsal sinyalleri bir araya getiren çok faktörlü kimlik doğrulama prototipi.**

SecureKit; klavye kullanım ritmi, yüz, ses, kart, ağ ve konum sinyallerini ortak bir doğrulama akışında değerlendirmek için geliştirilmiş bir bitirme projesidir. TypeScript tabanlı API ve tarayıcı SDK'sı, Python doğrulama modülleri ve React demo arayüzü aynı monorepo içinde yer alır.

## Özellikler

- **Klavye biyometrisi:** Gerçek `keydown` / `keyup` olayları, tuş basılı tutma ve geçiş süreleri üzerinden profil oluşturma; dinamik ve sabit metin doğrulaması.
- **Yüz doğrulama:** MTCNN + FaceNet ile referans ve aday yüz karşılaştırması, tarayıcıda canlılık sinyalleri ve kayan pencere ile referans yönetimi.
- **Ses doğrulama:** SpeechBrain ile konuşmacı benzerliği, Whisper ile challenge metninin kontrolü.
- **Kart doğrulama:** Kart yakalama ve hizalama, PaddleOCR ile içerik çıkarımı, OpenCLIP ile görsel benzerlik değerlendirmesi.
- **Ağ ve konum kontrolü:** IP, VPN / proxy / Tor / relay ve ülke sinyallerinin politika üzerinden değerlendirilmesi.
- **Birleşik karar:** Oturum sinyalleri ve eşiklere göre `allow`, `step_up` veya `deny` sonucu.
- **Demo arayüzü:** Kayıt, giriş, rıza, biyometrik profil oluşturma ve doğrulama akışlarını denemek için Playground.

## Teknolojiler ve yapı

| Dizin | İçerik |
| --- | --- |
| `packages/core` | Ortak sözleşmeler, risk politikaları ve klavye skorlama |
| `packages/node-auth` | Express API, profil depolama ve Python köprüleri |
| `packages/web-sdk` | Tarayıcı istemcisi ve klavye olay toplayıcısı |
| `apps/demo-web` | React + Vite demo uygulaması |
| `apps/securekit-api` | ASP.NET Core 10 API: altyapı, challenge, rıza, profiller, kullanıcı, oturum, ağ, konum, klavye, yüz ve ses akışı (Aşama 0–6) |
| `apps/securekit-api.tests` | xUnit + WebApplicationFactory HTTP sözleşme testleri |
| `python/face_verification` | FaceNet / MTCNN yüz doğrulama işçileri |
| `python/voice_verification` | Whisper / SpeechBrain ses doğrulama işçisi |
| `python/card_verification` | OCR ve görsel kart karşılaştırma araçları |
| `python/ip_check.py` | VPNAPI üzerinden IP sorgulama |

## Hızlı başlangıç

Node.js **22.12+** ve **pnpm 9.15.9** gerekir. Python modülleri için ayrı sanal ortamlar önerilir; yüz modülünün sabitlenmiş bağımlılıkları için Python **3.11** kullanın.

```powershell
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm build
```

API ve web uygulamasını birlikte başlatın:

```powershell
# Yerel demo için dış IP servisini taklit eder.
$env:MOCK_IP_CHECK="1"
pnpm dev
```

- Playground: `http://localhost:5173`
- Kayıt / giriş demosu: `http://localhost:5173/auth.html`
- API: `http://localhost:3001`
- API sağlık kontrolü: `http://localhost:3001/health`

Vite, port doluysa başka bir port seçebilir; terminaldeki adresi kullanın. Kamera, mikrofon ve konum özellikleri için tarayıcı izni gerekir. Uzak sunucuda bu özellikler HTTPS gerektirir.

`MOCK_IP_CHECK=1` yalnızca ağ sorgusunu taklit eder. Yüz, ses ve kart doğrulaması için ilgili Python ortamı ayrıca kurulmalıdır. Klavye doğrulamasının TypeScript akışı Python gerektirmez; sabit metin akışı Python kullanır.

## Yapılandırma

`packages/node-auth/.env.example` API değişkenlerini, `apps/demo-web/.env.example` ise web değişkenlerini gösterir. API `.env` dosyasını otomatik yüklemez; değişkenleri API'yi başlattığınız terminalde tanımlayın. Vite için örnek dosyayı kopyalayabilirsiniz:

```powershell
Copy-Item apps/demo-web/.env.example apps/demo-web/.env
```

| Değişken | Amaç |
| --- | --- |
| `PORT` | API portu; varsayılan `3001` |
| `MOCK_IP_CHECK` | `1`: yerel ağ simülasyonu; `0`: gerçek IP sorgusu |
| `VPNAPI_KEY` | Gerçek IP sorgusu için sunucu tarafı anahtarı |
| `PYTHON_CMD` | IP sorgusunda kullanılacak Python çalıştırıcısı |
| `PYTHON_BIN` | Sabit metin doğrulaması ve Python köprüleri için çalıştırıcı |
| `FACE_PYTHON_BIN` / `VOICE_PYTHON_BIN` / `CARD_PYTHON_BIN` | Modüle özel Python çalıştırıcısı |
| `FACE_DEVICE` / `VOICE_DEVICE` | `auto`, `cpu` veya `cuda` |
| `FACE_REQUIRE_GPU` / `VOICE_REQUIRE_GPU` | GPU zorunluluğu |
| `VITE_SECUREKIT_BASE_URL` | Web API yolu; varsayılan `/api/securekit` |
| `VITE_SECUREKIT_DEV_PROXY_TARGET` | Vite proxy hedefi; varsayılan `http://localhost:3001` |

API anahtarlarını `VITE_` değişkenlerine koymayın; bu değişkenler tarayıcıya aktarılır.

## Python modülleri

Aşağıdaki PowerShell komutlarını repo kökünde çalıştırın. Çalıştırıcı yolları mutlak olarak tanımlandığından pnpm çalışma dizini değişikliklerinden etkilenmez. Ortam değişkenlerini ayarladıktan sonra API'yi aynı terminalde başlatın.

### IP ve sabit metin klavye doğrulaması

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
$env:PYTHON_BIN=(Resolve-Path .\.venv\Scripts\python.exe).Path
$env:PYTHON_CMD=$env:PYTHON_BIN

# Gerçek IP sorgusu isteğe bağlıdır.
$env:VPNAPI_KEY="YOUR_API_KEY"
$env:MOCK_IP_CHECK="0"
pnpm --filter @securekit/node-auth dev
```

### Yüz doğrulama

```powershell
py -3.11 -m venv .venv-face
.\.venv-face\Scripts\python.exe -m pip install -r python/face_verification/requirements.txt
$env:FACE_PYTHON_BIN=(Resolve-Path .\.venv-face\Scripts\python.exe).Path
$env:FACE_DEVICE="auto"
```

CLI ile iki görseli doğrudan karşılaştırmak için:

```powershell
.\.venv-face\Scripts\python.exe python/face_verification/face_verification.py --reference "reference.jpg" --probe "probe.jpg"
```

### Ses doğrulama

```powershell
py -3.11 -m venv .venv-voice
.\.venv-voice\Scripts\python.exe -m pip install -r python/voice_verification/requirements.txt
$env:VOICE_PYTHON_BIN=(Resolve-Path .\.venv-voice\Scripts\python.exe).Path
$env:VOICE_DEVICE="auto"
$env:VOICE_WHISPER_MODEL="base"
```

Whisper ses çözümleme için FFmpeg kullanır; bağımlılıklar arasında `imageio-ffmpeg` fallback'i bulunur. İlk kullanımda modeller indirilebilir.

### Kart doğrulama

```powershell
py -3.11 -m venv .venv-card
.\.venv-card\Scripts\python.exe -m pip install -r python/card_verification/requirements.txt
# PaddleOCR için ayrıca platformunuza uygun PaddlePaddle kurulumu gerekir.
$env:CARD_PYTHON_BIN=(Resolve-Path .\.venv-card\Scripts\python.exe).Path
```

Kart karşılaştırma ayarları `python/card_verification/config.yaml` ve CPU için `config.cpu.yaml` dosyalarındadır. CLI örneği:

```powershell
.\.venv-card\Scripts\python.exe python/card_verification/card_compare.py reference.jpg probe.jpg --json --config python/card_verification/config.cpu.yaml
```

GPU kullanacaksanız Python ortamınızla uyumlu CUDA destekli PyTorch ve ilgili OCR paketlerini kurun. GPU, hızlı başlangıç için zorunlu değildir.

## Doğrulama akışı ve API

1. Demo üzerinden kullanıcı oluşturun ve biyometrik veri işleme rızasını kaydedin.
2. İlgili modül için referans / profil kaydı oluşturun.
3. Yeni bir örnekle doğrulama yapın.
4. İsterseniz sinyalleri oturum doğrulamasında birleştirin.

| Endpoint | İşlev |
| --- | --- |
| `POST /auth/register`, `POST /auth/login` | Yerel demo hesabı |
| `POST /consent` | Kullanıcı rızası |
| `POST /challenge/text` | TR / EN challenge metni |
| `POST /enroll/keystroke`, `POST /verify/keystroke` | Dinamik metin klavye profili ve doğrulama |
| `POST /api/securekit/keystroke/enroll`, `POST /api/securekit/keystroke/verify` | Sabit metin Python akışı |
| `POST /enroll/face/reference`, `POST /verify/face` | Yüz referansı ve doğrulama |
| `POST /enroll/voice`, `POST /verify/voice` | Ses profili ve doğrulama |
| `GET /card/references`, `POST /enroll/card/reference`, `POST /verify/card` | Kart referansları ve doğrulama |
| `POST /verify/network`, `POST /verify/location` | Ağ ve konum kontrolü |
| `POST /session/start`, `POST /verify/session` | Birleşik oturum doğrulaması |
| `GET /user/:userId/profiles`, `DELETE /user/biometrics` | Profil görüntüleme ve biyometrik veri silme |

Yüz, ses ve kart dosyaları ilgili endpoint'lere `multipart/form-data` ile gönderilir. İstek / yanıt tipleri `packages/core/src/contracts` içinde, istemci metotları `packages/web-sdk/src/client.ts` içindedir.

## Geliştirme ve test

### ASP.NET Core 10 geçişi — Aşama 0–6

.NET **10 SDK** gerekir. `global.json` kararlı 10.0 SDK feature band'lerini
kabul eder. Yeni API Controllers tabanlıdır; `GET /health`,
`POST /challenge/text`, `POST /challenge/text/consume`, `POST /consent`,
`GET /user/:userId/profiles`, `DELETE /user/biometrics`, `GET /auth/users`,
`POST /auth/register`, `POST /auth/login`, `POST /session/start` ve
`POST /verify/session`, `POST /verify/network`, `POST /verify/location`,
`POST /verify/vpn:check`, `POST /verify/location:country`,
`POST /verify/webauthn:passkey`, `POST /verify/face:liveness`,
`POST /enroll/keystroke`, `POST /verify/keystroke`,
`GET /api/securekit/keystroke/status`, `POST /api/securekit/keystroke/enroll`
ve `POST /api/securekit/keystroke/verify`, `POST /enroll/face/reference`,
`POST /verify/face`, `POST /verify/face-sliding`, `POST /enroll/voice` ve
`POST /verify/voice` uygulanmıştır. Geçiş sırası
[geçiş planında](MIGRATION_TO_ASPNET10_PLAN.md), mevcut Node endpoint'lerinin
istek/yanıt ve hata sözleşmeleri [envanterde](docs/NODE_API_CONTRACT_INVENTORY.md)
yer alır.

Repo kökünden:

```powershell
dotnet build apps/securekit-api
dotnet test apps/securekit-api.tests

# API ve test projelerini birlikte derle/test et
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx

# Node/C# Aşama 1 HTTP sözleşme karşılaştırması (build sonrasında)
pnpm --filter @securekit/node-auth test:aspnet-stage1
pnpm --filter @securekit/node-auth test:aspnet-stage2
pnpm --filter @securekit/node-auth test:aspnet-stage3
pnpm --filter @securekit/node-auth test:aspnet-stage4
pnpm --filter @securekit/node-auth test:aspnet-stage5
pnpm --filter @securekit/node-auth test:aspnet-stage6

dotnet run --project apps/securekit-api
Invoke-RestMethod http://localhost:3002/health
```

Launch profili C# API'yi `http://localhost:3002` üzerinde çalıştırır.
Yüz rotaları mevcut FaceNet Python ortamını kullanır. `FACE_PYTHON_BIN`,
`FACE_DEVICE`, `FACE_REQUIRE_GPU`, `FACE_UPLOAD_MAX_BYTES` ve
`FACE_PYTHON_TIMEOUT_MS` Node ile ortak değişkenlerdir. C# referans deposu
`Face__ReferenceDirectory`, kayan pencere deposu `FACE_SLIDING_REFERENCES_ROOT`
ile ayarlanabilir. Varsayılan yükleme sınırı 5 MiB, Python timeout'u 30 saniye;
geçici dosyalar hata/iptal dahil temizlenir. C# bu aşamada her istekte model
yükleyen ayrı CLI süreci açar. `test:aspnet-stage5` model gerektirmeyen bir
protokol fixture'ı kullanır; gerçek model kontrolü için `FACE_PYTHON_BIN` ve
`SECUREKIT_FACE_REAL_IMAGE` (yerel bir yüz görselinin mutlak yolu) tanımlayın.
Test host'u gerçek port gerektirmez. Aşama 3 süreç köprüsü testleri Windows'ta
`py`, diğer sistemlerde `python3` kullanır; ek Python paketleri veya API
anahtarı gerektirmez. İlk testte NuGet paketleri
indirilir. Node API ve mevcut demo akışı port 3001'i kullanmaya devam eder.

C# rıza/profil deposu varsayılan olarak `apps/securekit-api/.securekit/user-profiles.json`
dosyasındadır. `SECUREKIT_PROFILE_STORE` veya `Storage__ProfileStorePath` ile
mutlak yol verilebilir. Node JSON dosya biçimi desteklenir; Node ve C# aynı
dosyaya eşzamanlı yazmamalıdır (kilit tek süreç içindir). Challenge TTL'i
`CHALLENGE_TTL_SECONDS` veya `Challenge__TtlSeconds` ile ayarlanır; varsayılan
120 saniyedir ve challenge kayıtları API yeniden başlatıldığında silinir.
Profil silme varsayılan olarak rızayı korur; `?deleteConsent=true` rızayı da siler.
Bu endpoint, Node gibi profil kayıtlarını siler; harici referans görsellerini
ve ayrı sabit metin klavye deposunu silmez. Karşılaştırma aracı iki geçici
yerel sunucu ve ayrı geçici depolar kullanır, çıkışta bunları temizler.

C# kullanıcı deposu `apps/securekit-api/.securekit/users.json` dosyasıdır;
`SECUREKIT_USERS_FILE` veya `Storage__UsersFilePath` ile mevcut Node kullanıcı
dosyasının mutlak yolu verilebilir. Mevcut prototipin parola biçimi korunur.
Oturum TTL'i `SESSION_TTL_SECONDS` / `Session__TtlSeconds` ile ayarlanır;
varsayılan 900 saniyedir. Oturumlar bellektedir ve yeniden başlatmada silinir.
Risk kararları `allow`, `step-up`, `deny` biçimindedir.

Demo'nun hesap başlangıcını C# API üzerinden denemek için API'yi ayrı
terminalde çalıştırıp web terminalinde şunu kullanın:

```powershell
$env:VITE_SECUREKIT_DEV_PROXY_TARGET="http://localhost:3002"
pnpm --filter demo-web dev
# Tarayıcıda Vite adresi/auth.html
```

Bu aşamada kayıt/rıza, giriş/oturum başlangıcı, ağ/konum ve klavye kontrolü çalışır.
Yerel ağ testi için C# API terminalinde `$env:MOCK_IP_CHECK="1"` ayarlayın.
Yüz ve ses endpoint'leri de taşındı. Kart endpoint'leri Aşama 7'de taşınacaktır; tam giriş
akışı için demo'nun mevcut Node hedefini kullanmaya devam edin. React arayüzü,
web SDK ve Python modülleri bu aşamada değiştirilmedi.

C# IP sorgusu `PYTHON_CMD` / `IpCheck:PythonCommand` ile çalıştırıcı,
`VPNAPI_KEY` / `IpCheck:ApiKey` ile anahtar,
`IP_CHECK_TIMEOUT_SECONDS` / `IpCheck:TimeoutSeconds` ile zaman aşımı
(varsayılan 15 saniye) alır. `IpCheck:ScriptPath` isteğe bağlı mutlak
işçi yoludur; varsayılan repo içindeki `python/ip_check.py` dosyasıdır.
`MOCK_IP_CHECK=1` / `IpCheck:Mock=1` temiz ve riskli test sonuçlarını
etkinleştirir. Gerçek sorgu için yukarıdaki IP Python ortamını kurun.

C# dinamik klavye enrollment hedefleri `KEYSTROKE_ENROLL_MIN_ROUNDS` /
`Keystroke:MinRounds` (10) ve `KEYSTROKE_ENROLL_MIN_KEYSTROKES` /
`Keystroke:MinKeystrokes` (160) ile ayarlanır; hedeflerden biri tamamlanınca
enrollment hazır olur. Doğrulama `/challenge/text` üzerinden alınan ID ve
aynı `sample.expectedText` değerini gerektirir; challenge tek kullanımlıktır.

Sabit metin deposu varsayılan `apps/securekit-api/.securekit/keystroke`
dizinidir. `SECUREKIT_KEYSTROKE_STORE` / `Keystroke:StorePath` mutlak depo
kökünü, `SECUREKIT_SERVER_SALT` / `Keystroke:ServerSalt` kullanıcı hash tuzunu
ayarlar (prototip varsayılanı `securekit-dev-salt`). Node deposuna geçiş için
aynı tuzu ve `packages/node-auth/.data/keystroke` dizininin mutlak yolunu
kullanın; Node ve C# aynı depoya eşzamanlı yazmamalıdır.

İşçi `PYTHON_BIN` / `Keystroke:PythonCommand` ile seçilir: boşluk içeren
mutlak çalıştırıcı yolları ve Windows için `py -3` / `py -3.11` desteklenir.
Ek argümanlar `Keystroke:PythonArgs` dizisiyle verilir. Çalıştırıcı
belirtilmezse Windows'ta `py -3`, ardından `python3` ve `python` denenir.
`KEYSTROKE_FIXED_PYTHON_TIMEOUT_MS` / `Keystroke:PythonTimeoutMs` varsayılan
2000 ms zaman aşımını ayarlar. `Keystroke:ScriptPath` özel işçi yoludur;
varsayılan repo içindeki `packages/node-auth/src/keystroke/python/keystroke_ml.py`
dosyasıdır. İşçi ek Python paketleri gerektirmez. Timeout ve istek iptalinde
süreç ağacı kapatılır; stdout/stderr ayrı ayrı 1 MiB ile sınırlanır.

Aşama 4 karşılaştırmaları geçici ayrı depolarla gerçek Python enrollment,
verify ve auto-enrollment çalıştırır. 12 ortak fixture
`apps/securekit-api.tests/Fixtures/keystroke-stage4.json` dosyasındadır;
Node kaynakları değişirse `node --import tsx packages/node-auth/scripts/generate-stage-four-fixtures.ts`
ile yeniden üretilebilir.

C# ses rotaları mevcut SpeechBrain/Whisper ortamını kullanır. Yukarıdaki
`.venv-voice` kurulumundan sonra API terminalinde `VOICE_PYTHON_BIN` mutlak
yolunu ayarlayın. `VOICE_DEVICE`, `VOICE_REQUIRE_GPU`, `VOICE_WHISPER_MODEL`,
`VOICE_SPEAKER_MODEL`, `VOICE_UPLOAD_MAX_BYTES`, `VOICE_PYTHON_TIMEOUT_MS`,
`VOICE_MATCH_THRESHOLD`, `VOICE_TEXT_THRESHOLD` ve `VOICE_MIN_ENROLLMENT_SAMPLES`
Node ile ortak değişkenlerdir. C# karşılıkları `Voice` yapılandırma bölümündedir;
özel worker yolu `VOICE_PYTHON_SCRIPT_PATH` / `Voice:ScriptPath`, ek çalıştırıcı
argümanları `Voice:PythonArgs`, geçici ses kökü `Voice:TempRoot` ile ayarlanır.
Varsayılan dosya sınırı 12 MiB, timeout 120 saniye, enrollment hedefi üç örnektir.
`audioSample` dosyası ve `/challenge/text` üzerinden alınan `challengeId`
gerekir; challenge tek kullanımlıktır. Ses kayıtları saklanmaz, profil embedding
olarak tutulur. C# her istekte yeni worker başlatır; model yükleme süresi Node'un
kalıcı worker'ına göre daha uzundur. İlk model indirmesinde timeout artırılabilir.
`test:aspnet-stage6` gerçek model gerektirmeyen protokol fixture'ı ile sözleşme,
profil dosyası ve geçici dosya temizliğini doğrular.

Yapılandırma `apps/securekit-api/appsettings.json`, isteğe bağlı
`appsettings.Development.json`, environment variables ve Development'ta
.NET User Secrets üzerinden yüklenir. Portu profil dışında ayarlamak için:

```powershell
$env:ASPNETCORE_URLS="http://localhost:3002"
dotnet run --project apps/securekit-api --no-launch-profile

# İleride eklenen gizli değerler için (kaynak koda eklemeyin):
dotnet user-secrets set "ExampleService:ApiKey" "YOUR_API_KEY" --project apps/securekit-api
```

CORS boş `Cors:AllowedOrigins` listesinde mevcut Node davranışı gibi tüm
origin'lere izin verir. Listeyi `Cors__AllowedOrigins__0=http://localhost:5173`
gibi environment variable ile sınırlandırabilirsiniz. Credentials açılmaz.
JSON alanları camelCase, sayılar strict, null alanlar korunur; hata zarfında
verilmeyen `details` atlanır. Endpoint'e özgü enum değerleri ilgili aşamada
açıkça eşlenecektir. Merkezi exception handler `500 INTERNAL_ERROR` JSON döner.
Request logging route şablonu, HTTP metodu, status, süre ve trace ID kaydeder.

### Mevcut TypeScript / Python kontrolleri

```powershell
pnpm build
pnpm test
pnpm typecheck

# Paket bazında test
pnpm --filter @securekit/node-auth test
pnpm --filter @securekit/web-sdk test

# Python klavye testleri
py -3.11 -m unittest discover -s packages/node-auth/src/keystroke/python -p "test_*.py"
```

GitHub Actions workflow'u kaldırıldı; doğrulama komutları yerelde çalıştırılır. Birim testleri gerçek kamera / mikrofon, model kalitesi veya GPU entegrasyonunun doğrulandığı anlamına gelmez.

## Projenin kapsamı ve veri gizliliği

Bu proje araştırma ve yerel demo amaçlı bir prototiptir. Mevcut demo kullanıcı deposu parolaları düz metin tutar; üretim için parola hashleme, erişim kontrolü, hız sınırlama ve güvenli oturum yönetimi ayrıca tasarlanmalıdır. Bazı eski doğrulama endpoint'leri örnek sinyallerle çalışır; üretim güvenliği garantisi sunmaz.

Kullanıcı kayıtları, yüz / kart referansları, biyometrik profiller, model önbellekleri ve `.env` dosyaları repoya dahil edilmez. Temiz kurulum hazır kullanıcı veya kişisel referans görseli içermez; demo üzerinden kendi izinli örneklerinizi oluşturun. Yüz CLI'sındaki eski `--user-id` örnekleri yerel görseller gerektirir; temiz kurulumda `--reference` kullanın.
