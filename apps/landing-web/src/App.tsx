import { useEffect, useState } from "react";
import LanguageSwitcher from "./LanguageSwitcher";
import { translator, type Locale } from "./locale";
import { IdentityTrace, Icon, Mark, SignalVisual } from "./Visuals";

const repository =
  "https://github.com/MuratOzte/Multi-modal-biometric-authentication-toolkit";
const modules = [
  {
    title: "Yazım ritminiz.",
    tag: "DAVRANIŞSAL BİYOMETRİ",
    text: "Tuşlara basma ve tuşlar arasındaki geçiş süreleriyle kişiye özgü bir biyometrik profil oluşturun.",
    href: "#/wiki/2.2.2-keystroke-session-and-risk-services",
  },
  {
    title: "Yüzünüz.",
    tag: "GÖRSEL BİYOMETRİ",
    text: "Referans yüz ile yeni örneği karşılaştırın. Canlılık sinyallerini doğrulama akışına dahil edin.",
    href: "#/wiki/5.1-face-and-voice-workers",
  },
  {
    title: "Sesiniz.",
    tag: "SES BİYOMETRİSİ",
    text: "Konuşmacı benzerliğini ve söylenen challenge metnini birlikte değerlendirin.",
    href: "#/wiki/5.1-face-and-voice-workers",
  },
  {
    title: "Kartınız.",
    tag: "BELGE DOĞRULAMA",
    text: "Kartı yakalayın ve hizalayın. Metin alanlarını çıkarın, referansla görsel benzerliğini karşılaştırın.",
    href: "#/wiki/5.2-card-verification-worker",
  },
  {
    title: "Bağlamınız.",
    tag: "AĞ & KONUM",
    text: "IP, VPN, proxy, Tor ve ülke sinyallerini oturum politikanız üzerinden değerlendirin.",
    href: "#/wiki/5.3-ip-check-and-environment-setup",
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

function App({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [scenario, setScenario] = useState(0);
  const [paused, setPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      if (id && !id.startsWith("/"))
        document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
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
        {t("İçeriğe geç")}
      </a>
      <div className="announcement">
        <span className="spark">✳</span>
        {t("Çok sinyalli kimlik doğrulama. Tek araç seti.")}
        <a href={repository} target="_blank" rel="noreferrer">
          {t("Projeyi keşfet")}
          <span>↗</span>
        </a>
      </div>
      <header className="header">
        <div className="container header-inner">
          <a className="brand" href="#" aria-label={t("SecureKit ana sayfa")}>
            <Mark />
            <span>
              SecureKit<span className="brand-dot">.</span>
            </span>
          </a>
          <LanguageSwitcher locale={locale} />
          <button
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? t("Kapat ×") : t("Menü ☰")}
          </button>
          <nav
            id="main-navigation"
            className={menuOpen ? "nav open" : "nav"}
            aria-label={t("Ana gezinme")}
            onClick={() => setMenuOpen(false)}
          >
            <a href="#modules">{t("Yetenekler")}</a>
            <a href="#flow">{t("Nasıl çalışır?")}</a>
            <a href="#developers">{t("Geliştiriciler")}</a>
            <a className="nav-wiki" href="#/wiki/1-overview">
              {t("Kaynak Wiki")}
              <span aria-hidden="true">↗</span>
            </a>
            <a
              className="nav-cta"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              {t("GitHub’da incele")}
              <span>↗</span>
            </a>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <div className="eyebrow hero-enter">
                <span className="status-dot" />
                {t("ÇOK SİNYALLİ KİMLİK DOĞRULAMA")}
              </div>
              <h1 className="hero-enter">
                SecureKit<span className="brand-dot">.</span>
                <span className="hero-heading">
                  {t("Kimliğin farklı")}
                  <br />
                  {t("katmanları.")}
                </span>
              </h1>
              <p className="hero-enter">
                {t("Yüzünüz, sesiniz, yazım ritminiz.")}
                <br />
                {t("Size ait sinyaller, ortak bir doğrulama akışında.")}
              </p>
              <div className="button-row hero-enter">
                <a className="button primary wiki-cta" href="#/wiki/1-overview">
                  {t("Kaynak Wiki’yi aç")}
                  <span>↗</span>
                </a>
                <a className="button secondary" href="#flow">
                  {t("Nasıl çalışır?")}
                  <span>↓</span>
                </a>
              </div>
              <div className="hero-footnote hero-enter">
                <span className="tiny-cross">+</span>
                {t("Biyometrik ve bağlamsal doğrulama prototipi")}
              </div>
            </div>
            <div className="hero-visual hero-enter">
              <IdentityTrace
                label={t(
                  "Kimliğin kişiye özgü izini temsil eden sade parmak izi çizimi",
                )}
              />
              <div className="hero-visual-bottom">
                <span>{t("Size ait tek bir iz.")}</span>
                <button
                  className="motion-control"
                  onClick={() => setPaused(!paused)}
                  aria-pressed={paused}
                  aria-label={
                    paused ? t("Hareketleri sürdür") : t("Hareketleri duraklat")
                  }
                >
                  {paused ? "▷" : "Ⅱ"}
                </button>
              </div>
            </div>
          </div>
        </section>
        <section
          className="resources-section section"
          id="resources"
          aria-labelledby="resources-title"
        >
          <div className="container resources-inner">
            <div className="resources-intro reveal">
              <p className="eyebrow">{t("01 / TEKNİK KAYNAKLAR")}</p>
              <h2 id="resources-title">
                {t("Kaynak Wiki")}
                <span className="brand-dot">.</span>
              </h2>
              <p>
                {t(
                  "Mimariden API sözleşmelerine, biyometrik işçilerden kabul testlerine. SecureKit’in teknik kaynakları tek bir yerde.",
                )}
              </p>
              <a className="button primary" href="#/wiki/1-overview">
                {t("Kaynak Wiki’yi aç")}
                <span>↗</span>
              </a>
            </div>
            <div className="resource-topics reveal">
              {[
                [
                  "01",
                  t("Mimari & başlangıç"),
                  t("Monorepo, kurulum ve kimlik doğrulama karar modeli"),
                  "1-overview",
                ],
                [
                  "02",
                  t("API & entegrasyon"),
                  t("ASP.NET Core, SDK, sözleşmeler ve geçiş süreci"),
                  "2-securekit-asp.net-core-api",
                ],
                [
                  "03",
                  t("Biyometrik işçiler"),
                  t("Yüz, ses, kart doğrulama ve Python ortamları"),
                  "5-python-biometric-workers",
                ],
                [
                  "04",
                  t("Test & kabul"),
                  t("Preflight, parity kontrolleri ve kabul araçları"),
                  "6-testing-and-acceptance-tooling",
                ],
              ].map(([number, title, description, slug]) => (
                <a key={number} href={`#/wiki/${slug}`}>
                  <span>{number}</span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(description)}</p>
                  </div>
                  <span>↗</span>
                </a>
              ))}
              <div className="resources-source">
                {t("DeepWiki içeriği ve iç sayfaları · 7 Ekim 2026 arşivi")}
              </div>
            </div>
          </div>
        </section>
        <section className="modules-section section container" id="modules">
          <div className="section-heading reveal">
            <div>
              <p className="eyebrow">{t("02 / YETENEKLER")}</p>
              <h2>
                {t("Kimlik, tek bir")}
                <br />
                {t("sinyalden ibaret değil.")}
              </h2>
            </div>
            <p>
              {t("Her modül farklı bir katmanı değerlendirir.")}
              <br />
              {t("Birlikte daha kapsamlı bir doğrulama akışı oluştururlar.")}
            </p>
          </div>
          <div className="capability-list">
            {modules.map((module, i) => (
              <article
                id={`module-${i}`}
                key={t(module.title)}
                className="capability-block"
              >
                <div className="capability-copy">
                  <p className="capability-badge">
                    <span className="status-dot" />
                    {t(module.tag)}
                  </p>
                  <h3>{t(module.title)}</h3>
                  <p className="capability-description">{t(module.text)}</p>
                  <a className="capability-link" href={module.href}>
                    {t("Teknik detaylar")}
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
                <div className="capability-art">
                  <SignalVisual active={i} locale={locale} />
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="flow-section section" id="flow">
          <div className="container">
            <div className="section-heading reveal">
              <div>
                <p className="eyebrow">{t("03 / BİRLEŞİK KARAR")}</p>
                <h2>
                  {t("Birden fazla sinyal.")}
                  <br />
                  {t("Tek karar.")}
                </h2>
              </div>
              <p>
                {t("Sinyallerinizi oturum politikanızda birleştirin.")}
                <br />
                {t("İzin verin, ek kontrol isteyin veya oturumu reddedin.")}
              </p>
            </div>
            <div className="scenario-top">
              <span className="example-label">{t("ETKİLEŞİMLİ ÖRNEK")}</span>
              <div
                className="scenario-buttons"
                aria-label={t("Örnek senaryo seçimi")}
              >
                {scenarios.map((item, i) => (
                  <button
                    key={item.code}
                    onClick={() => setScenario(i)}
                    aria-pressed={scenario === i}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
            </div>
            <div className={`decision-diagram scenario-${scenario}`}>
              <div className="input-signals">
                {[
                  t("Yazım ritmi"),
                  t("Yüz"),
                  t("Ses"),
                  t("Kart"),
                  t("Ağ & konum"),
                ].map((label, i) => (
                  <div
                    className={`input-signal ${scenarios[scenario].signals[i] === "Uyumlu" ? "" : "flagged"}`}
                    key={t(label)}
                  >
                    <Icon kind={i} />
                    <span>{t(label)}</span>
                    <small>{t(scenarios[scenario].signals[i])}</small>
                    <span className="signal-node" />
                  </div>
                ))}
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
                <strong>{t("Politika katmanı")}</strong>
                <span>{t("Sinyaller + kurallar + eşikler")}</span>
              </div>
              <div className="output-connector" aria-hidden="true">
                →
              </div>
              <div
                className="decision-result"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="eyebrow">{t("OTURUM KARARI")}</span>
                <strong key={scenario}>{t(scenarios[scenario].result)}</strong>
                <code>{scenarios[scenario].code}</code>
              </div>
            </div>
            <div className="scenario-description" aria-live="polite">
              <span>0{scenario + 1}</span>
              <p>{t(scenarios[scenario].description)}</p>
            </div>
            <p className="disclaimer">
              {t(
                "Bu gösterim örnek senaryolar kullanır; gerçek bir biyometrik değerlendirme veya güven skoru üretmez.",
              )}
            </p>
          </div>
        </section>
        <section
          className="developers-section section container"
          id="developers"
        >
          <div className="developer-copy reveal">
            <p className="eyebrow">{t("04 / GELİŞTİRİCİLER İÇİN")}</p>
            <h2>
              {t("Akışınıza ekleyin.")}
              <br />
              {t("Kontrol sizde kalsın.")}
            </h2>
            <p>
              {t(
                "Tarayıcı SDK’sıyla sinyalleri toplayın. API üzerinden doğrulayın. Kararı kendi oturum politikanızla şekillendirin.",
              )}
            </p>
            <a
              className="button secondary"
              href={`${repository}#hızlı-başlangıç`}
              target="_blank"
              rel="noreferrer"
            >
              {t("Kaynak kodu incele")}
              <span>↗</span>
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
              <span>{t("SECUREKIT / MİMARİ")}</span>
              <span>↗</span>
            </div>
            <div className="architecture-row">
              <span className="architecture-symbol">⌘</span>
              <div>
                <small>{t("01 / TOPLA")}</small>
                <h3>{t("Tarayıcı SDK’sı")}</h3>
                <p>{t("Olaylar ve biyometrik örnekler")}</p>
              </div>
              <code>TypeScript</code>
            </div>
            <div className="architecture-arrow">↓</div>
            <div className="architecture-row">
              <span className="architecture-symbol">↔</span>
              <div>
                <small>{t("02 / YÖNET")}</small>
                <h3>ASP.NET Core API</h3>
                <p>{t("Oturum, rıza ve doğrulama akışı")}</p>
              </div>
              <code>C#</code>
            </div>
            <div className="architecture-arrow">↓</div>
            <div className="architecture-row">
              <span className="architecture-symbol">⌁</span>
              <div>
                <small>{t("03 / DEĞERLENDİR")}</small>
                <h3>{t("Doğrulama modülleri")}</h3>
                <p>{t("Yüz, ses, kart ve biyometrik analiz")}</p>
              </div>
              <code>Python</code>
            </div>
            <div className="architecture-footer">
              {t("Bağımsız modüller. Ortak sözleşmeler.")}
            </div>
          </div>
        </section>
        <section className="principles container reveal">
          <div>
            <span className="principle-line" />
            <h3>{t("Çok katmanlı.")}</h3>
            <p>
              {t("Davranışsal, biyometrik ve bağlamsal sinyaller aynı akışta.")}
            </p>
          </div>
          <div>
            <span className="principle-line" />
            <h3>{t("Modüler.")}</h3>
            <p>
              {t(
                "İhtiyacınız olan doğrulama adımlarını kendi akışınızda birleştirin.",
              )}
            </p>
          </div>
          <div>
            <span className="principle-line" />
            <h3>{t("İncelenebilir.")}</h3>
            <p>
              {t(
                "Kaynak kodu, ortak sözleşmeler ve demo uygulaması tek depoda.",
              )}
            </p>
          </div>
        </section>
        <section className="final-cta">
          <div className="container reveal">
            <div>
              <p className="eyebrow">
                {t("KİMLİK DOĞRULAMAYA YENİ BİR KATMAN")}
              </p>
              <h2>
                {t("SecureKit’i keşfedin")}
                <span className="brand-dot">.</span>
              </h2>
              <p>
                {t("Sinyalleri tanıyın. Akışı inceleyin. Projenize uyarlayın.")}
              </p>
            </div>
            <a
              className="button primary"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              {t("GitHub’da incele")}
              <span>↗</span>
            </a>
          </div>
        </section>
      </main>
      <footer className="footer container">
        <a className="brand" href="#">
          <Mark small />
          <span>SecureKit.</span>
        </a>
        <span>{t("Biyometrik kimlik doğrulama araç seti.")}</span>
        <div>
          <a href="#/wiki/1-overview">{t("Kaynak Wiki")}</a>
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
          <a href="#main">{t("Başa dön ↑")}</a>
        </div>
      </footer>
    </div>
  );
}

export default App;
