import { translator, type Locale } from "./locale";

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

export function IdentityTrace({ label }: { label: string }) {
  return (
    <svg
      className="identity-trace"
      viewBox="0 0 600 480"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M178 205c0-77 49-127 122-127 69 0 122 51 122 122" />
      <path d="M157 260c10-20 7-40 7-60 0-87 57-136 136-136 82 0 136 57 136 136 0 33-2 59-10 87" />
      <path d="M180 288c15-30 12-58 12-83 0-66 44-113 108-113 63 0 108 46 108 108 0 58-5 106-28 149" />
      <path d="M196 317c25-35 10-78 10-112 0-58 38-99 94-99 55 0 94 39 94 94 0 69-11 124-40 172" />
      <path d="M216 337c30-39 4-94 4-132 0-49 32-85 80-85 47 0 80 33 80 80 0 78-16 137-50 185" />
      <path d="M239 351c29-46-5-102-5-146 0-42 27-71 66-71 38 0 66 28 66 66 0 87-21 149-58 193" />
      <path d="M259 320c0-42-11-77-11-115 0-33 21-57 52-57 30 0 52 22 52 52 0 94-24 157-65 194" />
      <path
        className="identity-trace-accent"
        d="M274 302c0-34-12-65-12-97 0-26 15-43 38-43s38 16 38 38c0 97-29 158-71 189"
      />
      <path d="M289 280c0-25-13-48-13-75 0-18 9-29 24-29s24 10 24 24c0 77-19 129-48 162" />
      <path d="M300 200c0 36 14 67 5 107" />
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

// Static line illustrations share the hero's ink and violet accent.
export function SignalVisual({
  active,
  locale,
}: {
  active: number;
  locale: Locale;
}) {
  const t = translator(locale);
  const labels = [
    "Yazım ritmini temsil eden tuşlar ve çizgiler",
    "Yüz biyometrisini temsil eden sade yüz çizimi",
    "Ses biyometrisini temsil eden sabit ses dalgaları",
    "Belge doğrulamayı temsil eden sade kimlik kartı",
    "Ağ ve konumu temsil eden sade küre çizimi",
  ];
  const illustrations = [
    <>
      <path d="M164 169h44m24 0h88m24 0h92M164 185h76m24 0h40m24 0h108M164 201h28m24 0h92m24 0h104" />
      <rect x="145" y="239" width="64" height="64" rx="10" />
      <rect x="227" y="239" width="64" height="64" rx="10" />
      <rect
        className="signal-accent"
        x="309"
        y="239"
        width="64"
        height="64"
        rx="10"
      />
      <rect x="391" y="239" width="64" height="64" rx="10" />
      <path d="M164 327h272M166 352h268" />
      <path className="signal-accent" d="M324 271h34" />
    </>,
    <>
      <path d="M207 205c-9-80 29-121 93-121s102 41 93 121l-12 85c-5 41-45 89-81 89s-76-48-81-89Z" />
      <path d="M222 196c-7-65 22-97 78-97s85 32 78 97M238 184c0-49 22-70 62-70s62 21 62 70" />
      <path d="M237 217c11-8 25-8 37 0m52 0c12-8 26-8 37 0M242 232c8 6 16 6 25 0m66 0c9 6 17 6 25 0" />
      <path className="signal-accent" d="M302 225v49c0 8 6 12 16 12" />
      <path d="M274 312c16 10 36 10 52 0M252 343c14 15 29 23 48 23s34-8 48-23" />
    </>,
    <>
      {[172, 202, 232, 262, 292].map((y, i) => (
        <path
          key={y}
          className={i === 2 ? "signal-accent" : undefined}
          d={`M135 ${y}h40c30 0 30-48 60-48s30 96 60 96 30-96 60-96 30 48 60 48h50`}
        />
      ))}
    </>,
    <>
      <rect x="142" y="133" width="316" height="216" rx="18" />
      <path d="M157 119h286M157 363h286" />
      <rect x="174" y="181" width="100" height="116" rx="8" />
      <circle cx="224" cy="217" r="18" />
      <path d="M193 280v-11c0-33 62-33 62 0v11M304 190h116M304 214h82M304 263h116M304 287h64" />
      <path className="signal-accent" d="m376 316 12 12 27-28" />
    </>,
    <>
      <circle cx="300" cy="240" r="132" />
      <ellipse cx="300" cy="240" rx="96" ry="132" />
      <ellipse cx="300" cy="240" rx="48" ry="132" />
      <path d="M168 240h264M186 174c62 27 166 27 228 0M186 306c62-27 166-27 228 0" />
      <path className="signal-accent" d="M300 108c43 57 43 207 0 264" />
    </>,
  ];
  return (
    <svg
      className="signal-illustration"
      viewBox="0 0 600 480"
      role="img"
      aria-label={t(labels[active])}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {illustrations[active]}
    </svg>
  );
}
