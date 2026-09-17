// Lab 6 — same GDP hierarchy, two different treemap segmentation methods.
(function() {
    "use strict";
    const status = document.querySelector("#lab6-status");
    if (typeof d3 === "undefined") {
        status.textContent = "D3 could not load. Check your connection and reload.";
        status.classList.add("error");
        return;
    }

    // Task 12 adapted: status uses color; geography uses nesting and headings.
    const statuses = ["Increase", "Unchanged", "Decrease"];
    const color = d3.scaleOrdinal().domain(statuses)
        .range(["#70b8ac", "#d6d7dc", "#e3a0b6"]);
    const format = d3.format(",.0f");
    const tooltip = d3.select("#lab6-tooltip");

    // Task 3 — load the JSON produced by convert_hierarchy.py.
    d3.json("../data/lab6_assignment_gdp.json").then(function(data) {
        validateHierarchy(data);
        drawLegend();
        // Task 15 — change only the tiling algorithm between the two views.
        drawTreemap(data, "#treemap-squarify", d3.treemapSquarify, "Squarify");
        drawTreemap(data, "#treemap-slicedice", d3.treemapSliceDice, "SliceDice");
        const root = d3.hierarchy(data).sum(d => d.gdp || 0);
        status.textContent = `${root.leaves().length} countries loaded; total GDP of listed countries: ` +
            `${format(root.value)} billion USD.`;
    }).catch(function(error) {
        d3.selectAll(".lab6-chart svg").remove();
        status.classList.add("error");
        status.textContent = "Could not load the GDP hierarchy: " + error.message +
            " Run convert_hierarchy.py and open this page using Live Server or a local HTTP server.";
    });

    function validateHierarchy(data) {
        const root = d3.hierarchy(data);
        if (data.name !== "World" || !root.children || root.height !== 3) {
            throw new Error("Expected World → Continent → Area → Country.");
        }
        root.each(function(d) {
            if (typeof d.data.name !== "string" || !d.data.name.trim()) {
                throw new Error("A hierarchy node is missing its name.");
            }
            if (d.children) {
                if (new Set(d.children.map(child => child.data.name)).size !== d.children.length ||
                    d.data.gdp !== undefined) {
                    throw new Error("Repeated sibling names or GDP stored on a parent node.");
                }
            } else if (d.depth !== 3 || typeof d.data.gdp !== "number" ||
                !Number.isFinite(d.data.gdp) || d.data.gdp <= 0 || !statuses.includes(d.data.status)) {
                throw new Error("Invalid country depth, GDP, or status.");
            }
        });
    }

    function drawLegend() {
        const legend = d3.selectAll(".lab6-legend");
        legend.append("span").text("Area: GDP (billion USD)");
        legend.append("strong").text("GDP status → color");
        const items = legend.selectAll(".lab6-legend-item").data(statuses)
            .join("span").attr("class", "lab6-legend-item");
        items.append("span").attr("class", "lab6-swatch").style("background", d => color(d));
        items.append("span").text(d => d);
    }

    function drawTreemap(data, container, tile, name) {
        const width = 1000, height = 800, labelMargin = 155;
        // Tasks 4–5, 10 — independent hierarchy; GDP lives only on country leaves.
        const root = d3.hierarchy(data).sum(d => d.gdp || 0)
            .sort((a, b) => b.value - a.value);
        const layout = d3.treemap().tile(tile).size([width, height])
            .paddingInner(1).paddingOuter(0.5)
            // Narrow groups need a taller header for a rotated name.
            // Cap header space so small groups always retain country rectangles.
            .paddingTop(d => d.depth === 0 ? 0.5 : headerHeight(d));
        layout(root);

        const svg = d3.select(container).append("svg")
            .attr("viewBox", `0 0 ${width + labelMargin} ${height}`)
            .attr("width", width + labelMargin).attr("height", height).attr("role", "group")
            .attr("aria-label", `${name} GDP treemap: continent, area, country`);
        svg.append("title").text(`${name} — GDP by continent, area and country`);

        // Parent rectangles are drawn first, so they cannot cover country marks.
        const groups = svg.selectAll(".lab6-group")
            .data(root.descendants().filter(d => d.depth === 1 || d.depth === 2))
            .join("g").attr("class", "lab6-group")
            .attr("transform", d => `translate(${d.x0},${d.y0})`);
        groups.append("rect")
            .attr("width", d => d.x1 - d.x0).attr("height", d => d.y1 - d.y0)
            .attr("fill", d => d.depth === 1 ? "#ece8eb" : "#faf7f9")
            .attr("stroke", d => d.depth === 1 ? "#645e64" : "#aaa3a9");
        groups.append("title").text(d => `${d.ancestors().reverse().map(n => n.data.name).join(" → ")}: ${format(d.value)} billion USD`);
        groups.each(function(d) {
            drawLabel(d3.select(this), d.data.name, null,
                d.x1 - d.x0, headerHeight(d), "lab6-heading", shortName(d.data.name));
        });

        // Task 11 — each leaf is one country. Positions come from the layout.
        const cells = svg.selectAll(".lab6-cell").data(root.leaves()).join("g")
            .attr("class", "lab6-cell").attr("data-country", d => d.data.name)
            .attr("transform", d => `translate(${d.x0},${d.y0})`)
            .attr("tabindex", 0).attr("role", "img")
            .attr("aria-label", description);
        cells.append("rect").attr("width", d => d.x1 - d.x0)
            .attr("height", d => d.y1 - d.y0)
            .attr("fill", d => color(d.data.status));
        const outsideLabels = [];
        cells.each(function(d) {
            const fits = drawLabel(d3.select(this), d.data.name, format(d.value),
                d.x1 - d.x0, d.y1 - d.y0, "lab6-country-label", shortName(d.data.name));
            if (!fits) outsideLabels.push(d);
        });

        // Keep very thin country marks unchanged; name them in the right margin.
        outsideLabels.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
        let lastY = 0;
        const callouts = svg.selectAll(".lab6-callout").data(outsideLabels).join("g")
            .attr("class", "lab6-callout").attr("tabindex", 0).attr("role", "img")
            .attr("aria-label", description);
        callouts.each(function(d, i) {
            const centerY = (d.y0 + d.y1) / 2;
            const y = Math.max(lastY + 22, Math.min(centerY, height - 12 - (outsideLabels.length - 1 - i) * 22));
            lastY = y;
            const group = d3.select(this);
            group.append("path").attr("d", `M${(d.x0 + d.x1) / 2},${centerY}H${width + 5}V${y}H${width + 10}`)
                .attr("fill", "none").attr("stroke", "#514b50").attr("stroke-width", 0.8).attr("pointer-events", "none");
            group.append("text").attr("x", width + 13).attr("y", y).attr("dy", "0.32em")
                .attr("font-size", 12).attr("fill", "#27212c").text(d.data.name);
        });

        // Task 13 — hover, keyboard focus, or tap reveals the full country path.
        svg.selectAll(".lab6-cell, .lab6-callout").on("mouseenter focus click", function(event, d) {
            tooltip.text(description(d)).attr("hidden", null);
            moveTooltip(event);
        }).on("mousemove", moveTooltip)
            .on("mouseleave blur", hideTooltip)
            .on("keydown", function(event) { if (event.key === "Escape") hideTooltip(); });
        d3.select(container).on("scroll", hideTooltip);
    }

    function headerHeight(d) {
        const w = d.x1 - d.x0, h = d.y1 - d.y0;
        if (h < 32) return 0.5;
        return Math.min(w < 70 ? shortName(d.data.name).length * 6 + 10 : 26, h * 0.4);
    }

    function shortName(name) {
        const names = {
            "United States": "USA", "United Kingdom": "UK", "New Zealand": "NZ",
            "South Korea": "S. Korea", "South Africa": "S. Africa",
            "North America": "N. America", "South America": "S. America",
            "Australia and New Zealand": "Australia / NZ"
        };
        return names[name] || name.replace("Northern ", "N. ").replace("Southern ", "S. ")
            .replace("Western ", "W. ").replace("Eastern ", "E. ")
            .replace("North ", "N. ").replace("South ", "S. ")
            .replace("West ", "W. ").replace("East ", "E. ");
    }

    // Task 11 label refinement: tspans wrap words; SVG rotation fits narrow strips.
    // Try full names before display abbreviations, without enlarging any data mark.
    function drawLabel(group, name, value, width, height, className, abbreviation) {
        const text = group.append("text").attr("class", className)
            .attr("text-anchor", "middle").style("font-weight", "bold");
        const variants = value ? [[name, value], [name], [abbreviation]] : [[name], [abbreviation]];
        for (const parts of variants) {
            for (const rotate of [false, true]) {
                const availableWidth = (rotate ? height : width) - 2;
                const availableHeight = (rotate ? width : height) - 2;
                for (const size of [12, 11, 10]) {
                    text.style("font-size", `${size}px`).attr("transform", null).text("");
                    const lines = [];
                    let fits = true;
                    for (const part of parts) {
                        let line = "";
                        for (const word of part.split(/\s+/)) {
                            const candidate = line ? `${line} ${word}` : word;
                            text.text(candidate);
                            if (text.node().getComputedTextLength() > availableWidth) {
                                if (line) lines.push(line);
                                text.text(word);
                                if (text.node().getComputedTextLength() > availableWidth) { fits = false; break; }
                                line = word;
                            } else line = candidate;
                        }
                        if (!fits) break;
                        if (line) lines.push(line);
                    }
                    if (!fits || lines.length * (size + 2) > availableHeight) continue;
                    text.text("").attr("transform", `translate(${width / 2},${height / 2})${rotate ? " rotate(-90)" : ""}`);
                    lines.forEach((line, i) => text.append("tspan").attr("x", 0)
                        .attr("y", (i - (lines.length - 1) / 2) * (size + 2) + size * 0.32).text(line));
                    return true;
                }
            }
        }
        text.remove();
        return false;
    }

    function description(d) {
        return `${d.data.name}\nContinent: ${d.parent.parent.data.name}\n` +
            `Area: ${d.parent.data.name}\nGDP: ${format(d.value)} billion USD\n` +
            `GDP status: ${d.data.status}`;
    }

    function moveTooltip(event) {
        const box = event.currentTarget.getBoundingClientRect();
        const x = event.clientX === undefined ? box.left + box.width / 2 : event.clientX;
        const y = event.clientY === undefined ? box.top + box.height / 2 : event.clientY;
        const tip = tooltip.node().getBoundingClientRect();
        tooltip.style("left", `${Math.max(8, Math.min(window.innerWidth - tip.width - 8, x + 12))}px`)
            .style("top", `${Math.max(8, Math.min(window.innerHeight - tip.height - 8, y + 12))}px`);
    }

    function hideTooltip() { tooltip.attr("hidden", true); }
})();
