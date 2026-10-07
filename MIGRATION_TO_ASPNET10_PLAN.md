# Node.js API'den ASP.NET Core 10'a Geçiş Planı

## Amaç ve sınırlar

Amaç, `packages/node-auth` altındaki Express API'nin işlevlerini ASP.NET Core
10 (`net10.0`) tabanlı bir API'ye, istemci sözleşmesini bozmadan taşımaktır.

İlk geçişte aşağıdakiler **değişmeyecek**:

- React/Vite demo uygulaması (`apps/demo-web`)
- TypeScript web SDK (`packages/web-sdk`)
- Python yüz, ses, kart, IP ve sabit metin klavye işçileri
- Mevcut HTTP yolları, request/response alanları ve hata durumları

Python işçileri C# tarafından kontrollü bir süreç köprüsü ile çağrılacaktır.
Veritabanına geçiş, parola güvenliği iyileştirmeleri ve kimlik doğrulama
stratejisi bu API uyumluluk geçişinden ayrı işlerdir.

## Hedef mimari

- Yeni proje kökü: `apps/securekit-api/`
- Hedef çerçeve: `net10.0`
- API stili: ASP.NET Core Controllers; endpoint grupları mevcut Express router
  sınırlarına karşılık gelir.
- Test: xUnit + `WebApplicationFactory`; HTTP karşılaştırmaları için contract
  testleri.
- Geçici depolama: Node uygulamasındaki dosya ve bellek tabanlı davranışla
  uyumlu adapter'lar. EF Core/veritabanı bu planın kapsamında değildir.
- Yapılandırma: `appsettings*.json`, environment variables ve .NET User
  Secrets. Gizli değerler kaynak koda eklenmez.
- Upload: `IFormFile`; dosya boyutu, MIME türü, süre aşımı ve geçici dosya
  temizliği açıkça sınırlandırılır.

## Geçiş ilkeleri

1. Node API, ilgili C# modülü tüm testlerden geçene kadar korunur.
2. Her adım küçük, bağımsız ve geri alınabilir bir commit olur.
3. Önce sözleşme ve test, sonra implementasyon yapılır.
4. Route, HTTP metodu, status code ve JSON alanları isteyerek değiştirilmez.
5. Aynı endpoint hem Node hem C# üzerinde çalıştırılıp sonuçları karşılaştırılır.
6. Bir aşamanın test kapısı geçmeden sonraki aşamaya başlanmaz.

## Aşama 0 — Başlangıç iskeleti ve sözleşme envanteri

**Durum (7 Ekim 2026): Uygulandı.** `net10.0` Controllers API, solution,
CORS/JSON, merkezi hata yönetimi, request logging ve `/health` hazır.
API ve test projelerini içeren solution 0 hata/0 uyarı ile derlendi;
15 xUnit/WebApplicationFactory testi geçti. Ortak contract yardımcıları
`apps/securekit-api.tests/Support` altında, Node endpoint envanteri
[bu dokümanda](docs/NODE_API_CONTRACT_INVENTORY.md) yer alır.

### Yapılacaklar

- `apps/securekit-api` içinde `net10.0` Web API ve test projesini oluştur.
- Solution dosyası ekle; build/test komutlarını README'ye ekle.
- CORS, JSON seçenekleri, merkezi exception handler, request logging ve
  `/health` endpoint'ini kur.
- Node endpoint envanterini tek bir dokümanda çıkar: method, path, content
  type, request/response örnekleri, hata durumları.
- Ortak contract test yardımcılarını hazırla.

### Test kapısı

```powershell
dotnet build apps/securekit-api
dotnet test apps/securekit-api.tests
```

- `GET /health` 200 döner.
- Test host'u ayağa kalkar ve CORS/JSON temel senaryoları doğrulanır.

## Aşama 1 — Challenge, consent ve profil yönetimi

**Durum (7 Ekim 2026): Uygulandı.** Beş endpoint, Node ile aynı alanlar ve
endpoint hata mesajlarıyla taşındı. Challenge deposu bellekte tutulur;
120 saniyelik varsayılan TTL, sınır anında tüketim ve eşzamanlı tek kullanım
test edilir. Türkçe metin 40–50 harftir; İngilizce metin uzunluk/wordCount
kurallarını korur. Rıza/profil deposu Node'un JSON dosya biçimini kullanır;
atomik dosya yazımı ve süreç içi eşzamanlılık koruması vardır.

35 C# testi ve ilgili 12 Node testi geçti; 27 canlı Node/C# HTTP
karşılaştırması ve silme sonrası dosya içeriği eşleşti. Rastgele ID/zaman
alanları karşılaştırmada normalize edilir; rastgele metin üretimi ayrıca
kural tabanlı test edilir. Kontrol komutu:

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage1
```

JSON nesnesi/dizi içindeki geçerli ve hatalı alanlar karşılaştırılır.
Express'in JSON parser'ının nesne dışı gövdelerde ürettiği HTML hataları ve
bozuk JSON için framework hata metinleri bu karşılaştırmaya dahil değildir;
C# tarafı merkezi JSON hata zarfını korur.

### Taşınacak endpoint'ler

- `POST /challenge/text`
- `POST /challenge/text/consume`
- `POST /consent`
- `GET /user/:userId/profiles`
- `DELETE /user/biometrics`

### Test kapısı

- Başarılı ve hatalı isteklerde Node ile aynı status code ve uyumlu JSON.
- Challenge tek kullanımlılık ve TTL testleri.
- Consent ile profil silme akışı için entegrasyon testi.

## Aşama 2 — Kullanıcı ve oturum akışı

**Durum (7 Ekim 2026): Uygulandı.** Beş endpoint taşındı. Kullanıcı deposu
Node'un `{ "users": [...] }` dosya biçimini okur; kimlikler trim/lowercase ile
normalize edilir, parolalar aynı biçimde korunur. Aynı parolalı tekrar kayıt
200, farklı parolalı tekrar kayıt 409 döner. Liste yanıtı parola içermez.
Dosya yazımı atomiktir; eşzamanlı kayıt işlemleri tek süreçte kilitlenir.

Oturum deposu bellektedir; varsayılan TTL 15 dakikadır ve tam bitiş anında
oturum süresi dolar. Sinyaller çağrılar arasında birleştirilir. Risk skoru,
ülke politikası, VPN politikası, özel eşikler, adım sırası ve ses sinyalinin
karara etkisi taşındı. Oturum sözleşmesindeki ek doğrulama kararı `step-up`,
klavye sinyalindeki karar `step_up` olarak korunur.

`/verify/session` klavye profili değerlendirdiği için gereken metrik,
skorlama ve EMA profil güncelleme servisleri bu aşamada C#'a eklendi.
Mevcut TypeScript core kodu korunur; klavye enrollment/verify endpoint'leri
ve Python sabit metin köprüsü Aşama 4'te taşınacaktır.

Doğrulama: toplam 58 C# testi, 94 Aşama 2 Node/C# HTTP karşılaştırması,
eşleşen EMA profil dosyaları ve paylaşılan 15 risk fixture'ı. Node paketinde
102 ve SDK'da 36 test geçti; isteğe bağlı Python entegrasyon testi atlandı.
`auth.html`, geçici Vite proxy ile C# API'ye bağlanıp headless Edge'de kayıt,
rıza, hatalı giriş, başarılı giriş ve oturum başlangıcıyla doğrulandı.
Ağ/konum ve biyometrik adımlar henüz taşınmadığından tam çok faktörlü giriş
akışı bu aşamanın kabul kontrolüne dahil değildir.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage2
```

Kullanıcı dosyası `SECUREKIT_USERS_FILE` / `Storage__UsersFilePath`, oturum TTL'i
`SESSION_TTL_SECONDS` / `Session__TtlSeconds` ile ayarlanır. Node ve C# aynı
JSON depolarına eşzamanlı yazmamalıdır.

### Taşınacak endpoint'ler

- `GET /auth/users`
- `POST /auth/register`
- `POST /auth/login`
- `POST /session/start`
- `POST /verify/session`

### Test kapısı

- Kayıt, yinelenen kullanıcı, hatalı giriş ve başarılı giriş testleri.
- Oturum oluşturma ve risk kararları (`allow`, `step-up`, `deny`) için
  fixture tabanlı testler.
- `apps/demo-web/auth.html` C# API'ye yönlendirildiğinde temel giriş akışı
  çalışır.

## Aşama 3 — Ağ, konum ve eski doğrulama endpoint'leri

**Durum (7 Ekim 2026): Uygulandı.** Altı endpoint C# Controllers API'ye
taşındı. IP seçimi, ülke normalizasyonu, saat dilimi farkı eşikleri, ağ
cezaları ve eski yanıt şemaları Node ile uyumludur. Eski VPN endpoint'i
Node gibi `scenario` alanını IP sorgusuna aktarmaz. Passkey ve yüz canlılık
endpoint'leri mevcut örnek sinyal davranışını korur.

`MOCK_IP_CHECK=1` ile temiz/riskli fixture'lar Python gerektirmeden çalışır.
Gerçek sorgu mevcut `python/ip_check.py` işçisini kullanır; argümanlar shell
kullanmadan aktarılır. Varsayılan zaman aşımı 15 saniye, stdout/stderr sınırı
akış başına 1 MiB'dır. Zaman aşımı ve istek iptalinde süreç ağacı kapatılır.
`PYTHON_CMD`, `VPNAPI_KEY`, `IP_CHECK_TIMEOUT_SECONDS` veya `IpCheck` .NET
yapılandırması kullanılabilir.

Doğrulama: solution 0 hata/0 uyarı ile derlendi; toplam 93 C# testi,
9 ilgili Node testi ve 155 canlı Node/C# HTTP karşılaştırması geçti.
Python köprüsü başarılı çıktı, bozuk JSON, nesne dışı JSON, hata çıkışı,
eksik çalıştırıcı, fazla çıktı, zaman aşımı ve iptal ile test edildi;
işçinin yanıt sonrasında çalışmadığı doğrulandı. Gerçek VPNAPI servisi
çağrılmadı; dış servis hata sözleşmeleri enjekte edilmiş hata ile sınandı.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage3
```

### Taşınacak endpoint'ler

- `POST /verify/network`
- `POST /verify/location`
- `POST /verify/vpn:check`
- `POST /verify/location:country`
- `POST /verify/webauthn:passkey`
- `POST /verify/face:liveness`

### Test kapısı

- Mock IP kontrolü ile deterministik testler.
- Geçersiz gövde, dış servis hatası ve başarılı karar senaryoları.

## Aşama 4 — Dinamik ve sabit metin klavye biyometrisi

**Durum (7 Ekim 2026): Uygulandı.** Beş endpoint C# API'ye taşındı.
Dinamik enrollment rıza kontrolü, ağırlıklı ortalama/varyans birleştirmesi,
tur/tuş hedefleri ve diğer biyometrik profillerin korunmasını içerir.
Doğrulama challenge'ı tek seferde tüketir; metin ve varsa oturum bağını
kontrol eder, mevcut skor ve EMA servislerini kullanır. Yanıtta güncel
profil, `profileUpdated` ve `signalsUsed.keystroke` alanları korunur.

Sabit metin akışı mevcut Python `keystroke_ml.py` işçisini JSON stdin/stdout
üzerinden çağırır. SHA-256 kullanıcı/metin hash'leri, Node şablon ve metadata
dosya biçimleri, örnek normalizasyonu, replay sınırları ve auto-enrollment
uyumludur. Atomik yazım ve süreç içi işlem kilidi kullanılır. Python
varsayılan zaman aşımı 2000 ms, çıktı sınırı stdout/stderr için ayrı ayrı
1 MiB'dır; zaman aşımı, iptal ve çıktı sınırında süreç ağacı kapatılır.
Hatalar 502 `PYTHON_*` zarfında döner; geçersiz worker şeması kaydedilmez.

Doğrulama: toplam 132 C# testi, 122 canlı Node/C# HTTP karşılaştırması,
12 ortak metrik/profil/skor fixture'ı, eşleşen profil/şablon/metadata dosyaları
ve 6 Python testi geçti. Sayısal HTTP karşılaştırma toleransı 1e-6'dır;
rastgele ID ve zaman alanları normalize edilir. Gerçek Python enrollment,
verify ve auto-enrollment çalıştırıldı; eksik çalıştırıcı, bozuk/nesne dışı
JSON, worker hata yanıtı, hatalı şema, hata çıkışı, fazla stdout/stderr,
timeout ve iptal test edildi. Node'da 103 (isteğe bağlı gerçek Python
entegrasyonu ayrıca etkinleştirilerek), SDK'da 36 test geçti.
Paylaşılan klavye servisi için 94 Aşama 2 HTTP karşılaştırması da yeniden geçti.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage4
py -3 -m unittest discover -s packages/node-auth/src/keystroke/python -p "test_*.py"
```

`SECUREKIT_KEYSTROKE_STORE` / `Keystroke:StorePath` ayrı sabit metin depo
kökünü, `SECUREKIT_SERVER_SALT` / `Keystroke:ServerSalt` kullanıcı hash tuzunu
ayarlar. Mevcut Node deposunu okumak için aynı tuz ve depo kökü kullanılmalıdır;
iki API aynı dosyalara eşzamanlı yazmamalıdır. Worker Python standart
kütüphanesiyle çalışır, ek paket gerektirmez.

### Taşınacak endpoint'ler

- `POST /enroll/keystroke`
- `POST /verify/keystroke`
- `GET /api/securekit/keystroke/status`
- `POST /api/securekit/keystroke/enroll`
- `POST /api/securekit/keystroke/verify`

### Notlar

- TypeScript'teki skor ve profil matematiği C# domain servislerine taşınır.
- Sabit metin doğrulamasında Python işçisi korunur; standard input/output için
  zaman aşımı, iptal, hata ayıklama kaydı ve kaynak temizliği uygulanır.

### Test kapısı

- Node test fixture'ları C# testlerine de uygulanır.
- Aynı veri için karar ve sayısal skorların tanımlı tolerans içinde eşleşmesi.
- Python işçisi yok, zaman aşımına uğramış ve hatalı JSON döndürmüşken API'nin
  güvenli hata vermesi.

## Aşama 5 — Yüz doğrulama ve kayan pencere

**Durum (7 Ekim 2026): Uygulandı.** Mevcut üç Node rotası C# API'ye
taşındı. Referans seçimi upload > açık yol > profil > örnek kullanıcı
eşlemesi sırasını korur. Referans yenilendiğinde önceki yönetilen dosya
silinir; diğer biyometrik profiller korunur. JPEG/PNG/WebP ve varsayılan
5 MiB dosya sınırı uygulanır. Dosya uzantısı istemcinin dosya adından değil
MIME türünden üretilir; Node gibi `.exe` adlı bir JPEG upload kabul edilir.
Kayan pencere mevcut Python manifest/embedding biçimini, bootstrap,
`updateOnSuccess`, skor ortalaması ve FIFO çıkarma davranışını korur.

Python mevcut CLI giriş noktalarıyla çağrılır; shell kullanılmaz. Varsayılan
zaman aşımı 30 saniye, stdout/stderr sınırı ayrı ayrı 1 MiB'dır. İptal,
zaman aşımı ve fazla çıktıda süreç ağacı kapatılır; geçici dosyalar tüm
sonuçlarda temizlenir. Geçerli negatif Python sonucu, çıkış kodu 1 olsa da
HTTP 200 olarak korunur. Referans yolları izin verilen köklerle sınırlıdır
ve sembolik bağlantı hedefleri kontrol edilir. C# kayan pencere rotası,
depo dışına yazılmasını önlemek için dizin ayırıcıları/`..` içeren kullanıcı
kimliklerini ayrıca 400 ile reddeder; bu koruma eski Node rotasında yoktur.

Doğrulama: 171 C# testi, 48 deterministik canlı Node/C# karşılaştırması
ve gerçek yerel FaceNet ile 8 uçtan uca HTTP karşılaştırması geçti. Gerçek
kontrol referans yenileme, profil üzerinden eşleşme, upload önceliği,
boş pencere, bootstrap, güncellemesiz doğrulama ve FIFO çıkarma içerir;
profil/manifest JSON'ları ve `.npy` embedding dosyaları eşleşti. Örnek
görseller ve üretilen biyometrik veriler git'e eklenmedi. Node'da 102,
SDK'da 36 test geçti; isteğe bağlı sabit metin Python testi atlandı.

`FACE_PYTHON_BIN`, `FACE_DEVICE`, `FACE_REQUIRE_GPU`, `FACE_UPLOAD_MAX_BYTES`,
`FACE_MATCH_THRESHOLD`, `FACE_PYTHON_TIMEOUT_MS`, `FACE_PYTHON_SCRIPT_PATH`
ve `FACE_SLIDING_REFERENCES_ROOT` desteklenir. C# referans kökü
`Face__ReferenceDirectory`, ek izinli kökler `Face__AllowedReferenceRoots__0`
ile ayarlanır. Varsayılan depolar `apps/securekit-api/.securekit/` altındadır;
Node ve C# aynı depolara eşzamanlı yazmamalıdır.

Bu aşamada C# her istek için ayrı Python süreci açar; model her seferinde
yüklenir. Node'un kalıcı yüz worker'ına göre sıcak istek gecikmesi daha
yüksektir. İlk model indirmesi için gerekirse timeout artırılmalıdır.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage5

# İsteğe bağlı gerçek FaceNet kontrolü; görsel yalnızca yerelde kullanılır.
$env:FACE_PYTHON_BIN=(Resolve-Path .venv-face/Scripts/python.exe).Path
$env:SECUREKIT_FACE_REAL_IMAGE="C:/path/to/local-face.jpg"
pnpm --filter @securekit/node-auth test:aspnet-stage5
```

### Taşınacak endpoint'ler

- `POST /enroll/face/reference`
- `POST /verify/face`
- `POST /verify/face-sliding` (Node'da ilk kayıt boş pencereyi bootstrap eder;
  ayrı `/enroll/face/sliding-window` rotası yoktur)

### Test kapısı

- `multipart/form-data` alan adları ve response şeması uyumluluğu.
- Boyut limiti, uzantı/MIME kontrolü, Python time-out ve temizleme testleri.
- Referans kaydı ve aday karşılaştırma için en az bir uçtan uca fixture.

## Aşama 6 — Ses doğrulama

**Durum (7 Ekim 2026): Uygulandı.** İki endpoint C# API'ye taşındı.
Multipart `audioSample`, rıza kontrolü, tek kullanımlık challenge ve isteğe
bağlı oturum bağı Node davranışını korur. Whisper metin eşleşmesi enrollment
için zorunludur; verify sırasında uyuşmazlık HTTP 200 `deny` kararı verir.
Varsayılan üç örnekli enrollment, ağırlıklı embedding ortalaması, legacy
`voiceEmbedding`, cosine skoru, eşik kararları ve allow sonrası EMA profil
güncellemesi uyumludur. Diğer biyometrik profil alanları korunur; ses profil
işlemleri süreç içinde sıralanarak eşzamanlı örnek kaybı engellenir.

Mevcut `python/voice_verification/voice_worker.py` JSON-lines protokolü ve
SpeechBrain/Whisper modelleri korunur. C# her istekte ayrı worker başlatır,
`ready` mesajından sonra challenge metnini stdin üzerinden gönderir ve yanıt
geldiğinde worker'ı kapatır. Varsayılan timeout 120 saniye, stdout/stderr
sınırı ayrı ayrı 1 MiB'dır. İptal ve timeout süreç ağacını kapatır; Windows'ta
launcher alt süreçleri de Job Object ile yönetilir. Ses dosyaları tüm
sonuçlarda temizlenir; dosya uzantısı MIME türünden üretilir, istemci dosya
adı kullanılmaz. Varsayılan yükleme sınırı 12 MiB'dır.

Doğrulama: 208 C# testi (37 yeni ses testi), 72 canlı Node/C# HTTP
karşılaştırması, eşleşen kalıcı profil JSON'ları, Node'da 102 ve SDK'da
36 test ve Node TypeScript kontrolü geçti. Karşılaştırmalar model gerektirmeyen
Python protokol fixture'ı kullanır; gerçek SpeechBrain/Whisper modelleri bu
aşamada çalıştırılmadı. Hatalı şema/JSON, eksik runtime/bağımlılık, büyük çıktı,
timeout, iptal, alt süreç sonlandırma, metin uyuşmazlığı, challenge TTL/replay,
profil güncellemesi ve eşzamanlı enrollment test edilir.

`VOICE_PYTHON_BIN`, `VOICE_PYTHON_SCRIPT_PATH`, `VOICE_PYTHON_TIMEOUT_MS`,
`VOICE_DEVICE`, `VOICE_REQUIRE_GPU`, `VOICE_WHISPER_MODEL`, `VOICE_SPEAKER_MODEL`,
`VOICE_UPLOAD_MAX_BYTES`, `VOICE_MATCH_THRESHOLD`, `VOICE_TEXT_THRESHOLD` ve
`VOICE_MIN_ENROLLMENT_SAMPLES` desteklenir; karşılıkları `Voice` .NET
yapılandırma bölümünde bulunur. Ses ortamı yoksa `.venv-voice` kurulumunu
README'deki gibi yapın. Kalıcı Node worker'ına göre sıcak istek gecikmesi
daha yüksektir; ilk model indirmesi için gerekirse timeout artırılmalıdır.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage6
```

### Taşınacak endpoint'ler

- `POST /enroll/voice`
- `POST /verify/voice`

### Test kapısı

- Ses yükleme sözleşmesi, minimum enrollment örnek sayısı ve challenge metni
  bağının test edilmesi.
- Python SpeechBrain/Whisper süreci için timeout ve hata testi.

## Aşama 7 — Kart doğrulama

**Durum (7 Ekim 2026): Uygulandı.** Üç endpoint C# Controllers API'ye
taşındı. JPEG/PNG/WebP multipart sözleşmesi, 5 MiB varsayılan yükleme sınırı,
kullanıcı kimliği trim/lowercase normalizasyonu ve MIME tabanlı uzantılar
korunur. Referans listesi görselleri sıralar ve dosya adlarını etiketlere
dönüştürür. Kullanıcı referansı genel `referenceId` seçiminden önceliklidir.
Referans yenileme önceki yönetilen dosyayı siler; diğer biyometrik profil
alanları korunur. Enrollment işlemleri süreç içinde sıralanır.

Mevcut `python/card_verification/main.py --worker` JSON-lines protokolü
kullanılır. C# her istekte worker başlatır, `ready` sonrasında isteği gönderir
ve sonucu aldığında kapatır. Varsayılan timeout 300 saniyedir; stdout/stderr
ayrı ayrı 1 MiB ile sınırlanır. Timeout, iptal ve çıktı limitinde süreç ağacı
kapatılır; Windows launcher alt süreçleri Job Object ile yönetilir. Geçici
dosyalar tüm sonuçlarda temizlenir. Python yanıtında skor aralıkları, kararlar,
OCR alanları ve isteğe bağlı CLIP alanları doğrulanır; `documentNo` varsayılanı
boş metindir. Negatif karşılaştırmalar HTTP 200 olarak korunur.

Doğrulama: solution 0 hata/0 uyarıyla derlendi; 239 C# testi (31 yeni kart
testi), 60 canlı Node/C# HTTP karşılaştırması, eşleşen kalıcı profil JSON'ları,
Node'da 102 ve SDK'da 36 test ve Node TypeScript kontrolü geçti. İsteğe bağlı
sabit metin Python entegrasyonu atlandı. Kart karşılaştırmaları model
gerektirmeyen Python protokol fixture'ı kullanır; gerçek PaddleOCR/OpenCLIP
modelleri çalıştırılmadı. Başarılı/negatif sonuçlar, seçili/kullanıcı referansı,
referans yenileme, hatalı upload/JSON/şema, bağımlılık/çalıştırıcı yokluğu,
fazla stdout/stderr, timeout, iptal ve alt süreç sonlandırma test edilir.

`CARD_PYTHON_BIN`, `CARD_PYTHON_TIMEOUT_MS`, `CARD_UPLOAD_MAX_BYTES`,
`CARD_MATCH_THRESHOLD` ve `CARD_PYTHON_SCRIPT_PATH` desteklenir. Genel referans
kökü `Card:ReferenceDirectory`, kullanıcı kökü `Card:UserReferenceDirectory`,
geçici kök `Card:TempRoot`, ek Python argümanları `Card:PythonArgs` ile ayarlanır.
Depolanan referans yolları izinli köklerle ve çözümlenmiş sembolik bağlantı
hedefleriyle sınırlandırılır; bu C# koruması eski Node rotasında yoktur.
Eski harici kullanıcı referansları için `Card:AllowedReferenceRoots` ayarlayın.
Node ve C# aynı depolara eşzamanlı yazmamalıdır. Kalıcı Node worker'ına göre
sıcak isteklerde model yükleme gecikmesi daha yüksektir.

```powershell
dotnet build SecureKit.slnx
dotnet test SecureKit.slnx
pnpm --filter @securekit/node-auth test:aspnet-stage7
```

### Taşınacak endpoint'ler

- `GET /card/references`
- `POST /enroll/card/reference`
- `POST /verify/card`

### Test kapısı

- `multipart/form-data` uyumluluğu ve referans yönetimi testleri.
- PaddleOCR/OpenCLIP işçisi için başarısızlık, timeout ve başarılı fixture
  senaryoları.

## Aşama 8 — Paralel doğrulama ve kesintisiz geçiş

**Durum (7 Ekim 2026): Kod geçişi ve otomatik kabul kontrolleri uygulandı.**
Vite varsayılan hedefi C# API (3002) oldu; `VITE_SECUREKIT_API_BACKEND=node`
veya açık proxy hedefi ile Node seçilebilir. `pnpm dev` C# API ve demo'yu,
`pnpm dev:node` geri dönüş API'si ve demo'yu birlikte başlatır. Başlatıcı
seçilen backend'in proxy hedefini sağlar; terminaldeki açık hedef önceliklidir.
Eski yerel `.env` hedefleri bağımsız Vite kullanımında öncelikli kalır.

`pnpm test:aspnet-parity` yedi gruptaki 578 canlı Node/C# karşılaştırmasını
çalıştırır, grup sonuçlarını `.run-logs/aspnet-parity.json` içinde saklar.
Tam JSON yanıtları mevcut karşılaştırma araçlarında normalize edilerek
karşılaştırılır; rapora kişisel veri veya worker çıktısı yazılmaz.
`pnpm test:aspnet-demo` gerçek Vite proxy ve değişmeyen web SDK üzerinden
kayıt/giriş/rıza, oturum, ağ/konum, dinamik klavye/replay, yüz/kayan pencere,
ses, kart, sabit metin route prefix'i ve profil silmeyi doğrular. Depolar
geçicidir; biyometrik işçiler model gerektirmeyen protokol fixture'larıdır.

Doğrulama: 239 C# testi, Node'da 102 ve SDK'da 36 test; solution ve pnpm build,
TypeScript kontrolü geçti. İsteğe bağlı Node sabit metin Python testi atlandı
(Aşama 4 karşılaştırması gerçek Python işçisini çalıştırır). Headless Edge'de
`auth.html` kayıt/rıza, hatalı/başarılı giriş, oturum ve arka plan ağ/konum
HTTP 200 yanıtlarıyla kontrol edildi. Her iki ortak başlatıcının sağlık/proxy
yanıtları ve C# başlatıcısının Ctrl+C sonrası kapanması ayrıca doğrulandı.

Gerçek kamera/mikrofonla tüm biyometrik adımların manuel kabulü ve gerçek
SpeechBrain/Whisper/PaddleOCR/OpenCLIP kontrolü henüz tamamlanmadı. Node paketi
korunur; kaldırılması bu kabul tamamlandıktan sonra ayrı değişikliktir.
Mevcut depoların geçişi ve geri dönüş [yönergede](docs/ASPNET_CUTOVER.md) yer alır.

### Yapılacaklar

- Demo uygulamasının API hedefini ortam değişkeniyle Node veya ASP.NET API'ye
  seçilebilir yap.
- Her endpoint grubunda Node/C# yanıtlarını kayıt altına alıp karşılaştır.
- API hedefini C# uygulamasına al; Node API'yi kısa süre yalnızca geri dönüş
  için muhafaza et.
- Tüm işlevsel ve manuel duman testleri geçtikten sonra Node API paketinin
  kaldırılmasını ayrı bir değişiklikte yap.

### Nihai kabul kriterleri

- `dotnet test` ve mevcut `pnpm test` başarılıdır.
- Demo-web C# API üzerinden kayıt, giriş, consent, klavye, ağ/konum ve
  erişilebilir biyometrik akışları çalıştırır.
- Dosya yüklemeleri için boyut sınırları, geçici dosya silme ve Python timeout
  davranışları testlerle korunur.
- Gizli değerler, referans dosyaları ve biyometrik veriler git'e eklenmez.

## Başlama sırası

**Aşama 0–7 tamamlandı; Aşama 8 kod geçişi ve otomatik kabulü tamamlandı.**
Sonraki adım gerçek donanım/model ortamında manuel biyometrik kabulüdür.
Bu kabul tamamlandıktan sonra Node API paketinin kaldırılması ayrı bir
değişiklikte ele alınacaktır.

7 Ekim 2026 ek kontrolü: `pnpm test:biometric-preflight` komutu eklendi;
yüz/ses/kart bağımlılıkları ve FFmpeg geçti. Gerçek yerel FaceNet ile 8
Node/C# HTTP karşılaştırması yeniden geçti. Gerçek kart CPU OCR/OpenCLIP
backend'leri yüklendi; iki yerel örneğin sonucu `uncertain` olduğundan
olumlu kart kalite kabulü tamamlanmış sayılmaz. Yerel ses örneği ve manuel
kamera/mikrofon kabulü bekliyor. Ayrıntılar ve kalan kontrol tablosu
[biyometrik kabul yönergesindedir](docs/BIOMETRIC_ACCEPTANCE.md).
