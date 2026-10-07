import React from "react";
import type { FixedTextKeystrokePlaygroundController } from "./FixedTextKeystrokePlayground.controller.js";
import {
  fixedDecisionClass,
  MAX_EXPECTED_LENGTH,
  MIN_EXPECTED_LENGTH,
  MIN_EXPECTED_WORD_COUNT,
  pretty,
  TYPING_DNA_BARS,
} from "./FixedTextKeystrokePlayground.utils.js";

function typingTokenClass(state: string): string {
  if (state === "typed") return "sk-tdna-char-typed";
  if (state === "mismatch") return "sk-tdna-char-mismatch";
  if (state === "extra") return "sk-tdna-char-extra";
  if (state === "active") return "sk-tdna-char-active";
  return "";
}

export function FixedTextKeystrokePlaygroundView(
  model: FixedTextKeystrokePlaygroundController
) {
  return (
    <div className="sk-app">
      <div className="sk-orb sk-orb-a" aria-hidden="true" />
      <div className="sk-orb sk-orb-b" aria-hidden="true" />

      <main className="sk-shell">
        <header className="sk-hero">
          <p className="sk-tag">SecureKit Fixed-Text Playground</p>
          <h1>Keystroke Dynamics Enrollment and Verification</h1>
          <p className="sk-subtitle">
            Collect fixed-text typing samples, enroll to python-backed profile, then verify in one
            screen.
          </p>
          <p className="sk-base-url">
            API Base: <code>{model.baseUrl}</code>
          </p>
        </header>

        <section className="sk-card sk-fixed-card">
          <div className="sk-card-head sk-fixed-head">
            <div>
              <h2>Klavye kayit ayarlari</h2>
              <p className="sk-section-note">
                Enrollment basarili olunca bu metin aktif template olarak kilitlenir.
              </p>
            </div>
            <div className="sk-head-actions">
              <span
                className={
                  model.templateStatus.state === "registered" && model.setupLocked
                    ? "sk-pill"
                    : "sk-decision"
                }
              >
                {model.templateStatusLabel}
              </span>
              {model.setupLocked && (
                <button className="sk-btn" onClick={model.handleStartNewEnrollment}>
                  Yeni kayit baslat
                </button>
              )}
            </div>
          </div>

          <div className="sk-grid sk-grid-3">
            <label className="sk-field">
              <span>Kisi</span>
              <select
                value={model.userId}
                onChange={(event) => model.handleFixedTextUserChange(event.target.value)}
                disabled={model.userControlsDisabled}
              >
                {model.fixedTextUsers.map((user) => (
                  <option key={user.value} value={user.value}>
                    {user.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="sk-field">
              <span>textId</span>
              <input
                value={model.textId}
                onChange={(event) => model.setTextId(event.target.value)}
                disabled={model.setupLocked}
              />
            </label>

            <label className="sk-field">
              <span>target enrollment samples</span>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={model.targetSamplesInput}
                onChange={(event) => model.setTargetSamplesInput(event.target.value)}
                disabled={model.setupLocked}
              />
            </label>
          </div>

          <div className="sk-stage-stats">
            <span>{model.templateStatusDetail}</span>
            {model.userListError && <span>Kisi listesi okunamadi.</span>}
          </div>

          <form className="sk-user-form" onSubmit={(event) => void model.handleAddFixedTextUser(event)}>
            <div>
              <span className="sk-template-label">Yeni kisi</span>
              <p className="sk-section-note">
                Mert, Murat ve Emre disinda biri kayit olacaksa adini buradan ekle.
              </p>
            </div>
            <div className="sk-user-form-row">
              <label className="sk-field">
                <span>Kullanici ID</span>
                <input
                  value={model.newUserId}
                  onChange={(event) => model.setNewUserId(event.target.value)}
                  placeholder="ayse"
                  autoComplete="username"
                  disabled={model.userControlsDisabled}
                />
              </label>
              <button className="sk-btn" type="submit" disabled={model.addUserDisabled}>
                {model.addingUser ? "Ekleniyor..." : "Secime ekle"}
              </button>
            </div>
            {model.addUserMessage && <div className="sk-success">{model.addUserMessage}</div>}
          </form>

          <label className="sk-field sk-field-gap">
            <span>
              expectedText (min. {MIN_EXPECTED_WORD_COUNT} words, {MIN_EXPECTED_LENGTH}-
              {MAX_EXPECTED_LENGTH} chars, lower-case recommended)
            </span>
            <textarea
              className="sk-input-area"
              value={model.expectedText}
              onChange={(event) => model.setExpectedText(event.target.value)}
              rows={3}
              disabled={model.setupLocked}
            />
          </label>

          {model.activeTemplate && (
            <div className="sk-template-banner">
              <div>
                <span className="sk-template-label">Aktif dogrulama metni</span>
                <p className="sk-template-text">{model.activeTemplate.expectedText}</p>
              </div>
              <div className="sk-template-meta">
                <span>{model.activeTemplate.userId}</span>
                <span>{model.activeTemplate.textId}</span>
                {typeof model.activeTemplate.sampleCount === "number" && (
                  <span>{model.activeTemplate.sampleCount} ornek</span>
                )}
              </div>
            </div>
          )}

          <div className="sk-stage-stats">
            <span>word count (trimmed): {model.expectedWordCount}</span>
            <span>expected length (trimmed): {model.expectedLength}</span>
            <span>required: min {MIN_EXPECTED_WORD_COUNT} words</span>
            <span>
              enrollment progress: {model.enrollSamples.length}/{model.targetSamples}
            </span>
          </div>

          {model.expectedTextWasTrimmed && (
            <div className="sk-alert">
              Leading/trailing spaces are trimmed automatically before validation.
            </div>
          )}

          {model.expectedTextValidationMessage && (
            <div className="sk-alert">{model.expectedTextValidationMessage}</div>
          )}
        </section>

        <section className="sk-card sk-fixed-card">
          <div className="sk-card-head">
            <div>
              <h2>Enrollment ornekleri</h2>
              <p className="sk-section-note">
                Yanlis harfi Backspace ile silip devam et; metin bitince Space ile ornek eklenir.
              </p>
            </div>
            <span className="sk-pill">
              {model.enrollSamples.length}/{model.targetSamples}
            </span>
          </div>

          <div className="sk-tdna-panel">
            <p className="sk-tdna-title">Kayit turu</p>
            <p className="sk-hint">
              {model.setupLocked
                ? "Bu template kayitli. Farkli metin veya kullanici icin Yeni kayit baslat."
                : "Yanlis harf kirmizi gorunur; Backspace ile silip devam et."}
            </p>

            <div className="sk-tdna-preview" aria-live="polite">
              {model.enrollPreviewTokens.map((token) => (
                <span
                  className={`sk-tdna-char ${typingTokenClass(token.state)}`}
                  key={`enroll:${token.key}`}
                >
                  {token.char === " " ? "\u00A0" : token.char}
                </span>
              ))}
            </div>

            <div className="sk-tdna-input-shell">
              <input
                ref={model.enrollInputRef}
                className={`sk-tdna-input ${
                  model.enrollDraftHasError || model.enrollCapture.invalidReason
                    ? "sk-input-bad"
                    : model.enrollCapture.complete
                      ? "sk-input-ok"
                      : ""
                }`}
                placeholder="Type the fixed text from start"
                value={model.enrollTyped}
                onChange={(event) => {
                  model.setEnrollTyped(event.target.value);
                  if (model.enrollError) model.setEnrollError(null);
                }}
                onKeyDown={model.onEnrollKeyDown}
                onKeyUp={model.onEnrollKeyUp}
                onPaste={(event) => event.preventDefault()}
                disabled={model.setupLocked}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />

              <div className="sk-tdna-brand" aria-hidden="true">
                <div className="sk-tdna-bars">
                  {TYPING_DNA_BARS.map((height, index) => (
                    <span
                      key={`enroll-bar:${index}`}
                      style={{ height: `${Math.round(height * 100)}%` }}
                    />
                  ))}
                </div>
                <span>dna</span>
              </div>
            </div>
          </div>

          <div className="sk-stage-stats">
            <span>typed length: {model.enrollTyped.length}</span>
            <span>complete: {model.enrollCapture.complete ? "yes" : "no"}</span>
            <span>invalid: {model.enrollCapture.invalidReason ?? "-"}</span>
          </div>

          <div className="sk-actions">
            {model.setupLocked && (
              <button className="sk-btn sk-btn-primary" onClick={model.handleStartNewEnrollment}>
                Yeni kayit baslat
              </button>
            )}

            <button
              className="sk-btn"
              onClick={model.handleAddEnrollmentSample}
              disabled={
                model.setupLocked || model.enrollBusy !== "idle" || !model.enrollCapture.complete
              }
            >
              Add Sample
            </button>
            <button
              className="sk-btn"
              onClick={() => model.resetEnrollCapture()}
              disabled={model.setupLocked || model.enrollBusy !== "idle"}
            >
              Reset Round
            </button>
            <button
              className="sk-btn"
              onClick={() => {
                model.setEnrollSamples([]);
                model.setEnrollResult(null);
              }}
              disabled={model.setupLocked || model.enrollBusy !== "idle"}
            >
              Clear Collected Samples
            </button>
          </div>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={() => void model.handleEnrollSubmit()}
              disabled={
                model.setupLocked || model.enrollBusy !== "idle" || model.enrollSamples.length === 0
              }
            >
              {model.enrollBusy === "loading" ? "Working..." : "Submit Enrollment"}
            </button>
          </div>

          {model.enrollError && <div className="sk-alert">{model.enrollError}</div>}

          {model.enrollResult && (
            <details className="sk-json" open>
              <summary>Enrollment response</summary>
              <pre>{pretty(model.enrollResult)}</pre>
            </details>
          )}
        </section>

        <section className="sk-card sk-fixed-card">
          <div className="sk-card-head">
            <div>
              <h2>Dogrulama</h2>
              <p className="sk-section-note">
                Sadece kayitli template metniyle dogrulama yapilir.
              </p>
            </div>
            <span className={fixedDecisionClass(model.verifyResult?.decision ?? null)}>
              {model.verifyResult?.decision ?? "pending"}
            </span>
          </div>

          <label className="sk-check">
            <input
              type="checkbox"
              checked={model.autoEnroll}
              onChange={(event) => model.setAutoEnroll(event.target.checked)}
              disabled={!model.canVerifyKeystroke}
            />
            <span>autoEnroll on accept</span>
          </label>
          <p className="sk-hint">
            {model.canVerifyKeystroke
              ? "Yanlis harfi Backspace ile sil; metin tamamlaninca Space tusu ile dogrulama calisir."
              : "Bu kisi kayitli degilse once enrollment yapmasi gerekiyor."}
          </p>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={model.startVerificationRound}
              disabled={!model.canVerifyKeystroke || model.verifyBusy !== "idle"}
            >
              {model.verifyBusy === "loading" ? "Working..." : "Dogrulamayi baslat"}
            </button>
          </div>

          {!model.canVerifyKeystroke && (
            <div className="sk-alert sk-alert-neutral">
              {model.templateStatusDetail}
            </div>
          )}

          <div className="sk-tdna-panel">
            <p className="sk-tdna-title">Kayitli metni yaz</p>
            <div className="sk-tdna-preview" aria-live="polite">
              {model.verifyPreviewTokens.map((token) => (
                <span
                  className={`sk-tdna-char ${typingTokenClass(token.state)}`}
                  key={`verify:${token.key}`}
                >
                  {token.char === " " ? "\u00A0" : token.char}
                </span>
              ))}
            </div>

            <div className="sk-tdna-input-shell">
              <input
                ref={model.verifyInputRef}
                className={`sk-tdna-input ${
                  model.verifyDraftHasError || model.verifyCapture.invalidReason
                    ? "sk-input-bad"
                    : model.verifyCapture.complete
                      ? "sk-input-ok"
                      : ""
                }`}
                placeholder="your typing"
                value={model.verifyTyped}
                onChange={(event) => {
                  model.setVerifyTyped(event.target.value);
                  if (model.verifyError) model.setVerifyError(null);
                }}
                onKeyDown={model.onVerifyKeyDown}
                onKeyUp={model.onVerifyKeyUp}
                onPaste={(event) => event.preventDefault()}
                disabled={!model.canVerifyKeystroke}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />

              <div className="sk-tdna-brand" aria-hidden="true">
                <div className="sk-tdna-bars">
                  {TYPING_DNA_BARS.map((height, index) => (
                    <span
                      key={`verify-bar:${index}`}
                      style={{ height: `${Math.round(height * 100)}%` }}
                    />
                  ))}
                </div>
                <span>dna</span>
              </div>
            </div>
          </div>

          <div className="sk-stage-stats">
            <span>typed length: {model.verifyTyped.length}</span>
            <span>complete: {model.verifyCapture.complete ? "yes" : "no"}</span>
            <span>invalid: {model.verifyCapture.invalidReason ?? "-"}</span>
          </div>

          <div className="sk-actions">
            <button
              className="sk-btn sk-btn-primary"
              onClick={() => void model.handleVerifySubmit()}
              disabled={
                !model.canVerifyKeystroke ||
                model.verifyBusy !== "idle" ||
                !model.verifyCapture.complete
              }
            >
              {model.verifyBusy === "loading" ? "Working..." : "Next"}
            </button>
            <button
              className="sk-btn"
              onClick={() => model.resetVerifyCapture()}
              disabled={!model.canVerifyKeystroke || model.verifyBusy !== "idle"}
            >
              Reset Verification Round
            </button>
          </div>

          {model.verifyError && <div className="sk-alert">{model.verifyError}</div>}

          {model.verifyResult && (
            <>
              <div className="sk-verdict">
                <div className="sk-verdict-card">
                  <div className="sk-verdict-value">{model.verifyResult.score.toFixed(2)}</div>
                  <div className="sk-verdict-label">score</div>
                </div>
                <div className="sk-verdict-card">
                  <div className="sk-verdict-value">{model.verifyResult.dist.toFixed(3)}</div>
                  <div className="sk-verdict-label">distance</div>
                </div>
                <div className="sk-verdict-card sk-verdict-wide">
                  <div className="sk-verdict-label">reason</div>
                  <div className="sk-reasons">{model.verifyResult.reason ?? "-"}</div>
                </div>
              </div>

              <details className="sk-json" open>
                <summary>Verification response</summary>
                <pre>{pretty(model.verifyResult)}</pre>
              </details>
            </>
          )}
        </section>

        <section className="sk-card">
          <div className="sk-card-head">
            <h2>Latest Captured Sample</h2>
          </div>

          {model.lastSample ? (
            <details className="sk-json" open>
              <summary>Sample JSON</summary>
              <pre>{pretty(model.lastSample)}</pre>
            </details>
          ) : (
            <p className="sk-hint">No sample captured yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
