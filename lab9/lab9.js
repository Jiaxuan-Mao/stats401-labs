(function() {
    "use strict";

    const status = document.querySelector("#lab9-status");
    if (typeof d3 === "undefined") {
        status.textContent = "D3 could not load. Check your connection and reload.";
        status.classList.add("error");
        return;
    }

    const tooltip = d3.select("#lab9-tooltip");
    const money = d3.format("$,.1f");
    const width = 960;
    const height = 540;
    let selectedIso = null;

    Promise.all([
        d3.json("../data/world_countries_50m.geojson"),
        d3.csv("../data/lab9_gdp_2025_top50.csv", function(d) {
            return {
                iso3: d.iso3.trim(),
                country: d.country.trim(),
                gdp: +d.gdp_2025_billion_usd,
                rank: +d.rank
            };
        })
    ]).then(function([geoData, gdpData]) {
        validate(geoData, gdpData);

        const gdpByIso = new Map(gdpData.map(d => [d.iso3, d]));
        geoData.features.forEach(function(feature) {
            feature.properties.iso3 = feature.properties.ISO_A3_EH;
            feature.properties.gdp = gdpByIso.get(feature.properties.iso3) || null;
        });

        const projection = d3.geoNaturalEarth1()
            .fitExtent([[18, 18], [width - 18, height - 18]], geoData);
        const path = d3.geoPath().projection(projection);
        const colorScale = d3.scaleSequentialLog()
            .interpolator(d3.interpolatePuRd)
            .domain(d3.extent(gdpData, d => d.gdp));

        drawChoropleth(geoData, path, colorScale);
        drawColorLegend(colorScale, gdpData);
        drawCartogram(geoData, gdpData, projection, colorScale);
        status.textContent = `${gdpData.length} GDP records joined to ${geoData.features.length} country boundaries. All 50 ISO-3 identifiers matched.`;
    }).catch(function(error) {
        status.textContent = "Could not load Lab 9: " + error.message + " Open this page using Live Server or another HTTP server.";
        status.classList.add("error");
    });

    function validate(geoData, gdpData) {
        if (!geoData || !Array.isArray(geoData.features)) {
            throw new Error("Invalid GeoJSON.");
        }
        const ids = new Set(gdpData.map(d => d.iso3));
        if (gdpData.length !== 50 || ids.size !== 50) {
            throw new Error("Expected 50 unique GDP records.");
        }
        if (gdpData.some(d => !d.iso3 || !d.country || !Number.isFinite(d.gdp) || d.gdp <= 0 || !Number.isInteger(d.rank))) {
            throw new Error("Invalid GDP values.");
        }
        const boundaryIds = new Set(geoData.features.map(d => d.properties.ISO_A3_EH));
        const unmatched = gdpData.filter(d => !boundaryIds.has(d.iso3));
        if (unmatched.length) {
            throw new Error("Unmatched ISO-3 identifiers: " + unmatched.map(d => d.iso3).join(", "));
        }
    }

    function drawChoropleth(geoData, path, colorScale) {
        const svg = d3.select("#choropleth").append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "group")
            .attr("aria-label", "Choropleth map showing 2025 nominal GDP by country color");

        svg.append("path")
            .datum({ type: "Sphere" })
            .attr("d", path)
            .attr("fill", "#f4f7f8")
            .attr("stroke", "#bdc8cc");

        const mapGroup = svg.append("g");
        const countries = mapGroup.selectAll("path")
            .data(geoData.features)
            .join("path")
            .attr("class", "lab9-country")
            .attr("data-iso", d => d.properties.iso3)
            .attr("d", path)
            .attr("fill", d => d.properties.gdp ? colorScale(d.properties.gdp.gdp) : "#dedade")
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 0.7)
            .attr("tabindex", 0)
            .attr("role", "img")
            .attr("aria-label", d => tooltipText(d.properties.gdp, d.properties.NAME_EN || d.properties.ADMIN));

        addInspection(countries, d => d.properties.iso3, d => d.properties.gdp,
            d => d.properties.NAME_EN || d.properties.ADMIN);

        svg.call(d3.zoom()
            .scaleExtent([1, 8])
            .on("zoom", function(event) {
                mapGroup.attr("transform", event.transform);
            }));
    }

    function drawColorLegend(colorScale, gdpData) {
        const legendWidth = 390;
        const legendHeight = 55;
        const barWidth = 250;
        const barStart = 30;
        const extent = d3.extent(gdpData, d => d.gdp);
        const legendScale = d3.scaleLog().domain(extent).range([barStart, barStart + barWidth]);
        const svg = d3.select("#choropleth-legend").append("svg")
            .attr("width", legendWidth)
            .attr("height", legendHeight)
            .attr("viewBox", `0 0 ${legendWidth} ${legendHeight}`)
            .attr("role", "img")
            .attr("aria-label", "GDP color legend from 300 billion to 30.6 trillion U.S. dollars");

        svg.selectAll("rect.scale")
            .data(d3.range(barWidth))
            .join("rect")
            .attr("class", "scale")
            .attr("x", d => d + barStart)
            .attr("y", 4)
            .attr("width", 1)
            .attr("height", 12)
            .attr("fill", d => colorScale(legendScale.invert(d)));
        svg.append("g")
            .attr("transform", "translate(0,16)")
            .call(d3.axisBottom(legendScale).tickValues([300, 1000, 10000, 30000])
                .tickFormat(d => d < 1000 ? `$${d}B` : `$${d / 1000}T`));
        svg.append("rect").attr("x", 310).attr("y", 4).attr("width", 14).attr("height", 12).attr("fill", "#dedade");
        svg.append("text").attr("x", 330).attr("y", 15).attr("font-size", 12).text("No data");
    }

    function drawCartogram(geoData, gdpData, projection, colorScale) {
        const featureByIso = new Map(geoData.features.map(d => [d.properties.iso3, d]));
        const radius = d3.scaleSqrt()
            .domain([0, d3.max(gdpData, d => d.gdp)])
            .range([0, 72]);
        const nodes = gdpData.map(function(d) {
            const feature = featureByIso.get(d.iso3);
            const anchor = projection(d3.geoCentroid(feature));
            return { ...d, x: anchor[0], y: anchor[1], anchorX: anchor[0], anchorY: anchor[1], r: radius(d.gdp) };
        });

        const simulation = d3.forceSimulation(nodes)
            .randomSource(d3.randomLcg(401))
            .force("x", d3.forceX(d => d.anchorX).strength(0.32))
            .force("y", d3.forceY(d => d.anchorY).strength(0.32))
            .force("collide", d3.forceCollide(d => d.r + 2).iterations(3))
            .stop();
        for (let i = 0; i < 400; i++) simulation.tick();
        nodes.forEach(function(d) {
            d.x = Math.max(d.r + 5, Math.min(width - d.r - 5, d.x));
            d.y = Math.max(d.r + 5, Math.min(height - d.r - 5, d.y));
        });

        const svg = d3.select("#cartogram").append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .attr("role", "group")
            .attr("aria-label", "Dorling cartogram with circle area proportional to 2025 nominal GDP");

        const circles = svg.append("g").selectAll("circle")
            .data(nodes, d => d.iso3)
            .join("circle")
            .attr("class", "lab9-cartogram")
            .attr("data-iso", d => d.iso3)
            .attr("cx", d => d.x)
            .attr("cy", d => d.y)
            .attr("r", d => d.r)
            .attr("fill", d => colorScale(d.gdp))
            .attr("stroke", "#ffffff")
            .attr("stroke-width", 1.5)
            .attr("tabindex", 0)
            .attr("role", "img")
            .attr("aria-label", d => tooltipText(d, d.country));

        addInspection(circles, d => d.iso3, d => d, d => d.country);

        svg.append("g").selectAll("text")
            .data(nodes.filter(d => d.rank <= 10), d => d.iso3)
            .join("text")
            .attr("class", "lab9-label")
            .attr("x", d => d.x)
            .attr("y", d => d.y + 4)
            .attr("fill", d => d.rank <= 2 ? "#ffffff" : "#231c22")
            .text(d => d.iso3);
    }

    function addInspection(selection, iso, datum, fallbackName) {
        selection
            .on("mouseenter focus", function(event, d) {
                highlight(iso(d));
                showTooltip(event, datum(d), fallbackName(d));
            })
            .on("mousemove", moveTooltip)
            .on("mouseleave blur", function() {
                if (selectedIso) highlight(selectedIso); else clearHighlight();
                hideTooltip();
            })
            .on("click", function(event, d) {
                event.stopPropagation();
                selectedIso = selectedIso === iso(d) ? null : iso(d);
                if (selectedIso) highlight(selectedIso); else clearHighlight();
                showTooltip(event, datum(d), fallbackName(d));
            });
    }

    function highlight(iso3) {
        d3.selectAll("[data-iso]")
            .classed("is-highlighted", function() { return this.dataset.iso === iso3; })
            .classed("is-dimmed", function() { return this.dataset.iso !== iso3; });
    }

    function clearHighlight() {
        d3.selectAll("[data-iso]").classed("is-highlighted", false).classed("is-dimmed", false);
    }

    function tooltipText(d, fallbackName) {
        if (!d) return `${fallbackName}: No data in the provided top-50 dataset`;
        return `${d.country}: ${money(d.gdp)} billion USD, rank ${d.rank}`;
    }

    function showTooltip(event, d, fallbackName) {
        tooltip.html(d
            ? `<strong>${d.country}</strong><br>GDP: ${money(d.gdp)} billion USD<br>Rank: ${d.rank}`
            : `<strong>${fallbackName}</strong><br>No data in the provided top-50 dataset`)
            .attr("hidden", null);
        moveTooltip(event);
    }

    function moveTooltip(event) {
        const x = event.pageX || window.scrollX + 24;
        const y = event.pageY || window.scrollY + 24;
        tooltip.style("left", `${x + 12}px`).style("top", `${y + 12}px`);
    }

    function hideTooltip() {
        tooltip.attr("hidden", true);
    }
})();
