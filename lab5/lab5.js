// Lab 5: the same undirected transit network in two D3 views.
// Task 1 — load both external tables, preserving IDs as strings.
(function() {
    "use strict";
    const status = document.querySelector("#lab5-status");
    if (typeof d3 === "undefined") {
        status.textContent = "D3 could not load. Check your connection and reload the page.";
        status.classList.add("error");
        return;
    }
    const districts = ["Central", "North", "South", "East", "West"];
    const stationTypes = ["Local", "Transfer", "Terminal"];
    const routeTypes = ["Metro", "Express", "Shuttle"];

    function required(row, key) {
        if (row[key] === undefined || row[key].trim() === "") {
            throw new Error(`Missing required value: ${key}.`);
        }
        return row[key].trim();
    }

    Promise.all([
        d3.csv("../data/lab5_assignment_stations.csv", function(d) {
            return {
                id: required(d, "id"), station_name: required(d, "station_name"),
                district: required(d, "district"),
                daily_passengers: +required(d, "daily_passengers"),
                station_type: required(d, "station_type")
            };
        }),
        d3.csv("../data/lab5_assignment_routes.csv", function(d) {
            return {
                source: required(d, "source"), target: required(d, "target"),
                travel_time_min: +required(d, "travel_time_min"),
                route_type: required(d, "route_type")
            };
        })
    ]).then(function([nodes, routes]) {
        validateData(nodes, routes);
        drawNetwork(nodes, routes);
        status.textContent = `${nodes.length} stations and ${routes.length} undirected routes loaded. ` +
            "Required fields, numeric values, unique IDs, and route endpoints checked.";
    }).catch(function(error) {
        status.classList.add("error");
        status.textContent = "Could not load the assignment network: " + error.message +
            " Supply data/lab5_assignment_stations.csv and data/lab5_assignment_routes.csv, " +
            "then open this page through Live Server or a local HTTP server.";
    });

    function pairKey(a, b) { return JSON.stringify([a, b].sort()); }

    function validateData(nodes, routes) {
        if (nodes.length !== 50 || routes.length !== 50) {
            throw new Error(`Expected 50 stations / 50 routes; found ${nodes.length} / ${routes.length}.`);
        }
        const ids = new Set();
        nodes.forEach(function(d) {
            if (ids.has(d.id)) throw new Error(`Duplicate station ID: ${d.id}.`);
            ids.add(d.id);
            if (!districts.includes(d.district) || !stationTypes.includes(d.station_type)) {
                throw new Error(`Unknown district or station type at ${d.id}.`);
            }
            if (!Number.isFinite(d.daily_passengers) || d.daily_passengers < 0) {
                throw new Error(`Invalid passenger count at ${d.id}.`);
            }
        });
        const pairs = new Set();
        routes.forEach(function(d) {
            if (!ids.has(d.source) || !ids.has(d.target)) throw new Error("A route references an unknown station.");
            if (d.source === d.target) throw new Error("Self-links need a separate display; check the source data.");
            const key = pairKey(d.source, d.target);
            if (pairs.has(key)) throw new Error("Repeated station pair: inspect parallel routes before combining them.");
            pairs.add(key);
            if (!Number.isFinite(d.travel_time_min) || d.travel_time_min <= 0 || !routeTypes.includes(d.route_type)) {
                throw new Error(`Invalid travel time or route type: ${d.source}–${d.target}.`);
            }
        });
    }

    function drawNetwork(nodes, links) {
        const width = 960, height = 660;

        // Tasks 7–10 — categorical scales and quantitative visual channels.
        const districtColor = d3.scaleOrdinal(districts,
            ["#9c3568", "#247ca5", "#56823b", "#a6611a", "#6d56a3"]);
        const routeColor = d3.scaleOrdinal(routeTypes, ["#176789", "#a54e13", "#7053a1"]);
        const routeDash = d3.scaleOrdinal(routeTypes, [null, "10,5", "2,5"]);
        const shape = d3.scaleOrdinal(stationTypes, [d3.symbolCircle, d3.symbolDiamond, d3.symbolSquare]);
        // symbol.size is AREA (px²), not radius. A visible minimum preserves small stations.
        const area = d3.scaleLinear().domain(d3.extent(nodes, d => d.daily_passengers)).range([100, 700]);
        const timeExtent = d3.extent(links, d => d.travel_time_min);
        const lineWidth = d3.scaleLinear().domain(timeExtent).range([1.5, 6]);
        const cellOpacity = d3.scaleLinear().domain(timeExtent).range([0.35, 1]);
        const symbol = d3.symbol().type(d => shape(d.station_type)).size(d => area(d.daily_passengers));
        const radius = d => Math.sqrt(area(d.daily_passengers)) * 0.95 + 6;
        const numericIdOrder = (a, b) => a.id.localeCompare(b.id, "en", { numeric: true });
        const tooltip = d3.select("#lab5-tooltip");

        // Tasks 2, 4, 5, 11 — SVG layers: routes, stations, then labels.
        const svg = d3.select("#chart").append("svg").attr("viewBox", `0 0 ${width} ${height}`)
            .attr("width", width).attr("height", height).attr("role", "group")
            .attr("aria-label", "Interactive undirected station network");
        svg.append("title").text("Urban transit network — simulated positions");
        const link = svg.append("g").selectAll("line").data(links).join("line")
            .attr("class", "lab5-route").attr("stroke", "#626872")
            .attr("stroke-width", d => lineWidth(d.travel_time_min))
            .attr("stroke-dasharray", d => routeDash(d.route_type)).attr("opacity", 0.7);
        const linkHit = svg.append("g").selectAll("line").data(links).join("line")
            .attr("class", "lab5-route-hit").attr("stroke", "transparent").attr("stroke-width", 16)
            .attr("tabindex", 0).attr("role", "img");
        const node = svg.append("g").selectAll("path").data(nodes, d => d.id).join("path")
            .attr("class", "lab5-node").attr("data-id", d => d.id).attr("d", symbol)
            .attr("fill", d => districtColor(d.district)).attr("stroke", "#fff").attr("stroke-width", 1.5)
            .attr("tabindex", 0).attr("role", "img");
        const label = svg.append("g").attr("class", "lab5-labels").selectAll("text")
            .data(nodes, d => d.id).join("text").attr("text-anchor", "middle").text(d => d.id);

        // Tasks 3, 6 — the simulation calculates coordinates; tick renders them.
        const simulation = d3.forceSimulation(nodes).randomSource(d3.randomLcg(401))
            .force("link", d3.forceLink(links).id(d => d.id).distance(95))
            .force("charge", d3.forceManyBody().strength(-160))
            .force("center", d3.forceCenter(width / 2, height / 2))
            // Gentle positional forces keep long, sparse chains inside the canvas.
            // These positions do not encode district, distance, or travel time.
            .force("x", d3.forceX(width / 2).strength(0.035))
            .force("y", d3.forceY(height / 2).strength(0.035))
            .force("collision", d3.forceCollide().radius(d => radius(d) + 10))
            .on("tick", tick);
        // forceLink has now replaced source/target IDs with node objects.
        linkHit.attr("aria-label", routeDescription);
        node.attr("aria-label", stationDescription);
        function keepNodesInBounds() {
            nodes.forEach(function(d) {
                const r = radius(d) + 12;
                d.x = Math.max(r, Math.min(width - r, d.x));
                d.y = Math.max(r, Math.min(height - r - 18, d.y));
            });
        }
        function tick() {
            keepNodesInBounds();
            [link, linkHit].forEach(selection => selection
                .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y));
            node.attr("transform", d => `translate(${d.x},${d.y})`);
            label.attr("x", d => d.x).attr("y", d => d.y + radius(d) + 5);
        }
        tick();

        // Task 12 — drag fixes a node temporarily, then releases it.
        node.call(d3.drag().on("start", function(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        }).on("drag", function(event, d) {
            const r = radius(d) + 12;
            d.fx = Math.max(r, Math.min(width - r, event.x));
            d.fy = Math.max(r, Math.min(height - r - 18, event.y));
            d.x = d.fx; d.y = d.fy;
            tick();
        }).on("end", function(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
        }));

        // Task 16 — check both directions for every row/column pair.
        const matrixSize = 900, left = 85, top = 90;
        const matrixSvg = d3.select("#matrix").append("svg")
            .attr("width", 1020).attr("height", 1020).attr("viewBox", "0 0 1020 1020")
            .attr("role", "group").attr("aria-label", "Symmetric station adjacency matrix");
        matrixSvg.append("title").text("Direct station connections, ordered by district");
        const matrixGroup = matrixSvg.append("g").attr("transform", `translate(${left},${top})`);
        const matrixData = [];
        nodes.forEach(function(row) {
            nodes.forEach(function(col) {
                const route = links.find(link =>
                    (link.source.id === row.id && link.target.id === col.id) ||
                    (link.source.id === col.id && link.target.id === row.id));
                matrixData.push({ row, col, route: route || null });
            });
        });
        const sorted = nodes.slice().sort((a, b) =>
            districts.indexOf(a.district) - districts.indexOf(b.district) || numericIdOrder(a, b));
        const band = d3.scaleBand().domain(sorted.map(d => d.id)).range([0, matrixSize]).padding(0.06);
        const cells = matrixGroup.append("g").selectAll("rect").data(matrixData).join("rect")
            .attr("class", "lab5-cell")
            .attr("data-row", d => d.row.id).attr("data-col", d => d.col.id)
            .attr("fill", d => d.route ? routeColor(d.route.route_type) : d.row.id === d.col.id ? "#d6d5db" : "#f0eff2")
            .attr("fill-opacity", d => d.route ? cellOpacity(d.route.travel_time_min) : 1)
            .attr("tabindex", d => d.route ? 0 : null).attr("role", d => d.route ? "img" : null)
            .attr("aria-label", d => d.route ? routeDescription(d.route) : null);
        const rowLabels = matrixGroup.append("g").selectAll("text").data(nodes).join("text")
            .attr("class", "lab5-matrix-label").attr("x", -10).attr("text-anchor", "end")
            .attr("fill", d => districtColor(d.district)).text(d => d.id);
        const colLabels = matrixGroup.append("g").selectAll("text").data(nodes).join("text")
            .attr("class", "lab5-matrix-label").attr("fill", d => districtColor(d.district))
            .attr("text-anchor", "start").text(d => d.id);
        const boundaries = matrixGroup.append("g").attr("class", "lab5-boundaries");
        cells.attr("x", d => band(d.col.id)).attr("y", d => band(d.row.id))
            .attr("width", band.bandwidth()).attr("height", band.bandwidth());
        rowLabels.attr("y", d => band(d.id) + band.bandwidth() / 2 + 4);
        colLabels.attr("transform", d => `translate(${band(d.id) + band.bandwidth() / 2},-10) rotate(-90)`);
        districts.forEach(function(district) {
            const members = sorted.filter(d => d.district === district);
            if (!members.length) return;
            const start = band(members[0].id), end = band(members[members.length - 1].id) + band.bandwidth();
            boundaries.append("text").attr("x", (start + end) / 2).attr("y", -53)
                .attr("text-anchor", "middle").text(district);
            boundaries.append("text").attr("transform", `translate(-53,${(start + end) / 2}) rotate(-90)`)
                .attr("text-anchor", "middle").text(district);
            if (start > band.step()) {
                boundaries.append("line").attr("x1", start - 1).attr("x2", start - 1).attr("y2", matrixSize);
                boundaries.append("line").attr("y1", start - 1).attr("y2", start - 1).attr("x2", matrixSize);
            }
        });

        // Tasks 13–14 — inspect neighbors and show exact values in a tooltip.
        function isConnected(a, b) {
            return a.id === b.id || links.some(link =>
                (link.source.id === a.id && link.target.id === b.id) ||
                (link.source.id === b.id && link.target.id === a.id));
        }
        function stationDescription(d) {
            const degree = links.filter(link => link.source.id === d.id || link.target.id === d.id).length;
            return `${d.id}: ${d.station_name} | ${d.district} | ${d.station_type} | ` +
                `${d.daily_passengers.toLocaleString("en-US")} passengers/day | ${degree} direct neighbors`;
        }
        function routeDescription(d) {
            const a = d.source, b = d.target;
            return `${a.id}: ${a.station_name} ↔ ${b.id}: ${b.station_name} | ${d.route_type} | ${d.travel_time_min} min`;
        }
        function highlightStation(d) {
            node.attr("opacity", other => isConnected(d, other) ? 1 : 0.15);
            label.attr("opacity", other => isConnected(d, other) ? 1 : 0.15);
            link.attr("opacity", other => other.source.id === d.id || other.target.id === d.id ? 0.9 : 0.1);
        }
        function showDetail(event, text) {
            tooltip.text(text).attr("hidden", null);
            moveTooltip(event);
        }
        function moveTooltip(event) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = event.clientX || bounds.left + bounds.width / 2;
            const y = event.clientY || bounds.top + bounds.height / 2;
            const tip = tooltip.node().getBoundingClientRect();
            tooltip.style("left", `${Math.max(8, Math.min(window.innerWidth - tip.width - 8, x + 14))}px`)
                .style("top", `${Math.max(8, Math.min(window.innerHeight - tip.height - 8, y + 14))}px`);
        }
        function restore() {
            tooltip.attr("hidden", true);
            node.attr("opacity", 1);
            label.attr("opacity", 1);
            link.attr("opacity", 0.7);
        }
        node.on("mouseenter focus click", function(event, d) { highlightStation(d); showDetail(event, stationDescription(d)); })
            .on("mousemove", moveTooltip).on("mouseleave blur", restore);
        linkHit.on("mouseenter focus click", function(event, d) {
            node.attr("opacity", other => other === d.source || other === d.target ? 1 : 0.15);
            label.attr("opacity", other => other === d.source || other === d.target ? 1 : 0.15);
            link.attr("opacity", other => other === d ? 0.9 : 0.1);
            showDetail(event, routeDescription(d));
        }).on("mousemove", moveTooltip).on("mouseleave blur", restore);
        cells.on("mouseenter focus click", function(event, d) {
            d3.select(this).attr("stroke", "#20202b").attr("stroke-width", 2);
            showDetail(event, d.route ? routeDescription(d.route) :
                `${d.row.id} ↔ ${d.col.id}: ${d.row.id === d.col.id ? "same station" : "no direct connection"}`);
        }).on("mousemove", moveTooltip).on("mouseleave blur", function() {
            d3.select(this).attr("stroke", null);
            tooltip.attr("hidden", true);
        });

        // Shared, data-derived legends explain the minimum/maximum size and time.
        function legendGroup(container, title) {
            const group = d3.select(container).append("div").attr("class", "lab5-legend-group");
            group.append("strong").text(title);
            return group;
        }
        function item(group, text, draw) {
            const row = group.append("span").attr("class", "lab5-legend-item");
            draw(row.append("svg").attr("width", 64).attr("height", 48).attr("aria-hidden", true));
            row.append("span").text(text);
        }
        const districtLegend = legendGroup("#lab5-node-legend", "District → color (also matrix labels)");
        districts.forEach(d => item(districtLegend, d, s => s.append("circle").attr("cx", 28).attr("cy", 24).attr("r", 8).attr("fill", districtColor(d))));
        const typeLegend = legendGroup("#lab5-node-legend", "Station type → shape");
        stationTypes.forEach(d => item(typeLegend, d, s => s.append("path").attr("transform", "translate(28,24)").attr("d", d3.symbol().type(shape(d)).size(200)()).attr("fill", "#6b6670")));
        const sizeLegend = legendGroup("#lab5-node-legend", "Passengers/day → symbol area");
        [...new Set(d3.extent(nodes, d => d.daily_passengers))].forEach(d => item(sizeLegend, d.toLocaleString("en-US"), s => s.append("path").attr("transform", "translate(28,24)").attr("d", d3.symbol().size(area(d))()).attr("fill", "#6b6670")));
        const routeLegend = legendGroup("#lab5-node-legend", "Service → line pattern");
        routeTypes.forEach(d => item(routeLegend, d, s => s.append("line").attr("x1", 6).attr("x2", 58).attr("y1", 24).attr("y2", 24).attr("stroke", "#626872").attr("stroke-width", 3).attr("stroke-dasharray", routeDash(d))));
        const timeLegend = legendGroup("#lab5-node-legend", "Travel time → width (thicker = longer)");
        [...new Set(timeExtent)].forEach(d => item(timeLegend, `${d} min`, s => s.append("line").attr("x1", 6).attr("x2", 58).attr("y1", 24).attr("y2", 24).attr("stroke", "#626872").attr("stroke-width", lineWidth(d))));
        const matrixLegend = legendGroup("#lab5-matrix-legend", "Service → cell color; higher opacity = longer trip");
        routeTypes.forEach(d => item(matrixLegend, d, s => s.append("rect").attr("x", 18).attr("y", 14).attr("width", 20).attr("height", 20).attr("fill", routeColor(d))));
        const opacityLegend = legendGroup("#lab5-matrix-legend", "Travel time → cell opacity");
        [...new Set(timeExtent)].forEach(d => item(opacityLegend, `${d} min`, function(s) {
            routeTypes.forEach((routeType, i) => s.append("rect").attr("x", i * 22).attr("y", 14)
                .attr("width", 20).attr("height", 20).attr("fill", routeColor(routeType)).attr("fill-opacity", cellOpacity(d)));
        }));
        restore();
    }
})();
