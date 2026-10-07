# Gerçek biyometrik kabul

Aşama 8'in protokol fixture'ları HTTP uyumluluğunu doğrular. Bu kontrol,
yerel modeller ve donanımla kalan kabulü tamamlamak için kullanılır.
İzinli görseller/sesler yerelde kalır; git'e eklenmez. Kayıt metni, OCR
alanları, embedding veya kişisel dosya yollarını kabul raporuna koymayın.

## Ortam ön kontrolü

```powershell
pnpm test:biometric-preflight
# pnpm kullanılamıyorsa aynı kontrol:
node scripts/biometric-preflight.mjs
```

Kontrol yüz, ses ve kart bağımlılıklarını gerçek Python import'larıyla sınar;
yüz/ses için CUDA gereksinimini, ses için FFmpeg'i kontrol eder. Model
ağırlıkları yüklenmez/indirilmez ve görseller okunmaz. Eksik zorunlu
bağımlılıkta çıkış kodu 1'dir. `.run-logs/biometric-preflight.json` yalnızca
modül adları, Python sürümü ve hata türlerini tutar; git tarafından yok sayılır.
Bağımlılıklar geçse bile model ve donanım kabulü `pending` kalır.

Çalıştırıcı önceliği `*_PYTHON_BIN`, `PYTHON_BIN`, modülün
`*__PythonCommand` değişkeni, yerel `.venv-*`, sistem Python'udur.
`py -3` ve `py -3.11` desteklenir. Yerel venv otomatik seçimi yalnızca bu
kontrole aittir; API için aşağıdaki gibi açıkça ayarlayın:

```powershell
$env:FACE_PYTHON_BIN=(Resolve-Path .venv-face/Scripts/python.exe).Path
$env:VOICE_PYTHON_BIN=(Resolve-Path .venv-voice/Scripts/python.exe).Path
# Kart ortamı kurulduysa:
$env:CARD_PYTHON_BIN=(Resolve-Path .venv-card/Scripts/python.exe).Path
```

Bu araç appsettings/User Secrets ve özel `PythonArgs` dizilerini çözümlemez;
bu ayarlar kullanılıyorsa gerçek API testi ayrıca gerekir. Kartın isteğe
bağlı eski `clip` modülü eksikse raporda belirtilir. Asıl OpenCLIP ve OCR
bağımlılıkları zorunludur. Kurulum komutları README'dedir.

## Gerçek FaceNet HTTP karşılaştırması

Mevcut Aşama 5 aracı geçici ayrı depolarla kayıt, referans yenileme,
doğrulama ve kayan pencere işlemlerini iki API üzerinde karşılaştırır:

```powershell
dotnet build SecureKit.slnx
$env:FACE_PYTHON_BIN=(Resolve-Path .venv-face/Scripts/python.exe).Path
$env:SECUREKIT_FACE_REAL_IMAGE="C:/yerel/izinli-yuz.jpg"
node --import tsx packages/node-auth/scripts/stage-five-parity.ts
Remove-Item Env:SECUREKIT_FACE_REAL_IMAGE
```

Bu test aynı görselle sözleşme/model entegrasyonunu kontrol eder; farklı
kişi, ışık koşulları veya gerçek kamera kalitesinin kabulü ayrıca gerekir.

## Gerçek ses/kart HTTP kabul aracı

Sonraki kabul adımı için `scripts/biometric-acceptance.mjs` hazırdır.
Araç gerçek C# API'yi boş, geçici depolarla ve rastgele bir yerel portta
başlatır; üretim ses/kart Python işçilerini kullanır. Çalışan demo'ya veya
mevcut kullanıcı/referans depolarına bağlanmaz. API kapanınca kendi geçici
deposunu siler. Model ağırlıkları ilk kullanımda indirilebilir ve model
önbellekleri kalır. Kamera/mikrofon testini bu araç yerine geçirmez.

Yerel manifesti ve izinli örnekleri git'in yok saydığı dizinde hazırlayın:

```powershell
New-Item -ItemType Directory -Force .run-logs/acceptance/samples | Out-Null
Copy-Item docs/biometric-acceptance.example.json .run-logs/acceptance/manifest.json
# Örnekleri .run-logs/acceptance/samples altına koyun.
# Manifestteki text değerleri kayıtlarda gerçekten okunan metinler olmalıdır.
node scripts/biometric-acceptance.mjs .run-logs/acceptance/manifest.json --check

dotnet build SecureKit.slnx
$env:VOICE_PYTHON_BIN=(Resolve-Path .venv-voice/Scripts/python.exe).Path
# Kart çalıştırıcısını kendi kurulu ortamınıza göre seçin; örneğin:
$env:CARD_PYTHON_BIN="py -3.11"
pnpm test:biometric-acceptance .run-logs/acceptance/manifest.json
# pnpm kullanılamıyorsa:
node scripts/biometric-acceptance.mjs .run-logs/acceptance/manifest.json
```

Manifestten `voice` veya `card` bölümünü kaldırarak tek modülü çalıştırabilirsiniz.
Dosya yolları manifestin dizinine göre çözülür. `--check` yalnızca dosyaların
varlığını, türünü, boyutunu ve metin alanlarını kontrol eder; model çalıştırmaz.
Desteklenen ses uzantıları wav/webm/mp3/m4a/ogg, görseller jpg/jpeg/png/webp'dir.
Ses sınırı 12 MiB, görsel sınırı 5 MiB'dir; API'deki daha düşük yükleme sınırları
ayrıca geçerlidir. İşçi süreleri için `VOICE_PYTHON_TIMEOUT_MS` ve
`CARD_PYTHON_TIMEOUT_MS` geçerlidir; aracın HTTP istek sınırı 660 saniyedir.

Ses için aynı kişiden üç ayrı enrollment kaydı ve yeni bir olumlu kayıt,
başka bir izinli kişiden bir olumsuz kayıt gerekir. Her istekte yeni challenge
oluşturulur; kayıt metni manifestten alınır. Yanlış metin kontrolünde olumlu
kayıt farklı bir challenge metniyle tekrar gönderilir. Ayrı dosyalar gereklidir;
dosya adlarını değiştirerek aynı kaydı çoğaltmak kabul örneği sayılmaz.
Enrollment hedefi üç örnektir; diğer eşikler mevcut API ayarlarından alınır
ve test tarafından gevşetilmez. Doğrulama sırasında profil güncellenmez.

Kart için referans, aynı kartın yeni çekimi ve farklı kartın çekimi gerekir.
`same` / `different` kararları, OCR ve CLIP backend'lerinin erişilebilir olması
aranır; `uncertain` veya backend hatası kabulü geçirmez. Farklı konuşmacı
kontrolü doğru metin ve `deny`, yanlış metin kontrolü metin uyuşmazlığı ve
`deny` gerektirir; `step_up` olumlu kabul sayılmaz.

`.run-logs/biometric-acceptance.json` yalnızca tarih, seçilen modüller,
sabit kontrol adları ve geçti/kaldı bilgisi içerir. Ham yanıtlar, kayıt metni,
OCR alanları, embedding ve dosya yolları yazılmaz. Başarı
`passed-for-selected-samples` olarak kaydedilir; bu sonuç yalnızca seçilen
örnekler ve modüller için geçerlidir. Donanım kabulü `pending` kalır.
Başarısız kontrol çıkış kodu 1 verir. Manifest geçersizse yeni rapor yazılmaz;
önceki bir raporu güncel sonuç olarak kullanmayın. `pnpm test:biometric-tools`
aracın testlerini derleme sonrası çalıştırır; bu testler gerçek model kalite
kabulünü tamamlamaz.

## Manuel kabul kaydı

Gerçek Python ortamlarını ayarlayıp `pnpm dev` ile `auth.html` açın.
Sonuçları aşağıdaki sırayla yerel bir kayıt üzerinde geçti/kaldı olarak tutun.

| Kontrol | Beklenen sonuç |
| --- | --- |
| Kullanıcı/rıza | Kayıt ve rıza başarılı, yeni oturum açılabilir |
| Yüz kaydı | İzinli kamera örneğiyle referans kaydedilir |
| Yüz doğrulama | Yeni aynı kişi örneği başarılı; farklı kişi reddedilir |
| Ses kaydı | Her tur yeni challenge alınır, üç örnekle profil tamamlanır |
| Ses doğrulama | Doğru metin/kişi başarılı; yanlış metin reddedilir |
| Kart kaydı/doğrulama | Aynı kart başarılı; farklı kart olumsuz sonuç verir |
| Klavye | Kayıt hedefi tamamlanır; yeni challenge ile doğrulama yapılır |
| Tam oturum | Ağ/konum ve biyometrik adımlardan sonra sonuç ekranı açılır |
| İzin reddi | Kamera/mikrofon reddinde anlaşılır hata, tekrar deneme mümkün |
| Profil silme | Profil silinir; sonraki işlem yeniden kayıt ister |

Sonuca tarih, CPU/GPU seçimi ve kullanılan model adlarını ekleyin.
Gerçek SpeechBrain/Whisper ve PaddleOCR/OpenCLIP ile olumlu/olumsuz örnekler
ve bu tablo tamamlanmadan Node geri dönüş paketini kaldırmayın.

## Yerel kontrol sonucu — 7 Ekim 2026

| Kontrol | Sonuç |
| --- | --- |
| .NET solution derlemesi | 0 hata, 0 uyarı |
| Yüz bağımlılıkları | Geçti; CUDA erişilebilir |
| Ses bağımlılıkları / FFmpeg | Geçti; CUDA erişilebilir |
| Kart bağımlılıkları | Sistem Python 3.11.4 ile geçti; isteğe bağlı eski `clip` modülü yok |
| Gerçek FaceNet Node/C# | 8 HTTP karşılaştırması, kalıcı depo uyumu ve geçici dosya temizliği geçti |
| Gerçek kart modelleri | CPU OCR ve OpenCLIP ağırlıkları yüklendi; iki yerel örnek `uncertain` verdi |
| Gerçek ses örneği | Python dizininde ses dosyası bulunamadığından yapılmadı |
| Kamera/mikrofon, tam oturum ve olumlu/olumsuz kalite kabulü | Bekliyor |

Kart kontrolünde OCR/OpenCLIP backend'leri erişilebilir ve backend hata
alanları boştu. `uncertain` sonucu olumlu kart kabulü sayılmaz; farklı
çekimlerle kalite kontrolü tamamlanmalıdır. İlk ön kontrol Paddle'ı
Torch'tan önce yüklediğinde Windows DLL hatası verdi; gerçek işçi gibi
Torch önce yüklendiğinde üç ortamın ön kontrolü geçti. Ön kontrol bu sırayı
kullanır. Hiçbir görsel, OCR alanı veya embedding commit'e eklenmedi.
