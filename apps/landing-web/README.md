# SecureKit tanıtım sitesi

Türkçe, bağımsız React + TypeScript + Vite tanıtım uygulaması.
NEVERHACK stil referansının açık yüzey, koyu lacivert yazı, mor AI vurgusu,
ince çizgiler ve yuvarlak buton dili SecureKit'e uyarlanmıştır.

Repo kökünden `pnpm dev:landing` ile başlatın (`http://localhost:5174`).
`pnpm build:landing` üretim çıktısını `apps/landing-web/dist` altında oluşturur.
`pnpm --filter landing-web lint` kaynak kodunu kontrol eder.

- Yüz nokta bulutu SVG ile deterministik üretilir; raster görsel gerektirmez.
- Masaüstünde modül görseli kaydırmayla değişir; mobilde her modül kendi görselini taşır.
- Karar seçimi yerel örnek verilerle çalışır, API isteği veya biyometrik veri toplama yoktur.
- Hareket duraklatma tüm animasyonları kapsar; `prefers-reduced-motion` desteklenir.
- Inter çevrimiçi yüklenir; erişilemezse sistem fontuna geçilir.

Bu uygulama tanıtım kapsamındadır. Documentation ve yayınlama ayrı çalışmalardır.
