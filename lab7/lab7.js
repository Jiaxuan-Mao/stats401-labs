// Lab 7 — temporal controls from Tasks 2–10, network logic from Parts A–D.
(function() {
    "use strict";
    const status = document.querySelector("#lab7-status");
    if (typeof d3 === "undefined") {
        status.textContent = "D3 could not load. Check your connection and reload.";
        return;
    }
    const parseDate = d3.timeParse("%Y-%m-%d");
    const formatDate = d3.timeFormat("%Y-%m-%d");
    const money = d3.format("$,.2f");
    const regions = ["Asia", "Europe", "North America"];
    const types = ["goods", "shipping", "components", "materials", "services"];
    const regionColor = d3.scaleOrdinal(regions, ["#ad4877", "#218779", "#547ec0"]);
    const typeColor = d3.scaleOrdinal(types, ["#a85b12", "#157e9b", "#7655a6", "#64772d", "#b84659"]);
    const tooltip = d3.select("#lab7-tooltip");
    function required(d, key) {
        if (d[key] === undefined || !d[key].trim()) throw new Error(`Missing ${key}.`);
        return d[key].trim();
    }
    function pairKey(d) { return [d.source, d.target].sort().join("-"); }

    // Task 2: CSV row conversion, timeParse, and explicit numeric conversion.
    Promise.all([
        d3.csv("../data/lab7_assignment_companies.csv", d => ({
            id: required(d, "id"), company_name: required(d, "company_name"),
            sector: required(d, "sector"), region: required(d, "region")
        })),
        d3.csv("../data/lab7_assignment_transactions_60days.csv", d => ({
            date: parseDate(required(d, "date")), dateText: required(d, "date"),
            day: +required(d, "day"), source: required(d, "source"), target: required(d, "target"),
            amount_usd: +required(d, "amount_usd"), transaction_type: required(d, "transaction_type"),
            transaction_count: +required(d, "transaction_count")
        }))
    ]).then(function([companies, transactions]) {
        validate(companies, transactions);
        draw(companies, transactions);
        status.textContent = `${companies.length} companies · ${transactions.length} daily relationship records · 60 days. Fabricated course data.`;
    }).catch(function(error) {
        status.textContent = "Could not load the network: " + error.message + " Open using Live Server or an HTTP server.";
        status.classList.add("error");
    });

    function validate(companies, transactions) {
        const ids = new Set(companies.map(d => d.id));
        if (companies.length !== 12 || ids.size !== 12) throw new Error("Expected 12 unique companies.");
        if (companies.some(d => !regions.includes(d.region))) throw new Error("Unknown company region.");
        const keys = new Set();
        transactions.forEach(function(d) {
            if (!d.date || formatDate(d.date) !== d.dateText || !Number.isInteger(d.day) || d.day < 1 || d.day > 60 ||
                +d.date !== +d3.timeDay.offset(parseDate("2026-01-01"), d.day - 1)) throw new Error("Invalid date/day.");
            if (!ids.has(d.source) || !ids.has(d.target) || d.source === d.target) throw new Error("Invalid link endpoints.");
            if (!Number.isFinite(d.amount_usd) || d.amount_usd <= 0 || !Number.isInteger(d.transaction_count) ||
                d.transaction_count <= 0 || !types.includes(d.transaction_type)) throw new Error("Invalid transaction value/type/count.");
            const key = `${d.day}-${pairKey(d)}`;
            if (keys.has(key)) throw new Error("Repeated undirected company pair on one day.");
            keys.add(key);
        });
        if (new Set(transactions.map(d => d.day)).size !== 60) throw new Error("Missing days in the transaction data.");
    }

    // Part B: exactly the filter + d3.sum logic from the assignment.
    // Raw transactions retain string IDs; only copies are passed to forceLink.
    function calculateVolume(companyId, currentLinks) {
        return d3.sum(currentLinks.filter(d => d.source === companyId || d.target === companyId), d => d.amount_usd);
    }

    function draw(companies, transactions) {
        const width = 960, height = 580;
        let currentDay = 1, timer = null;
        const daily = d3.range(1, 61).map(function(day) {
            const rows = transactions.filter(d => d.day === day);
            return { day, date: rows[0].date, links: rows.length,
                active: companies.filter(d => calculateVolume(d.id, rows) > 0).length,
                total: d3.sum(rows, d => d.amount_usd),
                cross: rows.filter(d => companies.find(n => n.id === d.source).region !==
                    companies.find(n => n.id === d.target).region).length,
                maxVolume: d3.max(companies, d => calculateVolume(d.id, rows)) };
        });
        // One shared domain over all 60 days makes sizes comparable over time.
        // The minimum radius keeps zero-volume companies visible; area is not strictly proportional.
        const sizeScale = d3.scaleSqrt().domain([0, d3.max(daily, d => d.maxVolume)]).range([7, 30]);
        const widthScale = d3.scaleLinear().domain([0, d3.max(transactions, d => d.amount_usd)]).range([1, 7]);
        const svg = d3.select("#network").append("svg").attr("width", width).attr("height", height)
            .attr("viewBox", `0 0 ${width} ${height}`).attr("role", "group")
            .attr("aria-label", "Commercial network on the selected day");
        svg.append("title").text("Undirected commercial network — positions are simulated, not geographic");
        const linkGroup = svg.append("g");
        const hitGroup = svg.append("g");
        const node = svg.append("g").selectAll("circle").data(companies, d => d.id).join("circle")
            .attr("class", "lab7-node").attr("data-id", d => d.id).attr("r", 7)
            .attr("fill", d => regionColor(d.region)).attr("stroke", "#fff").attr("stroke-width", 2)
            .attr("tabindex", 0).attr("role", "img");
        const label = svg.append("g").attr("class", "lab7-labels").selectAll("text")
            .data(companies, d => d.id).join("text").attr("text-anchor", "middle");
        label.append("tspan").attr("x", 0).text(d => `${d.id} · ${d.company_name.split(" ")[0]}`);
        label.append("tspan").attr("x", 0).attr("dy", 15).text(d => d.company_name.split(" ").slice(1).join(" "));

        // Parts A/D: create ONE simulation and retain the SAME 12 node objects.
        const simulation = d3.forceSimulation(companies).randomSource(d3.randomLcg(401))
            .force("link", d3.forceLink().id(d => d.id).distance(155).strength(0.1))
            .force("charge", d3.forceManyBody().strength(-430))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collision", d3.forceCollide(66));
        // Settle an overview layout once, then use these positions as gentle anchors.
        const allPairs = Array.from(d3.group(transactions, pairKey).values(), rows => ({
            source: rows[0].source, target: rows[0].target
        }));
        simulation.force("link").links(allPairs);
        simulation.stop();
        for (let i = 0; i < 220; i++) { simulation.tick(); keepInBounds(); }
        companies.forEach(d => { d.homeX = d.x; d.homeY = d.y; });
        simulation.force("x", d3.forceX(d => d.homeX).strength(0.18))
            .force("y", d3.forceY(d => d.homeY).strength(0.18)).on("tick", tick);
        function keepInBounds() {
            companies.forEach(d => { d.x = Math.max(75, Math.min(width - 75, d.x)); d.y = Math.max(45, Math.min(height - 80, d.y)); });
        }
        function tick() {
            keepInBounds();
            // Include fading-out links, so their endpoints follow the same nodes.
            [linkGroup, hitGroup].forEach(group => group.selectAll("line")
                .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y));
            node.attr("cx", d => d.x).attr("cy", d => d.y);
            label.attr("transform", d => `translate(${d.x},${d.y + 43})`);
        }

        // Tasks 3/11: a static line overview supports comparison across distant days.
        const overview = d3.select("#overview").append("svg").attr("width", 960).attr("height", 175)
            .attr("viewBox", "0 0 960 175").attr("role", "img").attr("aria-label", "Active relationships across all 60 days");
        const x = d3.scaleTime().domain(d3.extent(daily, d => d.date)).range([55, 930]);
        const y = d3.scaleLinear().domain([0, d3.max(daily, d => d.links)]).nice().range([130, 25]);
        overview.append("g").attr("transform", "translate(0,130)").call(d3.axisBottom(x).ticks(7).tickFormat(d3.timeFormat("%b %d")));
        overview.append("g").attr("transform", "translate(55,0)").call(d3.axisLeft(y).ticks(5));
        overview.append("text").attr("x", 55).attr("y", 15).text("Active relationships");
        overview.append("path").datum(daily).attr("fill", "none").attr("stroke", "#a33b6c").attr("stroke-width", 2)
            .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.links)));
        const cursor = overview.append("line").attr("y1", 25).attr("y2", 130).attr("stroke", "#48414a").attr("stroke-dasharray", "4,4");
        const marker = overview.append("circle").attr("r", 5).attr("fill", "#a33b6c");

        // Tasks 9/10: show one frame; synchronize marks, date, and slider.
        function showDay(day) {
            currentDay = day;
            hideTooltip();
            const currentLinks = transactions.filter(d => d.day === day);
            const frame = daily[day - 1];
            companies.forEach(function(d) {
                d.volume = calculateVolume(d.id, currentLinks);
                d.degree = currentLinks.filter(link => link.source === d.id || link.target === d.id).length;
            });
            // forceLink mutates endpoints to objects: copy rows AFTER calculating raw-ID statistics.
            const forceLinks = currentLinks.map(d => ({ ...d, key: pairKey(d) }));
            simulation.force("link").links(forceLinks);
            // Part C: keyed enter/update/exit preserves existing relationships and fades changes.
            linkGroup.selectAll("line").interrupt();
            const link = linkGroup.selectAll("line").data(forceLinks, d => d.key).join(
                enter => enter.append("line").attr("class", "lab7-link").attr("opacity", 0),
                update => update,
                exit => exit.attr("class", "lab7-link-exit").transition().duration(350).attr("opacity", 0).remove()
            ).attr("class", "lab7-link").attr("data-key", d => d.key)
                .attr("stroke", d => typeColor(d.transaction_type));
            link.transition().duration(350).attr("opacity", 0.75).attr("stroke-width", d => widthScale(d.amount_usd));
            const hit = hitGroup.selectAll("line").data(forceLinks, d => d.key).join("line")
                .attr("class", "lab7-link-hit").attr("stroke", "transparent").attr("stroke-width", 16)
                .attr("tabindex", 0).attr("role", "img").attr("aria-label", linkDescription);
            bindTooltip(hit, linkDescription);
            node.interrupt().transition().duration(350).attr("r", d => sizeScale(d.volume));
            node.attr("aria-label", nodeDescription);
            d3.select("#current-date").text(`Day ${day} / 60 — ${formatDate(frame.date)}`);
            d3.select("#time-slider").property("value", day).attr("aria-valuetext", `Day ${day}, ${formatDate(frame.date)}`);
            d3.select("#daily-summary").text(`${frame.active} active companies · ${frame.links} active relationships · ${money(frame.total)} total value · ${frame.cross}/${frame.links} cross-region links`);
            cursor.attr("x1", x(frame.date)).attr("x2", x(frame.date));
            marker.attr("cx", x(frame.date)).attr("cy", y(frame.links));
            tick();
            simulation.alpha(0.12).restart();
        }
        function play() {
            if (timer || currentDay === 60) return;
            d3.select("#play-state").text("Playing — one day per second");
            timer = d3.interval(function() {
                showDay(currentDay + 1);
                if (currentDay === 60) pause();
            }, 1000);
        }
        function pause() {
            if (timer) { timer.stop(); timer = null; }
            d3.select("#play-state").text(currentDay === 60 ? "Finished — Reset or move the slider to replay" : "Paused");
        }
        function reset() { pause(); showDay(1); pause(); }
        d3.select("#play").on("click", play);
        d3.select("#pause").on("click", pause);
        d3.select("#reset").on("click", reset);
        d3.select("#time-slider").on("input", function() { pause(); showDay(+this.value); pause(); });
        window.addEventListener("pagehide", () => { pause(); simulation.stop(); });

        // Hover/focus/tap details; date changes dismiss stale tooltip values.
        function nodeDescription(d) {
            return `${d.id} · ${d.company_name}\n${d.sector} · ${d.region}\nDay ${currentDay}: ${money(d.volume)} incident transaction value\n${d.degree} current neighbors`;
        }
        function linkDescription(d) {
            return `${d.source.company_name} ↔ ${d.target.company_name}\n${formatDate(d.date)} · ${d.transaction_type}\n${money(d.amount_usd)} · ${d.transaction_count} transactions`;
        }
        function bindTooltip(selection, description) {
            selection.on("mouseenter focus click", function(event, d) {
                tooltip.text(description(d)).attr("hidden", null);
                moveTooltip(event);
            }).on("mousemove", moveTooltip).on("mouseleave blur", hideTooltip)
                .on("keydown", function(event) { if (event.key === "Escape") hideTooltip(); });
        }
        bindTooltip(node, nodeDescription);
        d3.selectAll(".lab7-scroll").on("scroll", hideTooltip);
        drawLegends(sizeScale, widthScale);
        showDay(1);
        d3.selectAll("#play, #pause, #reset, #time-slider").property("disabled", false);
    }

    function drawLegends(sizeScale, widthScale) {
        function key(container, values, color, shape) {
            const item = d3.select(container).selectAll("span").data(values).join("span").attr("class", "lab7-key-item");
            const mark = item.append("svg").attr("width", 36).attr("height", 22);
            if (shape === "circle") mark.append("circle").attr("cx", 16).attr("cy", 11).attr("r", 8).attr("fill", color);
            else mark.append("line").attr("x1", 2).attr("x2", 32).attr("y1", 11).attr("y2", 11).attr("stroke-width", 4).attr("stroke", color).attr("opacity", 0.75);
            item.append("span").text(d => d);
        }
        key("#region-key", regions, regionColor, "circle");
        key("#type-key", types, typeColor, "line");
        const size = d3.select("#size-key").append("svg").attr("width", 310).attr("height", 85);
        [0, 30000, 60000].forEach((value, i) => {
            size.append("circle").attr("cx", 47 + i * 103).attr("cy", 30).attr("r", sizeScale(value)).attr("fill", "#aaa");
            size.append("text").attr("x", 47 + i * 103).attr("y", 76).attr("text-anchor", "middle").text(d3.format("$,.0f")(value));
        });
        const widths = d3.select("#width-key").append("svg").attr("width", 310).attr("height", 85);
        [10000, 20000, 30000].forEach((value, i) => {
            widths.append("line").attr("x1", 16 + i * 103).attr("x2", 76 + i * 103).attr("y1", 30).attr("y2", 30)
                .attr("stroke", "#666").attr("stroke-width", widthScale(value)).attr("opacity", 0.75);
            widths.append("text").attr("x", 47 + i * 103).attr("y", 76).attr("text-anchor", "middle").text(d3.format("$,.0f")(value));
        });
    }
    function moveTooltip(event) {
        const box = event.currentTarget.getBoundingClientRect();
        const x = event.clientX === undefined ? box.left + box.width / 2 : event.clientX;
        const y = event.clientY === undefined ? box.top + box.height / 2 : event.clientY;
        const tip = tooltip.node().getBoundingClientRect();
        tooltip.style("left", `${Math.max(8, Math.min(innerWidth - tip.width - 8, x + 12))}px`)
            .style("top", `${Math.max(8, Math.min(innerHeight - tip.height - 8, y + 12))}px`);
    }
    function hideTooltip() { tooltip.attr("hidden", true); }
})();
