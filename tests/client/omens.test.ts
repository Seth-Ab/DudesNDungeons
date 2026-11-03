import { describe, expect, it } from "vitest";
import { NO_OMENS_TEXT, omenLines, omenMark } from "../../src/client/state/omens.js";

describe("omen marks", () => {
  it("tells a warning from an anomaly by shape and word, not only by colour", () => {
    const warning = omenMark("warning");
    const anomaly = omenMark("anomaly");

    expect(warning.shape).not.toBe(anomaly.shape);
    expect(warning.glyph).not.toBe(anomaly.glyph);
    expect(warning.word).toBe("Warning");
    expect(anomaly.word).toBe("Anomaly");
  });
});

describe("omen lines", () => {
  it("is empty until the hub has sent the next run, and when the run has no omens", () => {
    expect(omenLines(null)).toEqual([]);
    expect(omenLines({ omens: [] })).toEqual([]);
    expect(NO_OMENS_TEXT).toBe("No omens");
  });

  it("keeps the server's order and speaks the type, name and line", () => {
    const lines = omenLines({
      omens: [
        { id: "a", name: "Short Fuse", type: "warning", description: "Resistance falls sooner." },
        { id: "b", name: "Echoing Halls", type: "anomaly", description: "Sound carries." },
      ],
    });

    expect(lines.map((line) => line.id)).toEqual(["a", "b"]);
    expect(lines[0]?.label).toBe("Warning: Short Fuse. Resistance falls sooner.");
    expect(lines[1]?.mark.shape).toBe("diamond");
  });
});
