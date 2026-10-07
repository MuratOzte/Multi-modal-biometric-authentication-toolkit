import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixedTextKeystrokeRecorder } from "../keystroke/recorder";

function mockNowSequence(values: number[]): void {
  let index = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  });
}

describe("createFixedTextKeystrokeRecorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds hold/dd/ud vectors deterministically for matching fixed text", () => {
    mockNowSequence([0, 10, 90, 130, 220, 270, 335]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("ab ");

    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });
    recorder.keydown({ key: " " });
    recorder.keyup({ key: " " });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.isComplete()).toBe(true);

    expect(recorder.getSample("fixed-v1")).toEqual({
      textId: "fixed-v1",
      text: "ab ",
      holdMs: [80, 90, 65],
      ddMs: [120, 140],
      udMs: [40, 50],
      meta: {
        timestamp: 1_700_000_000_010,
        durationMs: 325,
      },
    });
  });

  it("marks sample invalid when a control key is pressed", () => {
    mockNowSequence([0, 10]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("abc");
    recorder.keydown({ key: "Shift" });

    expect(recorder.isInvalid()).toBe(true);
    expect(recorder.getInvalidReason()).toBe("modifier_or_control_key");
    expect(recorder.getSample("fixed-v1")).toBeNull();
  });

  it("keeps unrecovered mismatches incomplete without invalidating the recorder", () => {
    mockNowSequence([0, 12, 80, 120]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("abc");
    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "x" });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.getInvalidReason()).toBeNull();
    expect(recorder.isComplete()).toBe(false);
    expect(recorder.getSample("fixed-v1")).toBeNull();
  });

  it("allows a mismatched character to be removed with Backspace and records corrections", () => {
    mockNowSequence([0, 10, 90, 120, 130, 220, 270, 335, 380]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("abc");

    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "x" });
    recorder.keyup({ key: "x" });
    recorder.keydown({ key: "Backspace" });
    recorder.keyup({ key: "Backspace" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });
    recorder.keydown({ key: "c" });
    recorder.keyup({ key: "c" });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.isComplete()).toBe(true);
    expect(recorder.getSample("fixed-v1")).toEqual({
      textId: "fixed-v1",
      text: "abc",
      holdMs: [80, 50, 45],
      ddMs: [210, 115],
      udMs: [130, 65],
      meta: {
        timestamp: 1_700_000_000_010,
        durationMs: 370,
      },
      corrections: {
        events: [
          {
            type: "mismatch",
            t: 120,
            index: 1,
            key: "x",
            expected: "b",
          },
          {
            type: "backspace",
            t: 130,
            index: 1,
            removed: "x",
          },
        ],
        mismatchCount: 1,
        extraCount: 0,
        backspaceCount: 1,
      },
    });
  });

  it("keeps extra input incomplete until it is removed", () => {
    mockNowSequence([0, 10, 80, 140, 200, 260, 320]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("ab");
    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });
    recorder.keydown({ key: "x" });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.isComplete()).toBe(false);
    expect(recorder.getSample("fixed-v1")).toBeNull();

    recorder.keydown({ key: "Backspace" });
    recorder.keyup({ key: "Backspace" });

    expect(recorder.isComplete()).toBe(true);
    expect(recorder.getSample("fixed-v1")?.corrections).toEqual({
      events: [
        {
          type: "extra",
          t: 260,
          index: 2,
          key: "x",
        },
        {
          type: "backspace",
          t: 320,
          index: 2,
          removed: "x",
        },
      ],
      mismatchCount: 0,
      extraCount: 1,
      backspaceCount: 1,
    });
  });

  it("uses the final retyped timing after a correct character is deleted", () => {
    mockNowSequence([0, 10, 90, 120, 180, 260, 330, 400]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("ab");
    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });

    expect(recorder.isComplete()).toBe(true);

    recorder.keydown({ key: "Backspace" });
    recorder.keyup({ key: "Backspace" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });

    expect(recorder.getSample("fixed-v1")).toEqual({
      textId: "fixed-v1",
      text: "ab",
      holdMs: [80, 70],
      ddMs: [320],
      udMs: [240],
      meta: {
        timestamp: 1_700_000_000_010,
        durationMs: 390,
      },
      corrections: {
        events: [
          {
            type: "backspace",
            t: 260,
            index: 1,
            removed: "b",
          },
        ],
        mismatchCount: 0,
        extraCount: 0,
        backspaceCount: 1,
      },
    });
  });

  it("keeps repeated keydown events unrecoverably invalid", () => {
    mockNowSequence([0, 10]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("abc");
    recorder.keydown({ key: "a", repeat: true });

    expect(recorder.isInvalid()).toBe(true);
    expect(recorder.getInvalidReason()).toBe("key_repeat");
    expect(recorder.getSample("fixed-v1")).toBeNull();
  });

  it("ignores stray keyup events instead of invalidating capture", () => {
    mockNowSequence([0, 12, 80, 120, 200, 260]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("ab");

    recorder.keyup({ key: "a" });
    recorder.keyup({ key: "Shift" });

    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.isComplete()).toBe(true);
  });

  it("reset clears invalid state and allows a fresh sample", () => {
    mockNowSequence([0, 10, 12, 20, 70, 100, 160]);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const recorder = createFixedTextKeystrokeRecorder("ab");
    recorder.keydown({ key: "Shift" });
    expect(recorder.isInvalid()).toBe(true);

    recorder.reset();
    recorder.keydown({ key: "a" });
    recorder.keyup({ key: "a" });
    recorder.keydown({ key: "b" });
    recorder.keyup({ key: "b" });

    expect(recorder.isInvalid()).toBe(false);
    expect(recorder.isComplete()).toBe(true);
    expect(recorder.getSample("fixed-v1")).not.toBeNull();
  });
});
