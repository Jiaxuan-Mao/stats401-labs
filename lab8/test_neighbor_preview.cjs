const test = require("node:test");
const assert = require("node:assert/strict");

const { neighborPreview } = require("./neighbor_preview.js");

test("neighborPreview keeps a short passage readable", () => {
    const text = "This is a short passage with enough context to understand the neighbor.";
    assert.equal(neighborPreview(text), text);
});

test("neighborPreview normalizes whitespace and shortens long passages at a word boundary", () => {
    const text = "This course introduces algorithms, data structures, and careful performance analysis.\n\n" +
        "Students compare multiple approaches and explain why one solution is more efficient than another. " +
        "Additional material continues well beyond the compact preview shown in the detail panel.";
    const preview = neighborPreview(text);

    assert.ok(preview.endsWith("…"));
    assert.ok(preview.length >= 120 && preview.length <= 160);
    assert.equal(preview.includes("\n"), false);
    assert.equal(preview.includes("  "), false);
    assert.match(preview, /\w…$/);
});
