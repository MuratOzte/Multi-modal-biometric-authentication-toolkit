# C# API'ye geçiş ve Node'a geri dönüş

7 Ekim 2026 itibarıyla demo'nun varsayılan API'si ASP.NET Core 10'dur.
Express API geri dönüş ve sözleşme karşılaştırmaları için korunur.

## Başlatma ve hedef seçimi

Repo kökünde `pnpm dev` API'yi derler; C# API 3002, Vite 5173 portunu kullanır.
Ctrl+C iki uygulamayı durdurur. API kodu değişince komutu yeniden başlatın.
`pnpm dev:node` Node API'yi 3001 üzerinde başlatır ve demo'yu ona bağlar.
Node seçeneği .NET SDK gerektirmez.

Ortak başlatıcı, seçilen backend'in proxy hedefini terminal ortamına yazar;
bu değer Vite `.env` dosyasındaki eski hedefin önüne geçer. Terminalde açık
`VITE_SECUREKIT_DEV_PROXY_TARGET` varsa bu değer korunur. Özel port kullanırken
API ve proxy hedefini birlikte ayarlayın.

API'yi ayrıca başlatıp `pnpm --filter demo-web dev` kullanırken Vite'nin
hedef önceliği şöyledir:

1. `VITE_SECUREKIT_DEV_PROXY_TARGET` (boş olmayan açık URL).
2. `VITE_SECUREKIT_API_BACKEND`: `aspnet` → 3002, `node` → 3001.
3. Hiçbiri tanımlı değilse C# API, 3002.

Vite `.env` değişikliğinden sonra yeniden başlatılmalıdır. Eski `.env`
dosyanızda 3001 hedefi varsa kaldırın veya 3002 olarak güncelleyin. API
`.env` dosyasını otomatik yüklemez; API değişkenlerini terminalde tanımlayın.
`vite preview` geliştirme proxy'sini çalıştırmaz. Üretim sunucusunda
`/api/securekit` proxy'si veya uygun `VITE_SECUREKIT_BASE_URL` gerekir;
sabit metin `/api/securekit/keystroke/*` yollarının prefix'i korunmalıdır.

## Mevcut kayıtlarla geçiş

Yeni C# kurulumunda depolar `apps/securekit-api/.securekit` altında oluşturulur;
Node dosyaları otomatik taşınmaz. Mevcut kayıtları kullanacaksanız önce Node
API'yi durdurun, kullanıcı/profil dosyalarını ve referans/klavye depolarını
yerelde yedekleyin. Aynı dosyalara iki API aynı anda yazmamalıdır.

Node'u paket dizininden başlatan standart kurulum için C# terminal örneği:

```powershell
$securekitRoot = (Get-Location).Path
$env:SECUREKIT_USERS_FILE = Join-Path $securekitRoot "users.json"
$env:SECUREKIT_PROFILE_STORE = Join-Path $securekitRoot "packages/node-auth/.securekit/user-profiles.json"
$env:SECUREKIT_KEYSTROKE_STORE = Join-Path $securekitRoot "packages/node-auth/.data/keystroke"
$env:Face__ReferenceDirectory = Join-Path $securekitRoot "packages/node-auth/.securekit/face-references"
$env:FACE_SLIDING_REFERENCES_ROOT = Join-Path $securekitRoot "packages/node-auth/.securekit/face-sliding-window"
$env:Card__UserReferenceDirectory = Join-Path $securekitRoot "packages/node-auth/.securekit/card-references"
$env:MOCK_IP_CHECK = "1"
pnpm dev
```

Yolları kendi eski kurulumunuzla eşleştirin: Node kullanıcı deposu önce
çalışma dizinindeki `users.json`, sonra repo kökündeki dosyayı arar; profil
deposu çalışma dizinine göre oluşur. Özel `SECUREKIT_USERS_FILE` ve
`SECUREKIT_PROFILE_STORE` değerlerini koruyun. Sabit metin kullanıcı hash'leri
için mevcut `SECUREKIT_SERVER_SALT` aynı kalmalıdır. Harici yüz/kart
referansları varsa `Face__AllowedReferenceRoots__0` ve
`Card__AllowedReferenceRoots__0` ile yalnızca gerekli köklere izin verin.
Python çalıştırıcılarını README'deki modül ayarlarıyla ayrıca tanımlayın.

## Geri dönüş

1. C# API ve demo'yu Ctrl+C ile durdurun.
2. Node'un aynı kullanıcı/profil dosyalarını kullandığını kontrol edin.
3. Terminalde C#'a sabitlenen açık proxy hedefini kaldırın:
   `Remove-Item Env:VITE_SECUREKIT_DEV_PROXY_TARGET -ErrorAction SilentlyContinue`.
4. `pnpm dev:node` çalıştırın ve kayıt/giriş akışını kontrol edin.

Oturumlar ve challenge'lar bellektedir; API değişince yeniden giriş yapılmalı
ve yeni challenge alınmalıdır. Profil güncellemeleri mevcut JSON biçimini
korur. C# referans köklerini değiştirdiyseniz Node varsayılan kökleriyle
yeniden eşleştirin. Referansları yenilemek eski yönetilen dosyayı silebildiği
için yalnızca JSON yedeği yeterli değildir; referans dosyalarını da yedekleyin.

## Kabul kanıtı

```powershell
dotnet test SecureKit.slnx
pnpm test
pnpm build
pnpm typecheck
pnpm test:aspnet-parity
pnpm test:aspnet-demo
```

| Kontrol | 7 Ekim 2026 sonucu |
| --- | --- |
| C# testleri | 239 geçti |
| Node / SDK | 102 / 36 geçti; isteğe bağlı bir Node testi atlandı |
| Node/C# HTTP sözleşmeleri | 7 grupta 578 karşılaştırma geçti |
| Solution / TypeScript / demo build | Geçti |
| Vite proxy + SDK | Hesap, rıza, oturum, ağ/konum, klavye/replay, yüz/sliding, ses, kart, prefix ve silme geçti |
| Headless Edge `auth.html` | Kayıt/rıza, hatalı/başarılı giriş, oturum, ağ/konum geçti |
| Başlatıcılar | C# ve Node proxy sağlık yanıtları; C# Ctrl+C kapanışı geçti |

Karşılaştırma özeti `.run-logs/aspnet-parity.json` içindedir ve git'e eklenmez.
Testler ayrı geçici depolar kullanır; kişisel referans, profil veya gizli değer
gerektirmez. Yüz/ses/kart smoke testleri protokol fixture'ları kullanır; model
kalitesini veya kamera/mikrofon donanımını doğrulamaz. Gerçek FaceNet kontrolü
Aşama 5'te yapıldı; bu aşamada gerçek modeller tekrar çalıştırılmadı.

Manuel kabul için gerçek Python ortamlarıyla `auth.html` üzerinde yüz, kart,
üç ses örneği ve klavye kaydını tamamlayın; sonra yeni oturumda tüm adımları
tamamlayıp sonuç ekranını doğrulayın. Playground'da negatif biyometrik örnek
ve rıza/profil silmeyi de deneyin. Bu donanım/model kabulü tamamlanana kadar
Node paketini kaldırmayın; paket kaldırma ayrı bir değişikliktir.

Ortam ön kontrolü, gerçek FaceNet karşılaştırma komutu ve kalan manuel
kabul tablosu [biyometrik kabul yönergesinde](BIOMETRIC_ACCEPTANCE.md) yer alır.
