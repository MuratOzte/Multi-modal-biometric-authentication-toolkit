import { useEffect, useRef, useState } from "react";
import { Face, Icon, Mark, SignalVisual } from "./Visuals";

const repository =
  "https://github.com/MuratOzte/Multi-modal-biometric-authentication-toolkit";
const modules = [
  {
    title: "Yazım ritminiz.",
    sub: "Her tuşta size ait bir iz.",
    tag: "DAVRANIŞSAL BİYOMETRİ",
    text: "Tuşlara basma ve tuşlar arasındaki geçiş süreleriyle kişiye özgü bir biyometrik profil oluşturun.",
    detail: "Sabit ve dinamik metin doğrulaması",
    tech: "TypeScript · Keystroke dynamics",
  },
  {
    title: "Yüzünüz.",
    sub: "Bir görüntüden daha fazlası.",
    tag: "GÖRSEL BİYOMETRİ",
    text: "Referans yüz ile yeni örneği karşılaştırın. Canlılık sinyallerini doğrulama akışına dahil edin.",
    detail: "Yüz benzerliği ve canlılık sinyalleri",
    tech: "MTCNN · FaceNet",
  },
  {
    title: "Sesiniz.",
    sub: "Kimliğinizin duyulan hali.",
    tag: "SES BİYOMETRİSİ",
    text: "Konuşmacı benzerliğini ve söylenen challenge metnini birlikte değerlendirin.",
    detail: "Konuşmacı ve metin doğrulaması",
    tech: "SpeechBrain · Whisper",
  },
  {
    title: "Kartınız.",
    sub: "Görüntüyü bilgiye dönüştürün.",
    tag: "BELGE DOĞRULAMA",
    text: "Kartı yakalayın ve hizalayın. Metin alanlarını çıkarın, referansla görsel benzerliğini karşılaştırın.",
    detail: "Kart yakalama, OCR ve benzerlik",
    tech: "PaddleOCR · OpenCLIP",
  },
  {
    title: "Bağlamınız.",
    sub: "Oturumun arkasındaki sinyaller.",
    tag: "AĞ & KONUM",
    text: "IP, VPN, proxy, Tor ve ülke sinyallerini oturum politikanız üzerinden değerlendirin.",
    detail: "Biyometrinin yanında bağlamsal kontrol",
    tech: "IP analizi · Konum politikası",
  },
];
const scenarios = [
  {
    label: "Uyumlu sinyaller",
    result: "İzin ver",
    code: "allow",
    description:
      "Biyometrik ve bağlamsal sinyaller örnek politikayla uyumlu. Oturum devam eder.",
    signals: ["Uyumlu", "Uyumlu", "Uyumlu", "Uyumlu", "Uyumlu"],
  },
  {
    label: "Ek kontrol",
    result: "Ek doğrulama iste",
    code: "step-up",
    description:
      "Ses sinyali ek kontrol gerektiriyor. Politika, oturum için yeni bir doğrulama adımı ister.",
    signals: ["Uyumlu", "Uyumlu", "Ek kontrol", "Uyumlu", "Uyumlu"],
  },
  {
    label: "Riskli oturum",
    result: "Reddet",
    code: "deny",
    description:
      "Yüz eşleşmesi ve ağ bağlamı örnek politikayı karşılamıyor. Oturuma izin verilmez.",
    signals: ["Uyumlu", "Eşleşmedi", "Uyumlu", "Uyumlu", "Riskli"],
  },
];

function App() {
  const [active, setActive] = useState(0);
  const [scenario, setScenario] = useState(0);
  const [paused, setPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const moduleRows = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      if (id && !id.startsWith("/")) document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting)
            setActive(Number((entry.target as HTMLElement).dataset.module));
        });
      },
      { rootMargin: "-25% 0px -45% 0px", threshold: 0 },
    );
    moduleRows.current.forEach((row) => {
      if (row) observer.observe(row);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    document
      .querySelectorAll(".reveal")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={paused ? "site motion-paused" : "site"}>
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      <div className="announcement">
        <span className="spark">✳</span> Çok sinyalli kimlik doğrulama. Tek
        araç seti.
        <a href={repository} target="_blank" rel="noreferrer">
          Projeyi keşfet <span>↗</span>
        </a>
      </div>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" href="#" aria-label="SecureKit ana sayfa">
            <Mark />
            <span>
              SecureKit<span className="brand-dot">.</span>
            </span>
          </a>
          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "Kapat ×" : "Menü ☰"}
          </button>
          <nav
            id="main-navigation"
            className={menuOpen ? "nav open" : "nav"}
            aria-label="Ana gezinme"
            onClick={() => setMenuOpen(false)}
          >
            <a href="#modules">Yetenekler</a>
            <a href="#flow">Nasıl çalışır?</a>
            <a href="#developers">Geliştiriciler</a>
            <a href="#/wiki/1-overview">Kaynak Wiki</a>
            <a
              className="nav-cta"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub’da incele <span>↗</span>
            </a>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <div className="eyebrow hero-enter">
                <span className="status-dot" /> ÇOK SİNYALLİ KİMLİK DOĞRULAMA
              </div>
              <h1 className="hero-enter">
                SecureKit<span className="brand-dot">.</span>
                <span className="hero-heading">
                  Kimliğin farklı
                  <br />
                  katmanları.
                </span>
              </h1>
              <p className="hero-enter">
                Yüzünüz, sesiniz, yazım ritminiz.
                <br />
                Size ait sinyaller, ortak bir doğrulama akışında.
              </p>
              <div className="button-row hero-enter">
                <a className="button primary" href="#flow">
                  Nasıl çalışır? <span>↗</span>
                </a>
                <a className="button secondary" href="#modules">
                  Yetenekleri keşfet <span>↓</span>
                </a>
              </div>
              <div className="hero-footnote hero-enter">
                <span className="tiny-cross">+</span> Biyometrik ve bağlamsal
                doğrulama prototipi
              </div>
            </div>
            <div className="hero-visual hero-enter">
              <div className="visual-topline">
                <span>SECUREKIT / IDENTITY ENGINE</span>
                <span>01 — 05</span>
              </div>
              <Face hero />
              <div className="hero-visual-bottom">
                <span>
                  <span className="status-dot" /> BİR KİMLİK. BİRDEN FAZLA
                  SİNYAL.
                </span>
                <button
                  className="motion-control"
                  onClick={() => setPaused(!paused)}
                  aria-pressed={paused}
                  aria-label={
                    paused ? "Hareketleri sürdür" : "Hareketleri duraklat"
                  }
                >
                  {paused ? "▷" : "Ⅱ"}
                </button>
              </div>
            </div>
          </div>
        </section>
        <div className="signal-strip">
          <div className="container">
            <span className="strip-label">KİMLİĞİNİZİ OLUŞTURAN SİNYALLER</span>
            {["Yazım ritmi", "Yüz", "Ses", "Kart", "Ağ & konum"].map(
              (label, i) => (
                <a href={`#module-${i}`} key={label}>
                  <Icon kind={i} />
                  {label}
                  <span>↗</span>
                </a>
              ),
            )}
          </div>
        </div>
        <section className="modules-section section container" id="modules">
          <div className="section-heading reveal">
            <div>
              <p className="eyebrow">01 / YETENEKLER</p>
              <h2>
                Kimlik, tek bir
                <br />
                sinyalden ibaret değil.
              </h2>
            </div>
            <p>
              Her modül farklı bir katmanı değerlendirir.
              <br />
              Birlikte daha kapsamlı bir doğrulama akışı oluştururlar.
            </p>
          </div>
          <div className="module-layout">
            <div className="module-stories">
              {modules.map((module, i) => (
                <article
                  id={`module-${i}`}
                  data-module={i}
                  key={module.title}
                  ref={(el) => {
                    moduleRows.current[i] = el;
                  }}
                  className={`module-story ${active === i ? "active" : ""}`}
                >
                  <div className="module-number">
                    0{i + 1}
                    <span />
                    <Icon kind={i} />
                  </div>
                  <p className="eyebrow">{module.tag}</p>
                  <h3>
                    {module.title}
                    <span>{module.sub}</span>
                  </h3>
                  <p>{module.text}</p>
                  <div className="module-detail">
                    <span>↳</span>
                    {module.detail}
                  </div>
                  <div className="mobile-module-visual">
                    <SignalVisual active={i} />
                  </div>
                </article>
              ))}
            </div>
            <div className="module-sticky">
              <div className="module-stage">
                <div className="stage-header">
                  <span>SİNYAL GÖRÜNÜMÜ</span>
                  <span>0{active + 1} / 05</span>
                </div>
                <div className="stage-visual" key={active}>
                  <SignalVisual active={active} />
                </div>
                <div className="stage-footer">
                  <span className="status-dot" />
                  <span>{modules[active].tech}</span>
                  <span className="stage-example">ÖRNEK GÖRSEL</span>
                </div>
              </div>
              <div className="module-tabs" aria-label="Modül görseli">
                {modules.map((module, i) => (
                  <button
                    key={i}
                    aria-label={`${module.title} bölümüne git`}
                    aria-pressed={active === i}
                    onClick={() => {
                      setActive(i);
                      moduleRows.current[i]?.scrollIntoView({
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "instant"
                          : "smooth",
                        block: "center",
                      });
                    }}
                  >
                    <span>0{i + 1}</span>
                    <Icon kind={i} />
                  </button>
                ))}
              </div>
              <p className="stage-note">
                Temsili görseller. Kamera veya mikrofon erişimi gerektirmez.
              </p>
            </div>
          </div>
        </section>
        <section className="flow-section section" id="flow">
          <div className="container">
            <div className="section-heading reveal">
              <div>
                <p className="eyebrow">02 / BİRLEŞİK KARAR</p>
                <h2>
                  Birden fazla sinyal.
                  <br />
                  Tek karar.
                </h2>
              </div>
              <p>
                Sinyallerinizi oturum politikanızda birleştirin.
                <br />
                İzin verin, ek kontrol isteyin veya oturumu reddedin.
              </p>
            </div>
            <div className="scenario-top">
              <span className="example-label">ETKİLEŞİMLİ ÖRNEK</span>
              <div
                className="scenario-buttons"
                aria-label="Örnek senaryo seçimi"
              >
                {scenarios.map((item, i) => (
                  <button
                    key={item.code}
                    onClick={() => setScenario(i)}
                    aria-pressed={scenario === i}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`decision-diagram scenario-${scenario}`}>
              <div className="input-signals">
                {["Yazım ritmi", "Yüz", "Ses", "Kart", "Ağ & konum"].map(
                  (label, i) => (
                    <div
                      className={`input-signal ${scenarios[scenario].signals[i] === "Uyumlu" ? "" : "flagged"}`}
                      key={label}
                    >
                      <Icon kind={i} />
                      <span>{label}</span>
                      <small>{scenarios[scenario].signals[i]}</small>
                      <span className="signal-node" />
                    </div>
                  ),
                )}
              </div>
              <div className="connector" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="policy-engine">
                <Mark />
                <strong>Politika katmanı</strong>
                <span>Sinyaller + kurallar + eşikler</span>
              </div>
              <div className="output-connector" aria-hidden="true">
                →
              </div>
              <div
                className="decision-result"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="eyebrow">OTURUM KARARI</span>
                <strong key={scenario}>{scenarios[scenario].result}</strong>
                <code>{scenarios[scenario].code}</code>
              </div>
            </div>
            <div className="scenario-description" aria-live="polite">
              <span>0{scenario + 1}</span>
              <p>{scenarios[scenario].description}</p>
            </div>
            <p className="disclaimer">
              Bu gösterim örnek senaryolar kullanır; gerçek bir biyometrik
              değerlendirme veya güven skoru üretmez.
            </p>
          </div>
        </section>
        <section
          className="developers-section section container"
          id="developers"
        >
          <div className="developer-copy reveal">
            <p className="eyebrow">03 / GELİŞTİRİCİLER İÇİN</p>
            <h2>
              Akışınıza ekleyin.
              <br />
              Kontrol sizde kalsın.
            </h2>
            <p>
              Tarayıcı SDK’sıyla sinyalleri toplayın. API üzerinden doğrulayın.
              Kararı kendi oturum politikanızla şekillendirin.
            </p>
            <a
              className="button secondary"
              href={`${repository}#hızlı-başlangıç`}
              target="_blank"
              rel="noreferrer"
            >
              Kaynak kodu incele <span>↗</span>
            </a>
            <div className="tech-stack">
              <span>TypeScript</span>
              <span>React</span>
              <span>.NET 10</span>
              <span>Python</span>
            </div>
          </div>
          <div className="architecture reveal">
            <div className="architecture-header">
              <span>SECUREKIT / MİMARİ</span>
              <span>↗</span>
            </div>
            <div className="architecture-row">
              <span className="architecture-symbol">⌘</span>
              <div>
                <small>01 / TOPLA</small>
                <h3>Tarayıcı SDK’sı</h3>
                <p>Olaylar ve biyometrik örnekler</p>
              </div>
              <code>TypeScript</code>
            </div>
            <div className="architecture-arrow">↓</div>
            <div className="architecture-row">
              <span className="architecture-symbol">↔</span>
              <div>
                <small>02 / YÖNET</small>
                <h3>ASP.NET Core API</h3>
                <p>Oturum, rıza ve doğrulama akışı</p>
              </div>
              <code>C#</code>
            </div>
            <div className="architecture-arrow">↓</div>
            <div className="architecture-row">
              <span className="architecture-symbol">⌁</span>
              <div>
                <small>03 / DEĞERLENDİR</small>
                <h3>Doğrulama modülleri</h3>
                <p>Yüz, ses, kart ve biyometrik analiz</p>
              </div>
              <code>Python</code>
            </div>
            <div className="architecture-footer">
              Bağımsız modüller. Ortak sözleşmeler.
            </div>
          </div>
        </section>
        <section className="resources-section section container" id="resources">
          <div className="resources-intro reveal">
            <p className="eyebrow">04 / KAYNAK WIKI</p>
            <h2>Projenin içine<br />biraz daha yakından bakın.</h2>
            <p>Mimariden API sözleşmelerine, biyometrik işçilerden kabul testlerine. SecureKit’in teknik kaynakları tek bir yerde.</p>
            <a className="button primary" href="#/wiki/1-overview">Wiki’yi keşfet <span>↗</span></a>
            <span className="resources-note">27 sayfa · 7 konu grubu · Kaynak kod referansları</span>
          </div>
          <div className="resource-topics reveal">
            {[
              ["01", "Mimari & başlangıç", "Monorepo, kurulum ve kimlik doğrulama karar modeli", "1-overview"],
              ["02", "API & entegrasyon", "ASP.NET Core, SDK, sözleşmeler ve geçiş süreci", "2-securekit-asp.net-core-api"],
              ["03", "Biyometrik işçiler", "Yüz, ses, kart doğrulama ve Python ortamları", "5-python-biometric-workers"],
              ["04", "Test & kabul", "Preflight, parity kontrolleri ve kabul araçları", "6-testing-and-acceptance-tooling"],
            ].map(([number, title, description, slug]) => <a key={number} href={`#/wiki/${slug}`}><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><span>↗</span></a>)}
            <div className="resources-source">DeepWiki içeriği ve iç sayfaları · 7 Ekim 2026 arşivi</div>
          </div>
        </section>
        <section className="principles container reveal">
          <div>
            <span className="principle-line" />
            <h3>Çok katmanlı.</h3>
            <p>Davranışsal, biyometrik ve bağlamsal sinyaller aynı akışta.</p>
          </div>
          <div>
            <span className="principle-line" />
            <h3>Modüler.</h3>
            <p>
              İhtiyacınız olan doğrulama adımlarını kendi akışınızda
              birleştirin.
            </p>
          </div>
          <div>
            <span className="principle-line" />
            <h3>İncelenebilir.</h3>
            <p>Kaynak kodu, ortak sözleşmeler ve demo uygulaması tek depoda.</p>
          </div>
        </section>
        <section className="final-cta">
          <div className="container reveal">
            <div>
              <p className="eyebrow">KİMLİK DOĞRULAMAYA YENİ BİR KATMAN</p>
              <h2>
                SecureKit’i keşfedin<span className="brand-dot">.</span>
              </h2>
              <p>Sinyalleri tanıyın. Akışı inceleyin. Projenize uyarlayın.</p>
            </div>
            <a
              className="button primary"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub’da incele <span>↗</span>
            </a>
          </div>
        </section>
      </main>
      <footer className="footer container">
        <a className="brand" href="#">
          <Mark small />
          <span>SecureKit.</span>
        </a>
        <span>Biyometrik kimlik doğrulama araç seti.</span>
        <div>
          <a href="#/wiki/1-overview">Kaynak Wiki</a>
          <a href={repository} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a
            href="https://deepwiki.com/MuratOzte/Multi-modal-biometric-authentication-toolkit"
            target="_blank"
            rel="noreferrer"
          >
            DeepWiki ↗
          </a>
          <a href="#main">Başa dön ↑</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
