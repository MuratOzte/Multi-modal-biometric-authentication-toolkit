import { useId, type CSSProperties } from "react";

export function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 24 : 32}
      height={small ? 24 : 32}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 4 34 10v12c0 8-14 15-14 15S6 30 6 22V10Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m13 20 5 5 10-12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function Icon({ kind }: { kind: number }) {
  const paths = [
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6 10h1m3 0h1m3 0h1m3 0h1M6 14h1m3 0h8" />
    </>,
    <>
      <path d="M7 3H4v4m13-4h3v4M4 17v3h3m13-3v3h-3" />
      <path d="M8 9v2m8-2v2m-5 0v3h2m-4 2c2 2 4 2 6 0" />
    </>,
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M6 10v2a6 6 0 0 0 12 0v-2m-6 8v3m-3 0h6" />
    </>,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <path d="M5 16c1-2 5-2 6 0m3-6h4m-4 4h4" />
    </>,
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18M5 6h14M5 18h14" />
    </>,
  ];
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

// A deterministic point cloud: raised nose, recessed eyes, lips and cheekbones.
const facePoints: { x: number; y: number; r: number; opacity: number }[] = [];
for (let row = 0; row <= 73; row++) {
  const v = row / 73;
  const y = -1 + v * 2;
  const width =
    Math.sqrt(Math.max(0, 1 - y * y)) * (y > 0.35 ? 1 - (y - 0.35) * 0.3 : 1);
  for (let col = 0; col <= 46; col++) {
    const u = -1 + col / 23;
    const x = u * width;
    const surface =
      Math.sqrt(Math.max(0, 1 - u * u)) * Math.sqrt(Math.max(0, 1 - y * y));
    const nose = 0.5 * Math.exp((-x * x) / 0.014 - (y - 0.03) ** 2 / 0.11);
    const eye =
      0.18 *
      Math.exp(-((Math.abs(x) - 0.32) ** 2) / 0.013 - (y + 0.19) ** 2 / 0.007);
    const lips = 0.13 * Math.exp((-x * x) / 0.09 - (y - 0.42) ** 2 / 0.004);
    const z = surface + nose - eye + lips;
    facePoints.push({
      x: 280 + x * 122 + z * 38,
      y: 233 + y * 165 - z * 7,
      r: 0.7 + z * 0.48,
      opacity: 0.18 + z * 0.49,
    });
  }
}

export function Face({ hero = false }: { hero?: boolean }) {
  const scanId = useId();
  return (
    <svg
      className={`face-art ${hero ? "hero-face" : ""}`}
      viewBox="0 0 600 480"
      role="img"
      aria-label="Yüz biyometrisini temsil eden üç boyutlu nokta bulutu"
    >
      <defs>
        <linearGradient id={scanId} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#6b2bea" stopOpacity="0" />
          <stop offset=".5" stopColor="#6b2bea" stopOpacity=".7" />
          <stop offset="1" stopColor="#6b2bea" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="face-orbits" fill="none" stroke="#d8d7e2" strokeWidth=".8">
        <ellipse cx="310" cy="235" rx="210" ry="210" />
        <ellipse cx="310" cy="235" rx="164" ry="164" />
        <path d="M65 235h475M310 17v436" strokeDasharray="3 7" />
        <ellipse
          cx="310"
          cy="235"
          rx="223"
          ry="72"
          transform="rotate(-28 310 235)"
        />
      </g>
      <g fill="#6b2bea">
        {facePoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} opacity={p.opacity} />
        ))}
      </g>
      <g fill="none" stroke="#0a0f1f" opacity=".65">
        <path d="M187 115h-14v25m262-25h14v25M173 334v25h14m262-25v25h-14" />
      </g>
      <g className="scan-line">
        <path d="M145 238h326" stroke={`url(#${scanId})`} strokeWidth="2" />
        <circle cx="319" cy="238" r="4" fill="#6b2bea" />
      </g>
      <g
        className="face-landmarks"
        fill="#fff"
        stroke="#6b2bea"
        strokeWidth="1.3"
      >
        <circle cx="268" cy="195" r="4" />
        <circle cx="347" cy="195" r="4" />
        <circle cx="341" cy="235" r="4" />
        <circle cx="319" cy="300" r="4" />
      </g>
      {hero && (
        <>
          <path
            d="m271 194-93-29H76m264 70 104 42h90m-215 24-114 67h-91"
            fill="none"
            stroke="#d8d7e2"
          />
          <g fill="#777783" fontSize="10" fontFamily="monospace">
            <text x="76" y="151">
              FACE / LANDMARKS
            </text>
            <text x="456" y="264">
              IDENTITY VECTOR
            </text>
            <text x="114" y="385">
              MULTI-MODAL INPUT
            </text>
          </g>
          <circle cx="95" cy="235" r="3" fill="#0a0f1f" />
          <circle cx="461" cy="91" r="3" fill="#6b2bea" />
        </>
      )}
    </svg>
  );
}

export function SignalVisual({ active }: { active: number }) {
  if (active === 1) return <Face />;
  if (active === 0)
    return (
      <div className="keyboard-visual">
        <div className="rhythm-lines">
          {Array.from({ length: 36 }, (_, i) => (
            <span
              key={i}
              style={
                {
                  height: `${18 + Math.sin(i * 2.3) ** 2 * 88}px`,
                  "--delay": `${i * 45}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="keys">
          {"SECURE".split("").map((key, i) => (
            <span
              key={i}
              style={{ "--delay": `${i * 180}ms` } as CSSProperties}
            >
              {key}
            </span>
          ))}
        </div>
        <div className="visual-caption">
          <span>keydown</span>
          <span>hold time</span>
          <span>keyup</span>
        </div>
      </div>
    );
  if (active === 2)
    return (
      <div className="voice-visual">
        <div className="waveform">
          {Array.from({ length: 57 }, (_, i) => (
            <span
              key={i}
              style={
                {
                  height: `${6 + Math.sin(i * 0.63) ** 2 * Math.sin((i / 57) * Math.PI) * 120}px`,
                  "--delay": `${i * 32}ms`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <span className="wave-line" />
        <p>“Kimliğimi sesimle doğruluyorum.”</p>
        <span className="visual-caption">
          KONUŞMACI BENZERLİĞİ + METİN KONTROLÜ
        </span>
      </div>
    );
  if (active === 3)
    return (
      <div className="card-visual">
        <div className="sample-card">
          <div className="card-top">
            <Mark small />
            <span>ÖRNEK KART</span>
          </div>
          <div className="card-content">
            <div className="portrait-placeholder">
              <svg viewBox="0 0 80 100" aria-hidden="true">
                <circle cx="40" cy="32" r="17" />
                <path d="M10 100V82c0-35 60-35 60 0v18" />
              </svg>
            </div>
            <div>
              <small>KART SAHİBİ</small>
              <strong>Deniz Örnek</strong>
              <small>KART NUMARASI</small>
              <span>SK · 0000 0000</span>
            </div>
          </div>
          <div className="card-bottom">
            <span>SECUREKIT / DEMO</span>
            <span>▥ ▥ ▥</span>
          </div>
        </div>
        <p className="visual-caption">HİZALAMA → OCR → GÖRSEL KARŞILAŞTIRMA</p>
      </div>
    );
  return (
    <div className="network-visual">
      <svg
        viewBox="0 0 500 310"
        role="img"
        aria-label="Ağ ve konum sinyallerinin birleşimi"
      >
        <g stroke="#d8d7e2" fill="none">
          <ellipse cx="250" cy="155" rx="116" ry="116" />
          <ellipse cx="250" cy="155" rx="56" ry="116" />
          <ellipse cx="250" cy="155" rx="116" ry="47" />
          <path d="M134 155h232M250 39v232M72 74l178 81 172-60M97 244l153-89 154 93" />
        </g>
        <g fill="#fff" stroke="#0a0f1f">
          {[
            [72, 74],
            [422, 95],
            [97, 244],
            [404, 248],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="8" />
          ))}
        </g>
        <circle
          className="network-pulse"
          cx="250"
          cy="155"
          r="22"
          fill="#0a0f1f"
        />
        <path
          d="m241 155 6 6 13-13"
          stroke="#fff"
          strokeWidth="2"
          fill="none"
        />
      </svg>
      <p className="visual-caption">IP · VPN · PROXY · TOR · KONUM</p>
    </div>
  );
}
