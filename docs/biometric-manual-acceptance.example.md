# Yerel manuel biyometrik kabul kaydı

Bu dosyayı `.run-logs/acceptance/manual.md` konumuna kopyalayın. Yalnızca
gerçekten uygulanan kontrolleri `geçti` veya `kaldı` olarak işaretleyin.
Kişi adları, örnek dosya yolları, kayıt metni, OCR alanları ve embedding
eklemeyin. Bu kayıt insan gözlemidir; otomatik model raporunun yerine geçmez.

- Test tarihi / saat dilimi: bekliyor
- Test edilen Git commit'i (`git rev-parse HEAD`): bekliyor
- Tarayıcı / sürüm: bekliyor
- Yüz cihazı (`cpu` / `cuda`) ve model adı: bekliyor
- Ses cihazı (`cpu` / `cuda`), Whisper ve SpeechBrain model adları: bekliyor
- Kart cihazı (`cpu` / `cuda`), OCR ve OpenCLIP model adları: bekliyor
- Güncel ön kontrol raporu: bekliyor
- Güncel yüz/ses/kart model kabul raporu: bekliyor

| Kontrol | Beklenen sonuç | Sonuç |
| --- | --- | --- |
| Kullanıcı/rıza | Kayıt ve rıza başarılı; yeni oturum açılır | bekliyor |
| Yüz kaydı | Kameradan izinli referans kaydedilir | bekliyor |
| Aynı kişi | Yeni kamera çekimiyle yüz doğrulanır | bekliyor |
| Farklı kişi | Başka izinli kişinin yüzü reddedilir | bekliyor |
| Ses kaydı | Her tur yeni challenge; üç örnekle profil tamamlanır | bekliyor |
| Aynı konuşmacı | Yeni kayıt ve doğru metinle doğrulama başarılı | bekliyor |
| Farklı konuşmacı | Doğru metni okuyan başka izinli kişi reddedilir | bekliyor |
| Yanlış ses metni | Aynı kişinin yanlış metinli kaydı reddedilir | bekliyor |
| Kart kaydı | Kameradan kart referansı kaydedilir | bekliyor |
| Aynı kart | Yeni çekim `same` sonucuyla başarılı | bekliyor |
| Farklı kart | Başka kart `different` sonucuyla olumsuz | bekliyor |
| Klavye | Kayıt hedefi tamamlanır; yeni challenge ile doğrulama yapılır | bekliyor |
| Tam oturum | Ağ/konum ve biyometrik adımlardan sonra sonuç ekranı açılır | bekliyor |
| Kamera izni reddi | Anlaşılır hata; izin verildikten sonra tekrar denenebilir | bekliyor |
| Mikrofon izni reddi | Anlaşılır hata; izin verildikten sonra tekrar denenebilir | bekliyor |
| Profil silme | Silme sonrası biyometrik işlem yeniden kayıt ister | bekliyor |

Genel sonuç: bekliyor

Tüm satırlar ve üç modülün gerçek model kabulü geçmeden genel sonucu
tamamlandı olarak işaretlemeyin. `uncertain`, `step_up`, eksik örnek ve
model hatası başarılı kabul sayılmaz. Kalan sorunları kişisel veri içermeyen
kısa açıklamalarla kaydedin. Node geri dönüşünün kaldırılması ayrı bir iştir.
