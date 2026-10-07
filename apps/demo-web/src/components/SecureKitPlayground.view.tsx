import React from "react";
import type { SecureKitPlaygroundController } from "./SecureKitPlayground.controller.js";
import {
  decisionClass,
  pretty,
  renderChallengePreview,
  toPercent,
} from "./SecureKitPlayground.utils.js";

export function SecureKitPlaygroundView(model: SecureKitPlaygroundController) {
  return (
    <div className="sk-app">
      <div className="sk-orb sk-orb-a" aria-hidden="true" />
      <div className="sk-orb sk-orb-b" aria-hidden="true" />

      <main className="sk-shell">
        <header className="sk-hero">
          <p className="sk-tag">SecureKit Playground</p>
          <h1>Keystroke Enrollment and Verification</h1>
          <p className="sk-subtitle">
            Capture real typing rhythm, enroll repeated samples, then verify the user.
          </p>
          <p className="sk-base-url">
            API Base: <code>{model.baseUrl}</code>
          </p>
        </header>

        <section className="sk-card">
          <div className="sk-card-head">
            <h2>Setup</h2>
          </div>

          <div className="sk-grid sk-grid-3">
            <label className="sk-field">
              <span>userId</span>
              <input
                value={model.userId}
                onChange={(event) => model.setUserId(event.target.value)}
                placeholder="demo-user-1"
              />
            </label>

            <label className="sk-field">
              <span>consentVersion</span>
              <input
                value={model.consentVersion}
                onChange={(event) => model.setConsentVersion(event.target.value)}
                placeholder="v1"
              />
            </label>

            <label className="sk-field">
              <span>challenge language</span>
              <input value="Turkish (fixed)" disabled />
            </label>

            <label className="sk-field">
              <span>target rounds</span>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={model.targetRoundsInput}
                onChange={(event) => model.setTargetRoundsInput(event.target.value)}
              />
            </label>

            <label className="sk-field">
              <span>sessionId (optional)</span>
              <input
                value={model.sessionId}
                onChange={(event) => model.setSessionId(event.target.value)}
                placeholder="/verify/session coupling"
              />
            </label>
          </div>

          <div className="sk-grid sk-grid-3 sk-grid-tight">
            <label className="sk-field">
              <span>allow threshold</span>
              <input
                value={model.allowThresholdInput}
                onChange={(event) => model.setAllowThresholdInput(event.target.value)}
              />
            </label>

            <label className="sk-field">
              <span>step_up threshold</span>
              <input
                value={model.stepUpThresholdInput}
                onChange={(event) => model.setStepUpThresholdInput(event.target.value)}
              />
            </label>

            <label className="sk-field">
              <span>deny threshold</span>
              <input
                value={model.denyThresholdInput}
                onChange={(event) => model.setDenyThresholdInput(event.target.value)}
              />
            </label>
          </div>

          <div className="sk-inline-options">
            <label className="sk-check">
              <input
                type="checkbox"
                checked={model.showRawEvents}
                onChange={(event) => model.setShowRawEvents(event.target.checked)}
              />
              <span>Show raw events (dev)</span>
            </label>

            <label className="sk-check">
              <input
                type="checkbox"
                checked={model.deleteConsent}
                onChange={(event) => model.setDeleteConsent(event.target.checked)}
              />
              <span>deleteConsent=true on biometric delete</span>
            </label>
          </div>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={model.runConsent}
              disabled={model.consentBusy !== "idle"}
            >
              {model.consentBusy === "loading" ? "Working..." : "Step 1: POST /consent"}
            </button>

            <button
              className="sk-btn"
              onClick={model.runProfiles}
              disabled={model.profilesBusy !== "idle"}
            >
              {model.profilesBusy === "loading" ? "Working..." : "Read Profiles"}
            </button>

            <button
              className="sk-btn"
              onClick={model.runDelete}
              disabled={model.deleteBusy !== "idle"}
            >
              {model.deleteBusy === "loading" ? "Working..." : "Delete Biometrics"}
            </button>
          </div>

          {model.consentError && <div className="sk-alert">{model.consentError}</div>}
          {model.profilesError && <div className="sk-alert">{model.profilesError}</div>}
          {model.deleteError && <div className="sk-alert">{model.deleteError}</div>}

          {model.consentResult && (
            <details className="sk-json" open>
              <summary>Consent response</summary>
              <pre>{pretty(model.consentResult)}</pre>
            </details>
          )}

          {model.profilesResult && (
            <details className="sk-json">
              <summary>User profiles</summary>
              <pre>{pretty(model.profilesResult)}</pre>
            </details>
          )}

          {model.deleteResult && (
            <details className="sk-json">
              <summary>Delete response</summary>
              <pre>{pretty(model.deleteResult)}</pre>
            </details>
          )}
        </section>

        <section className="sk-card">
          <div className="sk-card-head">
            <h2>Step 2: Enrollment</h2>
            <span className="sk-pill">
              {Math.min(model.enrollRoundsCompleted, model.targetRounds)}/{model.targetRounds}
            </span>
          </div>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={() => void model.startEnrollment()}
              disabled={model.enrollBusy !== "idle"}
            >
              {model.enrollBusy === "loading" ? "Working..." : "Start Enrollment"}
            </button>
          </div>

          {model.enrollChallenge ? (
            <div className="sk-typing-stage">
              <p className="sk-hint">
                Her turda ayni sabit cumleyi yazin. Buyuk-kucuk harf ve noktalama fark etmez.
              </p>

              <div className="sk-challenge-preview">
                {renderChallengePreview(model.enrollChallenge.text, model.enrollTyped)}
              </div>

              <div className="sk-progress-track">
                <div
                  className="sk-progress-fill"
                  style={{ width: toPercent(model.enrollProgress.progress) }}
                />
              </div>

              <div className="sk-stage-stats">
                <span>progress: {toPercent(model.enrollProgress.progress)}</span>
                <span>accuracy: {toPercent(model.enrollProgress.accuracy)}</span>
                <span>mismatch: {model.enrollProgress.mismatchCount}</span>
              </div>

              <textarea
                ref={model.enrollInputRef}
                className={`sk-input-area ${
                  model.enrollProgress.complete
                    ? "sk-input-ok"
                    : model.enrollProgress.mismatchIndex !== null
                      ? "sk-input-bad"
                      : ""
                }`}
                value={model.enrollTyped}
                onChange={(event) => model.onEnrollChange(event.target.value)}
                onKeyDown={model.onTypingKeyDown}
                onFocus={() => model.enrollCollectorRef.current?.start()}
                onBlur={() => model.enrollCollectorRef.current?.stop()}
                placeholder="Type the same sentence (case/punctuation ignored)"
              />

              <div className="sk-actions">
                <button
                  className="sk-btn"
                  onClick={() => void model.submitEnrollment(model.enrollTyped)}
                  disabled={model.enrollBusy !== "idle" || !model.enrollProgress.complete}
                >
                  Submit enrollment round
                </button>

                <button
                  className="sk-btn"
                  onClick={() => {
                    model.setEnrollTyped("");
                    model.enrollCollectorRef.current?.reset();
                    model.enrollCollectorRef.current?.start();
                    model.enrollInputRef.current?.focus();
                  }}
                  disabled={model.enrollBusy !== "idle"}
                >
                  Clear input
                </button>
              </div>
            </div>
          ) : (
            <p className="sk-hint">Start enrollment to get a challenge text.</p>
          )}

          {model.enrollError && <div className="sk-alert">{model.enrollError}</div>}

          {model.enrollResult && (
            <details className="sk-json" open>
              <summary>Enrollment response</summary>
              <pre>{pretty(model.enrollResult)}</pre>
            </details>
          )}
        </section>

        <section className="sk-card">
          <div className="sk-card-head">
            <h2>Step 3: Verification</h2>
            {model.verifyResult && (
              <span className={decisionClass(model.verifyResult.decision)}>
                {model.verifyResult.decision}
              </span>
            )}
          </div>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={() => void model.startVerification()}
              disabled={model.verifyBusy !== "idle"}
            >
              {model.verifyBusy === "loading" ? "Working..." : "Start Verification"}
            </button>
          </div>

          {model.verifyChallenge ? (
            <div className="sk-typing-stage">
              <p className="sk-hint">
                Enrollment ile ayni sabit cumleyi dogrulayacagiz. Harf boyutu ve noktalama serbest.
              </p>

              <div className="sk-challenge-preview">
                {renderChallengePreview(model.verifyChallenge.text, model.verifyTyped)}
              </div>

              <div className="sk-progress-track">
                <div
                  className="sk-progress-fill"
                  style={{ width: toPercent(model.verifyProgress.progress) }}
                />
              </div>

              <div className="sk-stage-stats">
                <span>progress: {toPercent(model.verifyProgress.progress)}</span>
                <span>accuracy: {toPercent(model.verifyProgress.accuracy)}</span>
                <span>mismatch: {model.verifyProgress.mismatchCount}</span>
              </div>

              <textarea
                ref={model.verifyInputRef}
                className={`sk-input-area ${
                  model.verifyProgress.complete
                    ? "sk-input-ok"
                    : model.verifyProgress.mismatchIndex !== null
                      ? "sk-input-bad"
                      : ""
                }`}
                value={model.verifyTyped}
                onChange={(event) => model.onVerifyChange(event.target.value)}
                onKeyDown={model.onTypingKeyDown}
                onFocus={() => model.verifyCollectorRef.current?.start()}
                onBlur={() => model.verifyCollectorRef.current?.stop()}
                placeholder="Type the same sentence (case/punctuation ignored)"
              />

              <div className="sk-actions">
                <button
                  className="sk-btn"
                  onClick={() => void model.submitVerification(model.verifyTyped)}
                  disabled={model.verifyBusy !== "idle" || !model.verifyProgress.complete}
                >
                  Submit verification
                </button>

                <button
                  className="sk-btn"
                  onClick={() => {
                    model.setVerifyTyped("");
                    model.verifyCollectorRef.current?.reset();
                    model.verifyCollectorRef.current?.start();
                    model.verifyInputRef.current?.focus();
                  }}
                  disabled={model.verifyBusy !== "idle"}
                >
                  Clear input
                </button>
              </div>
            </div>
          ) : (
            <p className="sk-hint">Start verification after enrollment.</p>
          )}

          {model.verifyError && <div className="sk-alert">{model.verifyError}</div>}
          {model.sessionError && <div className="sk-alert">{model.sessionError}</div>}

          {model.verifyResult && (
            <div className="sk-verdict">
              <div className="sk-verdict-card">
                <div className="sk-verdict-value">{toPercent(model.verifyResult.similarityScore)}</div>
                <div className="sk-verdict-label">similarity score</div>
              </div>

              <div className="sk-verdict-card">
                <div className="sk-verdict-value">{model.verifyResult.distance.toFixed(3)}</div>
                <div className="sk-verdict-label">distance</div>
              </div>

              <div className="sk-verdict-card sk-verdict-wide">
                <div className="sk-verdict-label">reasons</div>
                <div className="sk-reasons">{model.verifyResult.reasons.join(", ") || "-"}</div>
              </div>
            </div>
          )}

          {model.sessionBusy === "loading" && <p className="sk-hint">Running session verification...</p>}

          {model.verifyResult && (
            <details className="sk-json" open>
              <summary>Verification response</summary>
              <pre>{pretty(model.verifyResult)}</pre>
            </details>
          )}

          {model.sessionResult && (
            <details className="sk-json">
              <summary>Session verification response</summary>
              <pre>{pretty(model.sessionResult)}</pre>
            </details>
          )}
        </section>

        <section className="sk-card">
          <div className="sk-card-head">
            <h2>Latest sample metrics</h2>
          </div>

          {model.lastMetrics ? (
            <>
              <div className="sk-metrics-grid">
                <div className="sk-metric">
                  <span>start delay</span>
                  <strong>{model.lastMetrics.startDelayMs} ms</strong>
                </div>
                <div className="sk-metric">
                  <span>speed</span>
                  <strong>{model.lastMetrics.typingSpeedCharsPerSec} ch/s</strong>
                </div>
                <div className="sk-metric">
                  <span>error rate</span>
                  <strong>{toPercent(model.lastMetrics.errorRate)}</strong>
                </div>
                <div className="sk-metric">
                  <span>backspace rate</span>
                  <strong>{toPercent(model.lastMetrics.backspaceRate)}</strong>
                </div>
                <div className="sk-metric">
                  <span>long pause rate</span>
                  <strong>{toPercent(model.lastMetrics.longPauseRate)}</strong>
                </div>
                <div className="sk-metric">
                  <span>correction burst</span>
                  <strong>{toPercent(model.lastMetrics.correctionBurstRate)}</strong>
                </div>
              </div>

              <details className="sk-json">
                <summary>Full metrics JSON</summary>
                <pre>{pretty(model.lastMetrics)}</pre>
              </details>
            </>
          ) : (
            <p className="sk-hint">No metrics yet.</p>
          )}

          {model.showRawEvents && model.lastRawEvents && (
            <details className="sk-json">
              <summary>Raw events (dev)</summary>
              <pre>{pretty(model.lastRawEvents)}</pre>
            </details>
          )}
        </section>
      </main>
    </div>
  );
}
