(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.Lab8NeighborPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function neighborPreview(text, maxLength = 150) {
        const clean = String(text).replace(/\s+/g, " ").trim();
        if (clean.length <= maxLength) return clean;

        const candidate = clean.slice(0, maxLength - 1);
        const lastSpace = candidate.lastIndexOf(" ");
        const cutAt = lastSpace >= 120 ? lastSpace : candidate.length;
        return `${candidate.slice(0, cutAt).replace(/[^\p{L}\p{N}]+$/u, "")}…`;
    }

    return { neighborPreview };
});
