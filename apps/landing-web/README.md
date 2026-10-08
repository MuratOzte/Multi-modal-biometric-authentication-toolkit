# SecureKit tanıtım sitesi

Türkçe ve İngilizce, bağımsız React + TypeScript + Vite tanıtım uygulaması.
NEVERHACK stil referansının açık yüzey, koyu lacivert yazı, mor AI vurgusu,
ince çizgiler ve yuvarlak buton dili SecureKit'e uyarlanmıştır.

Repo kökünden `pnpm dev:landing` ile başlatın (`http://localhost:5174`).
`pnpm build:landing` üretim çıktısını `apps/landing-web/dist` altında oluşturur.
`pnpm --filter landing-web lint` kaynak kodunu kontrol eder.

## Dil ve SEO

- `/tr/` Türkçe, `/en/` İngilizce tanıtım sayfasıdır. Üretim derlemesi iki
  sayfanın tam HTML içeriğini önceden oluşturur; JavaScript olmadan da okunabilir.
- `/` adresinde önce kaydedilmiş TR/EN seçimi, sonra tarayıcının sıralı
  `navigator.languages` tercihleri kullanılır. Desteklenmeyen diller için
  İngilizce açılır. Doğrudan `/tr/` veya `/en/` açıldığında adresin dili korunur.
- Üst menüdeki TR/EN bağlantıları mobilde de görünür; seçim hatırlanır,
  mevcut bölüm ve sorgu parametreleri korunur. Depolama engelliyse site çalışır.
- Her dilin kendine ait başlık, açıklama, `lang`, canonical, karşılıklı
  `hreflang`, `x-default`, Open Graph ve Twitter meta etiketleri vardır.
- Yayın adresini `apps/landing-web/.env.production` içinde
  `VITE_SITE_URL=https://alan-adiniz.com` olarak veya derleme ortamında tanımlayın.
  Derleme mutlak SEO bağlantılarını, `sitemap.xml` ve `robots.txt` dosyalarını üretir.
  Alan adı ayarlanmadan yerel derleme çalışır, bağlantılar göreli kalır ve
  geçersiz bir sitemap oluşturulmaz. Yayından önce gerçek alan adıyla derleyin.
- Hosting, `dist/tr/index.html` ve `dist/en/index.html` dosyalarını ilgili
  dizin adreslerinde sunmalıdır. Site alan adının köküne kurulur.
- Wiki arşivi Türkçe ve İngilizce sunulur; seçilen dil makalelere, aramaya,
  başlıklara ve wiki arayüzüne uygulanır. Wiki hash rotaları ana sayfanın
  SEO metadatasını kullanır ve açıkken
  istemci tarafında `noindex` işaretlenir; sitemap'e eklenmez.

`pnpm --filter landing-web test:i18n` dil seçimini, dil bağlantılarını ve
üretilmiş HTML/SEO çıktısını doğrular (önce `build:landing` çalıştırın).

- Yüz nokta bulutu SVG ile deterministik üretilir; raster görsel gerektirmez.
- Masaüstünde modül görseli kaydırmayla değişir; mobilde her modül kendi görselini taşır.
- Karar seçimi yerel örnek verilerle çalışır, API isteği veya biyometrik veri toplama yoktur.
- Hareket duraklatma tüm animasyonları kapsar; `prefers-reduced-motion` desteklenir.
- Inter çevrimiçi yüklenir; erişilemezse sistem fontuna geçilir.

## Resource Wiki

Tanıtım sitesinin menüsünden, `http://localhost:5174/tr/#/wiki/1-overview`
veya `http://localhost:5174/en/#/wiki/1-overview`
adresinden açılır. DeepWiki'nin 7 Ekim 2026 tarihli, `7b9cbda5` commitine
dayanan 27 sayfalık içeriği İngilizce ve Türkçe yerel HTML olarak sunulur. Kaynak dosya
ve satır bağlantıları korunur. Sayfalar ve 43 görünür SVG diyagramı dış
servise ihtiyaç duymadan yüklenir. Kaynak DeepWiki'de çizilemeyen diyagramlar
aktarılmaz; bu arşiv otomatik olarak güncellenmez.

- Solda hiyerarşik konu ağacı, sağda sayfa içindekiler; mobilde açılır menüler.
- Tam metin arama, `Ctrl/Cmd+K`, doğrudan sayfa/bölüm bağlantıları, önceki/sonraki sayfa.
- Diyagramlar tıklama veya klavye ile açılır; yakınlaştırma ve Escape ile kapatma.
- Wiki kodu ayrı yüklenir; ana sayfanın ilk yüklemesine içerik arşivi eklenmez.
- Hash rotaları statik hosting üzerinde ayrıca sunucu yönlendirmesi gerektirmez.
- Wiki üst menüsündeki TR/EN seçimi mevcut makaleyi ve bölüm bağlantısını korur.
- Türkçe makaleler `public/wiki/tr/`, Türkçe arama ve başlık dizini
  `src/wiki-index-tr.json` içindedir. Kod örnekleri, uç nokta adları ve özgün
  SVG diyagramları teknik doğruluğu korumak için kaynak biçiminde tutulur.

`pnpm --filter landing-web test:wiki` sayfa bütünlüğünü, iç bağlantıları,
bölüm hedeflerini, diyagramları ve kod örneklerinin satırlarını denetler.
Arşiv yenilemek için tarayıcıdan alınan `{title,url,html,text,headings}`
alanlarına sahip sayfa dizisini `python scripts/import-resource-wiki.py capture.json`
ile işleyin. Script yalnızca izin verilen HTML/SVG öğelerini aktarır;
DeepWiki arayüz kodunu, sohbet alanını veya üçüncü taraf scriptlerini içermez.
Ardından `src/wiki-translations-tr.json` içindeki ilgili çevirileri güncelleyip
`python scripts/localize-resource-wiki.py` çalıştırın. Her kayıt kaynak metin
ve çeviri çiftidir; `{0}` gibi yer tutucular kod ve kaynak bağlantılarını korur.
Üretici, değişmiş kaynak metinlerini ve eksik yer tutucuları hata olarak bildirir;
eksik çevirilerle sessizce İngilizceye dönmez.

Yayınlama ayrı bir çalışmadır.
