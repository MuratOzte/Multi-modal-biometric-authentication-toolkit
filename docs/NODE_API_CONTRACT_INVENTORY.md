# Node API sözleşme envanteri

Bu envanter Aşama 0 için `packages/node-auth/src/server.ts` tarafından gerçekten
bağlanan router'lar ve onların servislerinden çıkarıldı. ASP.NET API'de bu
aşamada yalnızca `/health` uygulanır. Diğer yollar sonraki aşamaların taşıma
sözleşmesidir; aşağıdaki örnekler Node davranışını gösterir.

## Ortak kurallar

- Base URL: Node `http://localhost:3001`; C# başlangıç iskeleti `http://localhost:3002`.
- JSON istekler `application/json`, dosya istekleri `multipart/form-data` kullanır.
  Başarılı iş yanıtları ve route hata yanıtları `application/json` döner.
- Node `cors()` tüm origin'lere izin verir; credentials açılmaz. JSON parser
  limiti `2mb`'dir. Parser/Multer dışındaki route hatalarının genel şekli
  `{"error":{"code":"...","message":"...","details":{}}}` olur.
  `details` yalnızca üretildiğinde vardır; `null` ile eksik alan aynı değildir.
- Express'in global JSON parser hataları (bozuk JSON / boyut aşımı) ve bilinmeyen
  yolları varsayılan HTML yanıtı verebilir. Bunlar route sözleşmesiyle karıştırılmamalıdır.
  C# başlangıç iskeletinin model binding hatası `400 VALIDATION_ERROR` JSON zarfıdır;
  tam parser uyumluluğu ilgili contract testlerinde ayrıca kararlaştırılmalıdır.
- Örneklerdeki `u1`, `c1`, `s1`, tarihler, skorlar ve yollar temsili değerlerdir.
  Gerçek UUID, zaman ve sayısal skorları sonraki testlerde deterministik dependency
  veya açık normalizasyonla karşılaştırın. Aşağıdaki büyük yanıtların alan listeleri
  de sözleşmenin parçasıdır; kısaltılmış örnekler tam fixture yerine geçmez.
- Kullanıcı ID'leri auth ve kart router'larında trim + lowercase, diğer ana
  router'larda trim edilir. Bunları tek bir genel ID normalizasyonuna çevirmeyin.
- Session kararları `allow | step-up | deny`, dinamik klavye ve ses kararları
  `allow | step_up | deny`, sabit metin kararları `accept | reject` olur.

## Sağlık, kullanıcı, challenge ve profil

Kaynak: `routes/legacyVerification.ts`, `auth.ts`, `challenge.ts`, `consent.ts`,
`profiles.ts` (tümü `packages/node-auth/src` altında).

| Method / path | Content type ve istek örneği | Başarılı yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `GET /health` | Gövde yok | `200 {"ok":true}` | Route'a özgü hata yok |
| `GET /auth/users` | Gövde yok | `200 {"ok":true,"users":[{"userId":"u1","createdAt":"2026-10-07T09:00:00.000Z","updatedAt":"2026-10-07T09:00:00.000Z"}]}` | `500 INTERNAL_ERROR`; kayıt alanları yoksa tarihler atlanır |
| `POST /auth/register` | JSON `{"userId":"u1","password":"demo"}` | Yeni: `201 {"ok":true,"userId":"u1","created":true}`; aynı parola: `200 {"ok":true,"userId":"u1","created":false}` | `400 VALIDATION_ERROR` + `details.fieldErrors`; farklı parolalı mevcut kullanıcı `409 USER_EXISTS`; depolama `500 INTERNAL_ERROR` |
| `POST /auth/login` | JSON `{"userId":"u1","password":"demo"}` | `200 {"ok":true,"userId":"u1"}` | `400 VALIDATION_ERROR`; kullanıcı/parola eşleşmezse `401 INVALID_CREDENTIALS`; `500 INTERNAL_ERROR` |
| `POST /challenge/text` | JSON `{"lang":"tr","length":"short","wordCount":4,"sessionId":"s1","text":"bugün güzel bir gün"}`; tüm alanlar opsiyonel, `{}` kabul edilir | `200 {"challengeId":"c1","text":"bugün güzel bir gün","lang":"tr","expiresAt":"2026-10-07T09:02:00.000Z"}` | `400 INVALID_REQUEST`; `lang=tr/en`, `length=short/medium/long`, yuvarlanan `wordCount=1..64`, verilen string alanlar boş olamaz |
| `POST /challenge/text/consume` | JSON `{"challengeId":"c1"}` | `200 {"ok":true,"challengeId":"c1"}` | `400 INVALID_REQUEST`, `404 CHALLENGE_NOT_FOUND`, `410 CHALLENGE_EXPIRED`, `409 CHALLENGE_ALREADY_USED` |
| `POST /consent` | JSON `{"userId":"u1","consentVersion":"v1"}` | `200 {"ok":true,"userId":"u1","consentVersion":"v1","grantedAt":"2026-10-07T09:00:00.000Z"}` | `400 VALIDATION_ERROR` + `details.fieldErrors`; `500 INTERNAL_ERROR` |
| `GET /user/:userId/profiles` | Gövde yok; `/user/u1/profiles` | `200 {"ok":true,"profiles":{"userId":"u1","keystroke":null,"faceReferenceImagePath":null,"faceReferenceEnrolledAt":null,"faceEmbedding":null,"cardReferenceImagePath":null,"cardReferenceEnrolledAt":null,"voice":null,"voiceEmbedding":null,"updatedAt":"2026-10-07T09:00:00.000Z"}}` | Boş ID `400 VALIDATION_ERROR`; `500 INTERNAL_ERROR`; kayıt yoksa 404 yerine bu boş profil döner |
| `DELETE /user/biometrics` | JSON `{"userId":"u1"}`; opsiyonel query `?deleteConsent=true` | `200 {"ok":true,"userId":"u1"}` | `400 VALIDATION_ERROR`; `500 INTERNAL_ERROR` |

Challenge varsayılan dil `tr`, uzunluk `short`, TTL 120 saniyedir
(`CHALLENGE_TTL_SECONDS`). Consume tek kullanımlıdır. Profil silme ana storage
profilini siler; `deleteConsent=true` destekleyen adapter'da consent kayıtlarını
da siler. Sabit metin template deposu ve referans dosyalarını silme davranışı
bu route'ta uygulanmaz; mevcut davranış ayrıca genişletilmeden taşınmalıdır.

Örnek doğrulama hatası (consent, `400`):

```json
{"error":{"code":"VALIDATION_ERROR","message":"Invalid consent request.","details":{"fieldErrors":{"userId":"userId is required.","consentVersion":"consentVersion is required."}}}}
```

## Oturum ve risk

Kaynak: `routes/session.ts`, `session/inMemoryStore.ts`,
`packages/core/src/contracts/session.ts`.

| Method / path | Content type ve istek örneği | Başarılı yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `POST /session/start` | Gövde kullanılmaz; JSON `{}` | `200 {"sessionId":"s1","expiresAt":"2026-10-07T09:15:00.000Z"}` | Route'a özgü validation yok |
| `POST /verify/session` | JSON `{"sessionId":"s1","userId":"u1","policy":{"allowedCountries":["TR"]},"signals":{"location":{"ok":true,"countryCode":"TR","allowed":true,"reasons":[]}}}` | `200 {"sessionId":"s1","riskScore":0,"decision":"allow","requiredSteps":[],"reasons":[],"signalsUsed":{"location":{"ok":true,"countryCode":"TR","allowed":true,"reasons":[]}}}` (skor/reasons politikaya bağlı) | `400 INVALID_REQUEST`, `404 SESSION_NOT_FOUND`, `410 SESSION_EXPIRED` |

TTL varsayılan 900 saniye (`SESSION_TTL_SECONDS`). `signals` alanları `network`,
`location`, dinamik `keystroke` sample ve `voice` signal olabilir. Yeni sinyaller
oturumda öncekilerle birleştirilir. `policy` alanları `allowMaxRisk`, `denyMinRisk`,
`stepUpSteps`, `treatVpnAsFailure`, `allowedCountries`, `minNetworkScore`,
`keystroke`, `voice` olabilir. `requiredSteps` elemanı
`{"step":"voice","ui":{"title":"...","instruction":"..."},"meta":{}}`
şeklindedir; `meta` opsiyoneldir. Kullanılmayan `signalsUsed` alt alanları atlanır.

## Ağ, konum ve eski doğrulamalar

Kaynak: `routes/legacyVerification.ts`, `routes/legacy/helpers.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `POST /verify/network` | JSON `{"clientOffsetMin":-180,"scenario":"clean"}` | `200 {"ok":true,"score":1,"flags":{"vpn":false,"proxy":false,"tor":false,"relay":false},"reasons":[],"ipInfo":{"ip":"8.8.8.8","countryCode":"TR","timezoneOffsetMin":-180,"clientOffsetMin":-180,"driftMin":0}}` (ek `raw` olabilir; skor kaynağa bağlı) | `400 IP_NOT_FOUND`; dış servis `502 IP_CHECK_FAILED` |
| `POST /verify/location` | JSON `{"allowedCountries":["TR"],"scenario":"clean"}` | `200 {"ok":true,"countryCode":"TR","allowed":true,"reasons":[]}` | `400 IP_NOT_FOUND`; `502 IP_CHECK_FAILED`; ülke politikası başarısızlığı HTTP 200 + `ok:false` |
| `POST /verify/vpn:check` | JSON `{"clientTimeZone":"Europe/Istanbul","clientTimeOffsetMinutes":-180}` | `200 {"ok":true,"score":1,"details":{"ip":"8.8.8.8","ipTimeZone":"Europe/Istanbul","ipCountry":"TR","ipRegion":null,"isVpn":false,"isProxy":false,"isTor":false,"isRelay":false,"timezoneDriftHours":0,"clientTimeZone":"Europe/Istanbul","clientTimeOffsetMinutes":-180,"source":"mock","ipInfo":null}}` | IP yok `400`, servis hatası `500`; hata zarfı yerine `ok:false,score:0,details` döner |
| `POST /verify/location:country` | JSON `{"expectedCountryCode":"TR","clientCountryCode":"TR","scenario":"clean"}` | `200 {"ok":true,"score":1,"ipCountryCode":"TR","expectedCountryCode":"TR","clientCountryCode":"TR","details":{"ip":"8.8.8.8","ipCountryCode":"TR","expectedCountryCode":"TR","clientCountryCode":"TR","matchesExpectedCountry":true,"matchesClientCountry":true,"reason":null,"ipInfo":null,"security":{"vpn":false,"proxy":false,"tor":false,"relay":false}}}` | IP yok `400` (`details.reason=no_ip`); servis hatası `500` (`ip_check_failed`); eski result biçimi kullanılır |
| `POST /verify/webauthn:passkey` | JSON `{"proof":{"demo":true}}` | `200 {"ok":true,"score":1}` | Truthy proof yoksa `200 {"ok":false,"score":0}`; demo davranışı |
| `POST /verify/face:liveness` | JSON `{"proof":{"tasksOk":true},"metrics":{"quality":0.9,"illuminationOk":true}}` | `200 {"ok":true,"score":1,"details":{"illuminationOk":true}}` | Şartlar sağlanmazsa HTTP 200 + `ok:false,score:0`; `illuminationOk` boolean değilse `details` atlanır |

IP `x-forwarded-for` ilk elemanından, yoksa socket'ten alınır. Development'ta
`::1`/`127.0.0.1` yerine `8.8.8.8` kullanılır. Offset alias'ları
`clientOffsetMin`, `clientTimeOffsetMinutes`, `clientTimezoneOffset`, `tzOffset`,
`clientOffset`; timezone alias'ı `clientTimezone`'dur. `scenario=clean/risky`
mock pipeline için kullanılır. `routes/ipCheckRoute.ts` içindeki router
`server.ts`'ye bağlı değildir; canlı endpoint envanterine dahil edilmedi.

## Dinamik klavye

Kaynak: `routes/keystroke.ts`, `routes/keystroke/parsers.ts`,
`packages/core/src/contracts/enrollment.ts`, `keystroke.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `POST /enroll/keystroke` | JSON `{"userId":"u1","sample":{"events":[{"key":"a","type":"down","t":0},{"key":"a","type":"up","t":90}],"expectedText":"a","typedLength":1}}` | `200 {"ok":true,"profile":{...},"sampleMetrics":{...},"enrollmentProgress":{"roundsCompleted":1,"roundsTarget":10,"roundsRemaining":9,"keystrokesCollected":1,"keystrokesTarget":160,"keystrokesRemaining":159,"ready":false},"reasons":[...]}` | `400 VALIDATION_ERROR`, consent yok `403 CONSENT_REQUIRED`, `500 INTERNAL_ERROR` |
| `POST /verify/keystroke` | JSON `{"userId":"u1","challengeId":"c1","sessionId":"s1","sample":{"events":[{"key":"a","type":"down","t":0},{"key":"a","type":"up","t":90}],"expectedText":"a"},"policy":{"updateProfileOnAllow":false}}` | `200 {"ok":true,"userId":"u1","similarityScore":0.9,"distance":0.1,"decision":"allow","reasons":[],"sampleMetrics":{...},"profile":{...},"profileUpdated":false,"signalsUsed":{"keystroke":{...}}}` | `400 VALIDATION_ERROR` (challenge/text/session eşleşmesi dahil); `404 CHALLENGE_NOT_FOUND`, `410 CHALLENGE_EXPIRED`, `409 CHALLENGE_ALREADY_USED`; `500 INTERNAL_ERROR` |

Enrollment top-level `events` dizisini de kabul eder. İsteğe bağlı
`expectedText`, `typedLength`, `errorCount`, `backspaceCount`, `imeCompositionUsed`
alanları vardır. Event alanları `key?`, `code?`, `type=down/up`, `t`, `isRepeat?`,
`location?`, `expectedIndex?`; sample ek alanları `challengeId?`,
`ignoredEventCount?`, `source=legacy/collector_v1` olabilir.

`profile` temel alanları `userId`, `createdAt`, `updatedAt`, `sampleCount`,
`holdMeanMs`, `holdStdMs`, `flightMeanMs`, `flightStdMs`; ek istatistikler ve
`sampleRoundCount` contract tipinde tanımlıdır. `sampleMetrics` hold/flight/dd/ud/uu
mean/std/median, hız, hata/backspace oranı, digraph/keystroke/event sayısı, süre,
başlama gecikmesi, kelimeler arası duraklama ve düzeltme istatistiklerini içerir.
`signalsUsed.keystroke` alanları `similarityScore`, `distance`, `decision`,
`reasons`, `sampleMetrics`, `thresholds={allowThreshold,stepUpThreshold,denyThreshold}`.
Eksik/yetersiz profil gibi kararlar servis tarafından HTTP 200 içinde ifade
edilebilir; bu durumları HTTP 404'e çevirmeyin.

## Sabit metin klavye (Python)

Kaynak: `routes/keystrokeFixedText.ts`, `routes/fixedText/*`, `keystroke/types.ts`,
`keystroke/validate.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `GET /api/securekit/keystroke/status` | Query `?userId=u1&textId=t1`; gövde yok | `200 {"ok":true,"userId":"u1","textId":"t1","registered":false,"template":null}`; kayıt varsa `template={expectedText,sampleCount,updatedAt}` | `400 INVALID_REQUEST`; `500 INTERNAL_ERROR` |
| `POST /api/securekit/keystroke/enroll` | JSON `{"userId":"u1","textId":"t1","expectedText":"bugün güzel bir gün","samples":[SAMPLE]}` | `200 {"ok":true,"enrolled":true,"template":{"count":5,"dim":52},"recommended":{"distThreshold":2,"scoreThreshold":0.7,"autoEnrollScore":0.95}}` | `400 INVALID_REQUEST` / örnek hatası; `502 PYTHON_PROTOCOL_ERROR` / bridge kodu; `500 INTERNAL_ERROR` |
| `POST /api/securekit/keystroke/verify` | JSON `{"userId":"u1","textId":"t1","expectedText":"bugün güzel bir gün","sample":SAMPLE,"opts":{"autoEnroll":false}}` | Kayıt yok: `200 {"ok":true,"decision":"reject","score":0,"dist":9999,"autoEnrolled":false,"reason":"not_enrolled","metrics":{"count":0,"thresholdDist":0,"thresholdScore":0,"autoEnrollScore":0}}`; kayıt varsa aynı alanlar hesaplanır, `reason` opsiyonel | `400 INVALID_REQUEST`, `TEXT_MISMATCH` / örnek hatası; `502 PYTHON_PROTOCOL_ERROR` / bridge kodu; `500 INTERNAL_ERROR` |

`SAMPLE` şekli (diziler metnin karakter sayısıyla uyumlu olacak şekilde doldurulur):

```text
{textId:"t1",text:"bugün güzel bir gün",holdMs:[90,...],ddMs:[130,...],udMs:[40,...],
 meta:{timestamp:1791363600000,durationMs:2400,invalid:false},
 corrections:{events:[],mismatchCount:0,extraCount:0,backspaceCount:0}}
```

`corrections` opsiyoneldir; olayları `type=mismatch/extra/backspace`, `t`, `index`,
opsiyonel `key/expected/removed` içerir. Validation hata kodları `INVALID_SAMPLE`,
`TEXT_ID_MISMATCH`, `TEXT_MISMATCH`, `LENGTH_MISMATCH`, `OUT_OF_RANGE`,
`REPLAY_REJECTED` (400). Python bridge kodları `PYTHON_SPAWN_FAILED`,
`PYTHON_TIMEOUT`, `PYTHON_EXIT_NON_ZERO`, `PYTHON_JSON_PARSE_ERROR`,
`PYTHON_REPORTED_ERROR` burada **502** ile döner; yüz/ses timeout davranışından
farklıdır. Metadata `updatedAt` Unix milisaniyedir. Bu akış consent adapter'ını
kullanmaz ve ana profile deposundan bağımsızdır.

## Yüz ve kayan pencere

Kaynak: `routes/face.ts`, `routes/faceSlidingWindow.ts`, `face/service.ts`,
`face/results.ts`, `face/slidingWindowBridge.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `POST /enroll/face/reference` | Multipart `userId=u1`, `referenceImage=@reference.jpg` | `200 {"ok":true,"userId":"u1","reference":{"imagePath":"/local/face/u1.jpg","enrolledAt":"2026-10-07T09:00:00.000Z","source":"upload"}}` | `400 INVALID_REQUEST/REFERENCE_REQUIRED/INVALID_IMAGE_TYPE`; `413 IMAGE_TOO_LARGE`; `500 INTERNAL_ERROR` |
| `POST /verify/face` | Multipart `probeImage=@probe.jpg`, `userId=u1`, `threshold=0.8`; alternatif `referenceImage=@reference.jpg` veya `referenceImagePath=/allowed/reference.jpg` | `200 {"ok":true,"matched":true,"score":0.9,"reason":null,"runtime":{"device":"cpu","cudaAvailable":false}}`; `failureCode` ve ek runtime alanları opsiyonel | `400 INVALID_REQUEST/PROBE_REQUIRED/REFERENCE_REQUIRED/INVALID_IMAGE_TYPE/REFERENCE_PATH_INVALID`; `404 REFERENCE_NOT_FOUND`; `413 IMAGE_TOO_LARGE`; Python hataları aşağıda |
| `POST /verify/face-sliding` | Multipart `userId=u1`, `probeImage=@probe.jpg`, opsiyonel `threshold=0.8`, `maxWindow=3`, `updateOnSuccess=true` | `200 {"ok":true,"matched":true,"score":0.9,"perReferenceScores":[{"id":"r1","ts":1791363600000,"score":0.9}],"windowSizeBefore":1,"windowSizeAfter":2,"threshold":0.8,"reason":null,"added":{"id":"r2","ts":1791363601000},"evicted":[]}` | `400 INVALID_REQUEST/PROBE_REQUIRED/INVALID_IMAGE_TYPE`; `413 IMAGE_TOO_LARGE`; Python hataları aşağıda |

Kodda kayan pencere için yalnızca **`POST /verify/face-sliding`** bağlıdır.
Plandaki `POST /enroll/face/sliding-window` mevcut Node route'u değildir; bu
yolu eklemek uyumluluk taşınmasından ayrı bir karar gerektirir.

JPEG/PNG/WebP kabul edilir, varsayılan dosya limiti 5 MiB. Yüz referansı seçim
önceliği upload > açık path > kullanıcı profilidir. Yüz/ses/kartta Python runtime
yoksa `503 PYTHON_RUNTIME_UNAVAILABLE`, timeout `504 PYTHON_TIMEOUT`, bozuk
çıktı `502 PYTHON_OUTPUT_INVALID`, süreç hatası `502 PYTHON_PROCESS_ERROR` olur.
Yüzde GPU zorunluluğu `503 GPU_REQUIRED` olabilir. Python'un geçerli negatif
kararı HTTP 200 + `ok:false/matched:false/reason/failureCode` olabilir.
Kayan pencere worker sonucu doğrudan döner; `added` null olabilir, entry'de
`image` opsiyoneldir. Yüz route'ları consent kontrolü yapmaz.

## Ses

Kaynak: `routes/voice.ts`, `voice/service.ts`, `voice/types.ts`,
`packages/core/src/contracts/voice.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `POST /enroll/voice` | Multipart `userId=u1`, `challengeId=c1`, `audioSample=@voice.webm`; opsiyonel `sessionId=s1`, `transcriptThreshold=0.78`, `minEnrollmentSamples=3` | `200 {"ok":true,"userId":"u1","profile":{...},"enrollmentProgress":{"sampleCount":1,"requiredSamples":3,"complete":false},"transcript":{...},"runtime":{...},"reasons":[...]}` | `400 INVALID_REQUEST/AUDIO_REQUIRED/INVALID_AUDIO_TYPE/AUDIO_TOO_SHORT/CHALLENGE_SESSION_MISMATCH`; `403 CONSENT_REQUIRED`; challenge 404/410/409; `413 AUDIO_TOO_LARGE`; `422 TRANSCRIPT_MISMATCH`; Python ve internal hataları |
| `POST /verify/voice` | Multipart `userId=u1`, `challengeId=c1`, `audioSample=@voice.webm`; opsiyonel `sessionId`, `matchThreshold`, `stepUpThreshold`, `denyThreshold`, `transcriptThreshold`, `profileUpdateAlpha`, `updateProfileOnAllow` | `200 {"ok":true,"userId":"u1","matched":true,"similarityScore":0.9,"decision":"allow","reasons":[],"transcript":{...},"runtime":{...},"profile":{...},"profileUpdated":false,"signalsUsed":{"voice":{...}}}` | `400` validation/audio/session; `404 PROFILE_NOT_FOUND`; challenge 404/410/409; `413 AUDIO_TOO_LARGE`; Python ve `500 INTERNAL_ERROR`; transcript eşleşmemesi 200 kararında ifade edilir |

MIME: `audio/webm`, `audio/wav`, `audio/wave`, `audio/x-wav`, `audio/mpeg`,
`audio/mp4`, `audio/ogg`. Varsayılan limit 12 MiB. Challenge tüketilir ve metni
sesle eşleştirilir. Eksik dependency veya zorunlu GPU `503
PYTHON_DEPENDENCY_MISSING/GPU_REQUIRED`; diğer Python hataları yüz tablosuyla aynıdır.

- `profile`: `embedding`, `sampleCount`, `embeddingDim`, `enrolledAt`, `updatedAt`, `model`.
- `transcript`: `expectedText`, `transcript` (null olabilir), `similarityScore`, `matched`, `threshold`.
- `runtime`: `device`, `cudaAvailable`; opsiyonel `cudaDeviceName`, `fallbackReason`, `whisperModel`, `speakerModel`.
- `signalsUsed.voice`: `similarityScore`, `decision`, `reasons`, `transcript`, `runtime`,
  `thresholds={matchThreshold,stepUpThreshold,denyThreshold,transcriptThreshold}`.

## Kart

Kaynak: `routes/card.ts`, `card/service.ts`, `packages/core/src/contracts/card.ts`.

| Method / path | Content type ve istek örneği | Yanıt örneği | Hata durumları |
| --- | --- | --- | --- |
| `GET /card/references` | Gövde yok | `200 {"ok":true,"referenceDir":"/local/cards","references":[{"id":"ref.jpg","fileName":"ref.jpg","label":"ref","imagePath":"/local/cards/ref.jpg"}]}` | `500 INTERNAL_ERROR` |
| `POST /enroll/card/reference` | Multipart `userId=u1`, `referenceImage=@card.jpg` | `200 {"ok":true,"userId":"u1","reference":{"imagePath":"/local/cards/u1.jpg","enrolledAt":"2026-10-07T09:00:00.000Z","source":"upload"}}` | `400 INVALID_REQUEST/INVALID_IMAGE_TYPE`; `413 IMAGE_TOO_LARGE`; `500 INTERNAL_ERROR` |
| `POST /verify/card` | Multipart `probeImage=@probe.jpg`; opsiyonel `userId=u1`, `referenceId=ref.jpg`, `threshold=0.7` | `200 {"ok":true,"matched":false,"threshold":0.7,"checkedCount":1,"reason":"different","bestMatch":{...},"candidates":[...]}` | `400 INVALID_REQUEST/PROBE_REQUIRED/INVALID_IMAGE_TYPE`; `404 REFERENCE_NOT_FOUND`; `413 IMAGE_TOO_LARGE`; Python hataları yüz tablosuyla aynı; `500 INTERNAL_ERROR` |

JPEG/PNG/WebP, varsayılan limit 5 MiB. `referenceId` veya `userId` seçilen
referansları daraltır; ikisi yoksa genel referans dizini kullanılır. `bestMatch`
null olabilir. Her candidate şu alanları içerir: `referenceImagePath`,
`referenceFileName`, `decision=same/different/uncertain`, `overallScore`,
`contentScore`, `visualScore`, opsiyonel `visualDetails`, `reasons`, `fields`,
`quality`, `matched`. `fields.probe/reference` alanları `name`, `studentNo`,
opsiyonel `documentNo`, `cardNo`, `validThru`; `quality` alanları
`cardDetectedProbe`, `cardDetectedReference`, `detectionConfidenceProbe`,
`detectionConfidenceReference`, `ocrAvailable`, `ocrWeak`, `ocrErrorProbe`,
`ocrErrorReference`. `visualDetails` alanları `activeMethod=clip`, `clipScore`,
`clipCosine`, `clipAvailable`, `clipModel`, `clipDevice`, `clipError`.

Kart yanıtında `cardVerificationByClipOld` da bulunur (nesne veya null).
`userId`, `referenceId` alanına göre önceliklidir; kullanıcı kimliği trim/lowercase
ile normalize edilir. Kart enrollment rıza veya challenge gerektirmez.
İşçi `ready` sonrasında JSON-lines isteği alır; varsayılan timeout 300 saniyedir.
Çalıştırıcı yokluğu `503 PYTHON_RUNTIME_UNAVAILABLE`, timeout `504 PYTHON_TIMEOUT`,
bozuk JSON/şema `502 PYTHON_OUTPUT_INVALID`, işlem ve OCR bağımlılık hataları
`502 PYTHON_PROCESS_ERROR` döner. Geçerli negatif eşleşme sonucu HTTP 200'dür.
Bridge `fields.probe/reference.documentNo` eksikse boş metin ekler ve
worker-only `id` / `durationMs` alanlarını yanıt sözleşmesine dahil etmez.

## Sonraki aşamalarda karşılaştırma

`apps/securekit-api.tests/Support/ContractAssert.cs` durum kodu, JSON content type,
hata zarfı ve iki host yanıtının JSON yapısal eşitliği için ortak yardımcıdır.
`EquivalentAsync` her istemci için ayrı istek üretir; alan sırasını önemsemez,
eksik alan/null ayrımını ve dizi sırasını korur. Rastgele ID/tarih için verilen
normalizasyon callback'i iki yanıta da uygulanır. Biyometrik sayısal toleranslar
ilgili aşamada ayrıca tanımlanmalıdır.

Node fixture/test kaynakları `packages/node-auth/src/__tests__`, istemci
sözleşme testleri `packages/web-sdk/src/__tests__` altındadır. Gerçek Python
modelleri yerine dependency injection ile verilen runner'lar, `MOCK_IP_CHECK=1`,
sabit saat ve ayrı geçici depolar kullanın. Aşama 0 karşılaştırma altyapısını
hazırlar; bütün iş endpoint'lerinin Node/C# eşitliğini doğruladığı anlamına gelmez.
