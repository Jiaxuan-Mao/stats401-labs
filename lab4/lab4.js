// Lab 4: airline sentiment comparison.

const sentimentKeys = ["Negative", "Neutral", "Positive"];
const sentimentColors = new Map([
    ["Negative", "#ad2854"],
    ["Neutral", "#71808f"],
    ["Positive", "#16866f"]
]);

const chartStatus = d3.select("#chart-status");
const tooltip = d3.select("#lab4-tooltip");

Promise.all([
    d3.csv("../data/lab4_sentiment_by_airline.csv", function(d) {
        return {
            airline: d.airline,
            total: +d.total,
            negative_count: +d.negative_count,
            neutral_count: +d.neutral_count,
            positive_count: +d.positive_count,
            Negative: +d.negative_pct,
            Neutral: +d.neutral_pct,
            Positive: +d.positive_pct,
            average_score: +d.average_score
        };
    }),
    d3.json("../data/lab4_cleaning_report.json")
]).then(function([data, report]) {
    if (!data.length) {
        throw new Error("The airline summary contains no rows.");
    }

    d3.select("#raw-count").text(report.raw_rows.toLocaleString("en-US"));
    d3.select("#clean-count").text(report.clean_rows.toLocaleString("en-US"));
    d3.select("#airline-count").text(data.length);

    drawLegend();
    drawChart(data);
    drawTable(data);

    chartStatus.text(
        `${report.clean_rows.toLocaleString("en-US")} cleaned tweets loaded; ` +
        `${report.duplicate_ids_removed.toLocaleString("en-US")} duplicate tweet IDs removed.`
    );
}).catch(function(error) {
    console.error("Could not load the Lab 4 results:", error);
    chartStatus
        .classed("error", true)
        .text(
            "Could not load the cleaned data. Open this page with Live Server or " +
            "another local HTTP server and confirm that the generated CSV files exist."
        );
});

function drawLegend() {
    const items = d3.select(".lab4-legend")
        .selectAll("span")
        .data(sentimentKeys)
        .join("span");

    items.append("span")
        .attr("class", "lab4-legend-swatch")
        .style("background-color", d => sentimentColors.get(d));

    items.append("span").text(d => d);
}

function drawChart(data) {
    const width = 920;
    const height = 430;
    const margin = { top: 24, right: 28, bottom: 58, left: 136 };

    const svg = d3.select("#lab4-chart")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr(
            "aria-label",
            "One hundred percent stacked bar chart comparing estimated tweet " +
            "sentiment across six airlines."
        );

    svg.append("title")
        .text("RoBERTa-estimated tweet sentiment by airline");

    const x = d3.scaleLinear()
        .domain([0, 100])
        .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.airline))
        .range([margin.top, height - margin.bottom])
        .padding(0.28);

    const layers = d3.stack()
        .keys(sentimentKeys)(data);

    svg.append("g")
        .attr("class", "lab4-grid")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .call(
            d3.axisBottom(x)
                .tickValues([0, 25, 50, 75, 100])
                .tickSize(-(height - margin.top - margin.bottom))
                .tickFormat(d => `${d}%`)
        )
        .call(g => g.select(".domain").remove());

    svg.append("g")
        .attr("class", "lab4-y-axis")
        .attr("transform", `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(y).tickSize(0))
        .call(g => g.select(".domain").remove());

    svg.selectAll("g.lab4-layer")
        .data(layers)
        .join("g")
        .attr("class", "lab4-layer")
        .attr("fill", layer => sentimentColors.get(layer.key))
        .selectAll("rect")
        .data(layer => layer.map(segment => ({ ...segment, key: layer.key })))
        .join("rect")
        .attr("x", d => x(d[0]))
        .attr("y", d => y(d.data.airline))
        .attr("width", d => Math.max(0, x(d[1]) - x(d[0])))
        .attr("height", y.bandwidth())
        .attr("tabindex", 0)
        .attr("aria-label", function(d) {
            const count = d.data[`${d.key.toLowerCase()}_count`];
            return `${d.data.airline}: ${d.key}, ${d.data[d.key].toFixed(1)}%, ` +
                `${count.toLocaleString("en-US")} tweets.`;
        })
        .on("mouseenter focus", showTooltip)
        .on("mousemove", moveTooltip)
        .on("mouseleave blur", hideTooltip);

    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", (margin.left + width - margin.right) / 2)
        .attr("y", height - 12)
        .attr("text-anchor", "middle")
        .text("Share of each airline's cleaned tweets");

    function showTooltip(event, d) {
        const count = d.data[`${d.key.toLowerCase()}_count`];
        tooltip
            .style("opacity", 1)
            .html(
                `<strong>${d.data.airline}</strong><br>` +
                `${d.key}: ${d.data[d.key].toFixed(1)}%<br>` +
                `${count.toLocaleString("en-US")} of ` +
                `${d.data.total.toLocaleString("en-US")} tweets`
            );
        moveTooltip(event);
    }

    function moveTooltip(event) {
        if (event.type === "focus") {
            const bounds = event.currentTarget.getBoundingClientRect();
            tooltip
                .style("left", `${bounds.left + window.scrollX + bounds.width / 2}px`)
                .style("top", `${bounds.top + window.scrollY - 12}px`);
            return;
        }

        tooltip
            .style("left", `${event.pageX + 14}px`)
            .style("top", `${event.pageY + 14}px`);
    }

    function hideTooltip() {
        tooltip.style("opacity", 0);
    }
}

function drawTable(data) {
    d3.select("#lab4-table tbody")
        .selectAll("tr")
        .data(data)
        .join("tr")
        .html(function(d) {
            return `
                <th scope="row">${d.airline}</th>
                <td>${d.Negative.toFixed(1)}%</td>
                <td>${d.Neutral.toFixed(1)}%</td>
                <td>${d.Positive.toFixed(1)}%</td>
                <td>${d.total.toLocaleString("en-US")}</td>
            `;
        });
}
