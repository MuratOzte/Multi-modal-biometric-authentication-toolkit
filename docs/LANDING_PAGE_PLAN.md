# SecureKit — Landing page planı

## Amaç ve kapsam

İlk aşamada SecureKit'i tanıtan tek bir landing page hazırlanacak. Ziyaretçi ürünün hangi sinyalleri değerlendirdiğini, bu sinyallerin nasıl birleştiğini ve projeyi nereden inceleyebileceğini anlayacak. Documentation sayfası ikinci aşama; ilk teslimde kurulum rehberi, API referansı veya yeni doğrulama backend'i oluşturulmayacak.

Hedef kitle: biyometrik doğrulamayı uygulamasına eklemek isteyen geliştiriciler ve projeyi değerlendiren teknik ziyaretçiler. İlk içerik dili Türkçe; teknik terimler gerektiğinde özgün isimleriyle kullanılacak.

## Tasarım yönü

**Görsel tez:** Grafit bir yüzey üzerinde insan kimliğini temsil eden noktalı bir yüz formu ve mint sinyal çizgileri; sakin, hassas ve teknik bir görünüm.

**İçerik planı:** Büyük SecureKit hero'su → modüllerin sırayla tanıtımı → birleşik karar akışı → geliştirici entegrasyonu → projeyi inceleme çağrısı.

**Etkileşim tezi:** Hero'da sinyallerin bir araya gelmesi, kaydırma sırasında modüller arasında değişen sabit görsel, örnek senaryo seçiminde karar akışının geçişi.

- Renkler: grafit `#0B0F10`, kırık beyaz `#F1F4EF`, mint `#A8F0C6`. İkincil metin kontrastı uygulamada kontrol edilecek.
- Tipografi: büyük ve sade bir sans-serif; yalnızca teknik etiketlerde monospace. En fazla iki font ailesi.
- Kompozisyon: kenardan kenara hero, geniş boşluklar, ince ayırıcılar ve editoryal bölüm düzeni. Modüller eşit boy kartlardan oluşan bir ızgaraya sıkıştırılmayacak.
- Görsel kimlik biyometrik sinyallere dayanacak. Parmak izi, repo tarafından doğrulanan bir özellik olmadığı için ürün modülü olarak gösterilmeyecek.

## Sayfa akışı ve önerilen metinler

### 1. İlk ekran — SecureKit

En büyük metin ürün adı: **SecureKit**.

Başlık: **Kimliğinizi birden fazla sinyalle doğrulayın.**

Açıklama: “Yüz, ses, yazım ritmi ve bağlamsal sinyalleri ortak bir doğrulama akışında birleştiren geliştirici araç seti.”

Birincil CTA: **Nasıl çalışır?** — sayfadaki akış bölümüne gider.
İkincil CTA: **GitHub'da incele** — projenin deposuna gider.

Görsel: ekranın sağında ağırlık kazanan noktalı yüz formu; ince ses dalgası ve yazım ritmi çizgileriyle aynı sahne içinde birleşir. Başlık tarafı sakin ve yüksek kontrastlı kalır. Navbar ilk ekranın yüksekliğine dahil edilir.

### 2. Modüller — Kimliğin farklı katmanları

Masaüstünde solda sıralı anlatım, sağda kaydırmayla değişen sabit bir görsel. Mobilde her anlatım kendi görseliyle normal akışta yer alır.

| Adım | Ürün anlatımı | Görsel ve hareket |
| --- | --- | --- |
| 01 · Yazım ritmi | Tuş basılı tutma ve geçiş sürelerinden biyometrik profil oluşturur. | Örnek tuşlar sırayla aydınlanır; aralık çizgileri ritmi gösterir. |
| 02 · Yüz | Referans yüz ile yeni örneği karşılaştırır; canlılık sinyallerini değerlendirebilir. | Noktalı yüz üzerinde kısa bir tarama geçişi. |
| 03 · Ses | Konuşmacı benzerliğini ve challenge metnini değerlendirir. | Örnek dalga biçimi ile metin eşleşmesinin görünmesi. |
| 04 · Kart | Kart yakalama, hizalama, OCR ve görsel benzerlik karşılaştırması sunar. | Kurmaca örnek kart hizalanır; metin alanları işaretlenir. |
| 05 · Ağ ve konum | IP, VPN/proxy/Tor/relay ve ülke sinyallerini politika üzerinden değerlendirir. | Soyut ağ noktaları ve ülke sınırı işaretleri. |

Bu sahneler ürün açıklamasıdır; kamera/mikrofon izni istemez ve ziyaretçinin biyometrik verisini toplamaz.

### 3. Birleşik karar — Birden fazla sinyal. Tek karar.

Sinyaller yatay bir akışta politika katmanına ulaşır. Sonuçlar: **İzin ver**, **Ek doğrulama iste**, **Reddet**.

Üç örnek senaryo seçilebilir: “Uyumlu sinyaller”, “Ek kontrol gereken oturum”, “Riskli oturum”. Seçim, akışın ve karar etiketinin değişmesini sağlar. Gösterim açıkça **örnek senaryo** olarak etiketlenir; gerçek model değerlendirmesi veya ölçülmüş güven skoru gibi sunulmaz.

### 4. Geliştiriciler için — Akışınıza ekleyin.

Kısa anlatım: “Tarayıcı SDK'sı ile sinyalleri toplayın. API üzerinden doğrulayın. Oturum politikasında birleştirin.”

Basit mimari şeridi: **Tarayıcı SDK'sı → ASP.NET Core API → Python doğrulama modülleri**.

React demo arayüzü ve TypeScript SDK belirtilir. Express API varsayılan backend gibi gösterilmez; mevcut README'de geri dönüş seçeneği olarak yer alır. Kod örneği kullanılacaksa gerçek SDK metotlarından doğrulanarak alınır. İlk aşamada uzun kurulum komutları eklenmez.

### 5. Son çağrı — SecureKit'i keşfedin.

GitHub'a çalışan bir bağlantı ve sayfa içi modül bağlantıları. Mevcut Playground'a bağlantı ancak erişilebilir adres doğrulandıysa sunulur. Proje “biyometrik ve bağlamsal doğrulama prototipi” olarak doğru konumlandırılır.

Footer: SecureKit, kaynak depo, DeepWiki bağlantısı. Documentation henüz yapılmadığından boş bir `/docs` bağlantısı eklenmez.

## Motion üretim sırası

1. **Hero giriş sahnesi:** marka ve metin kısa aralıklarla görünür, sinyal çizgileri yüz formuna bağlanır. Metin animasyonun tamamlanmasını beklemeden okunabilir.
2. **Modül anlatımı:** kaydırma sırasında aktif modül görseli yumuşakça değişir. Masaüstünde sticky sahne; mobilde daha kısa bölüm geçişleri.
3. **Karar etkileşimi:** senaryo seçimiyle akış vurgusu ve sonuç etiketi değişir. CTA hover/focus tepkileri aynı hareket dilini kullanır.

`prefers-reduced-motion` durumunda içerik statik ve eksiksiz kalır. Sürekli hareketlerde duraklatma davranışı sağlanır. Scroll ele geçirilmez; etkileşimler klavye ile kullanılabilir.

## Görsel üretimi

Önce hero için tek bir güçlü konsept hazırlanır. İki uygun yöntem:

- **SVG/Canvas:** noktalı yüz, ses dalgası ve ritim çizgilerinin kodla oluşturulması. Etkileşimli modül anlatımı için tercih edilen yöntem.
- **ImageGen:** ışığı kontrollü, grafit fonda biyometrik portre/insan formu. Yazı, logo, dashboard veya arayüz görsele gömülmez; animasyon katmanları ayrı eklenir.

Kart görseli kurmaca verilerle hazırlanır. Gerçek ürün ekran görüntüleri ancak mevcut demo'dan alınmışsa kullanılacak; üretilmiş arayüz gerçek ürün ekranı gibi sunulmayacak.

## Uygulama ve teslim sırası

1. Hero kompozisyonu ve ilk motion sahnesi hazırlanır; ilk görsel değerlendirme bunun üzerinden yapılır.
2. Modüller sıralı biçimde eklenir; her modül kendi açıklaması ve sahnesiyle tamamlanır.
3. Örnek birleşik karar etkileşimi, geliştirici bölümü ve CTA eklenir.
4. Mobil düzen, azaltılmış hareket, klavye kullanımı, kontrast, bağlantılar ve üretim derlemesi kontrol edilir.

Mevcut repo React + Vite kullanıyor. Uygulama için `apps/landing-web` altında ayrı bir React + TypeScript + Vite uygulaması önerilir; böylece tanıtım sitesi bağımsız çalışır ve mevcut Playground adresi korunur. Motion için mevcut bağımlılıklar kontrol edilip uygun kütüphane seçilir. Landing page'in açılması biyometrik Python modellerine veya çalışan API'ye bağlı olmayacak.

İlk aşama tamamlanma ölçütü: çalışan tek landing page, modül anlatımları, üç anlamlı motion, mobil uyum, erişilebilir etkileşimler ve doğrulanmış CTA hedefleri. Documentation ve yayınlama ayrı sonraki işlerdir.

## İkinci aşama — Documentation

Landing page'in tipografi ve navigasyon dili korunarak `/docs` hazırlanır. Planlanan içerik: hızlı başlangıç, mimari, tarayıcı SDK'sı, kayıt/rıza/profil akışı, modül kılavuzları, oturum politikası, API referansı ve sorun giderme. Uygulama örnekleri gerçek sözleşmelerle karşılaştırılır.

## Kaynaklar ve içerik sınırları

- Kullanıcının verdiği kaynak: https://deepwiki.com/MuratOzte/Multi-modal-biometric-authentication-toolkit
- DeepWiki 7 Ekim 2026 tarihinde bu oturumda açılamadı; içeriği okunmuş gibi varsayılmadı. Erişim sağlandığında terminoloji ve özellikler tekrar karşılaştırılmalı.
- Doğrulanan yerel kaynaklar: `README.md`, `packages/core/src/contracts/session.ts`, `packages/core/src/contracts/keystroke.ts`, `packages/core/src/contracts/voice.ts`, `apps/demo-web/package.json`.
- Ölçülmemiş doğruluk oranları, gecikme değerleri, müşteri logoları, sertifikasyon veya üretime hazır güvenlik iddiaları kullanılmayacak.
- README bazı modüllerde `step_up`, oturum sözleşmesi ise `step-up` kullanıyor. Landing page'de kullanıcıya anlaşılır “Ek doğrulama iste” etiketi tercih edilir; documentation'da her endpoint'in gerçek sözleşmesi esas alınır.
