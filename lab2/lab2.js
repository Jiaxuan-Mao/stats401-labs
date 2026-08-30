// ----------------------------------------
// Lab 2: Multivariate Visualization with D3
// ----------------------------------------

// ----------------------------------------
// Task 1: Load and Process the Data
// ----------------------------------------

d3.csv("../data/cities_multivariate.csv", function(d) {

    return {
        city: d.city,
        population: +d.population,
        temp_c: +d.temp_c,
        development_level: d.development_level,
        region: d.region
    };

}).then(function(data) {

    console.log("City data:", data);


    // ----------------------------------------
    // Chart Settings
    // ----------------------------------------

    const width = 800;
    const height = 500;

    const margin = {
        top: 50,
        right: 180,
        bottom: 80,
        left: 70
    };


    // ----------------------------------------
    // Create SVG
    // ----------------------------------------

    const svg = d3.select("#chart")
        .append("svg")
        .attr("width", width)
        .attr("height", height);


    // ----------------------------------------
    // Create Scales
    // ----------------------------------------

    // Region is categorical, so use a band scale.
    const regions = ["North", "South", "East", "West"];

    const xScale = d3.scaleBand()
        .domain(regions)
        .range([
            margin.left,
            width - margin.right
        ])
        .padding(0.5);


    // Temperature is numerical, so use a linear scale.
    // The Y-axis starts at 0°C.
    const yScale = d3.scaleLinear()
        .domain([
            0,
            d3.max(data, d => d.temp_c)
        ])
        .nice()
        .range([
            height - margin.bottom,
            margin.top
        ]);


    // ----------------------------------------
    // Development Level Color Scale
    // ----------------------------------------

    // Development level is ordered:
    // Low → Medium → High
    // Use a light-to-dark pink color scheme.
    const developmentLevels = [
        "Low",
        "Medium",
        "High"
    ];

    const colorScale = d3.scaleOrdinal()
        .domain(developmentLevels)
        .range([
            "#f7d6e5",   // Low
            "#e76f9a",   // Medium
            "#a91d55"    // High
        ]);


    // ----------------------------------------
    // Population Size Scale
    // ----------------------------------------

    const sizeScale = d3.scaleSqrt()
        .domain(d3.extent(data, d => d.population))
        .range([8, 28]);


    // ----------------------------------------
    // Create X Axis
    // ----------------------------------------

    svg.append("g")
        .attr(
            "transform",
            `translate(0, ${height - margin.bottom})`
        )
        .call(d3.axisBottom(xScale))
        .selectAll("text")
        .style("font-size", "15px")
        .style("font-weight", "bold");


    // ----------------------------------------
    // Create Y Axis
    // ----------------------------------------

    const yAxis = svg.append("g")
    .attr(
        "transform",
        `translate(${margin.left}, 0)`
    )
    .call(
        d3.axisLeft(yScale)
            .tickValues(
                d3.range(
                    0,
                    d3.max(data, d => d.temp_c) + 5,
                    5
                )
            )
    );

yAxis.selectAll("text")
    .style("font-size", "15px")
    .style("font-weight", "bold");


    // ----------------------------------------
    // Axis Labels
    // ----------------------------------------

    // X-axis label is centered relative to the actual plotting area.
    svg.append("text")
        .attr("class", "axis-label")
        .attr(
            "x",
            (margin.left + (width - margin.right)) / 2
        )
        .attr("y", height - 30)
        .attr("text-anchor", "middle")
        .text("Region");


    // Y-axis label
    svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", 20)
        .attr("text-anchor", "middle")
        .text("Average Temperature (°C)");


    // ----------------------------------------
    // Chart Title
    // ----------------------------------------

    svg.append("text")
        .attr("class", "chart-title")
        .attr("x", margin.left)
        .attr("y", 13)
        .attr("text-anchor", "start")
        .text("City Population, Temperature, Development, and Region");


    // ----------------------------------------
    // Tooltip
    // ----------------------------------------

    const tooltip = d3.select("#tooltip");


    // ----------------------------------------
    // Draw City Circles
    // ----------------------------------------

    svg.selectAll(".city-point")
        .data(data)
        .join("circle")
        .attr("class", "city-point")
        .attr(
            "cx",
            d => xScale(d.region) + xScale.bandwidth() / 2
        )
        .attr(
            "cy",
            d => yScale(d.temp_c)
        )
        .attr(
            "r",
            d => sizeScale(d.population)
        )
        .attr(
            "fill",
            d => colorScale(d.development_level)
        )
        .attr("opacity", 0.8)

        // Mouse enters the circle
        .on("mouseover", function(event, d) {

            d3.select(this)
                .attr("opacity", 1)
                .attr("stroke", "#222")
                .attr("stroke-width", 2);

            tooltip
                .style("opacity", 1)
                .html(`
                    <strong>${d.city}</strong><br>
                    Population: ${d.population} million<br>
                    Temperature: ${d.temp_c} °C<br>
                    Development: ${d.development_level}<br>
                    Region: ${d.region}
                `);
        })

        // Mouse moves
        .on("mousemove", function(event) {

            tooltip
                .style(
                    "left",
                    `${event.pageX + 12}px`
                )
                .style(
                    "top",
                    `${event.pageY + 12}px`
                );
        })

        // Mouse leaves the circle
        .on("mouseout", function() {

            d3.select(this)
                .attr("opacity", 0.8)
                .attr("stroke", "none");

            tooltip
                .style("opacity", 0);
        });


    // ----------------------------------------
    // Add City Labels
    // ----------------------------------------

    svg.selectAll(".city-label")
        .data(data)
        .join("text")
        .attr("class", "city-label")
        .attr(
            "x",
            d => xScale(d.region) + xScale.bandwidth() / 2
        )
        .attr(
            "y",
            d => yScale(d.temp_c) - sizeScale(d.population) - 7
        )
        .attr("text-anchor", "middle")
        .text(d => d.city);


    // ----------------------------------------
    // Development Level Legend
    // ----------------------------------------

    const legend = svg.append("g")
        .attr(
            "transform",
            `translate(${width - margin.right + 20}, 70)`
        );


    legend.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -15)
        .text("Development Level");


    const legendItems = legend
        .selectAll(".legend-item")
        .data(developmentLevels)
        .join("g")
        .attr("class", "legend-item")
        .attr(
            "transform",
            (d, i) => `translate(0, ${i * 30})`
        );


    // Use the same colors and opacity as the city circles.
    legendItems.append("circle")
        .attr("cx", 15)
        .attr("cy", 0)
        .attr("r", 7)
        .attr(
            "fill",
            d => colorScale(d)
        )
        .attr("opacity", 0.8);


    legendItems.append("text")
        .attr("x", 35)
        .attr("y", 0)
        .attr("dominant-baseline", "middle")
        .text(d => d);


    // ----------------------------------------
    // Population Legend
    // ----------------------------------------

    const sizeLegend = svg.append("g")
        .attr(
            "transform",
            `translate(${width - margin.right + 20}, 210)`
        );


    sizeLegend.append("text")
        .attr("class", "legend-title")
        .attr("x", 0)
        .attr("y", -25)
        .text("Population");


    const populationValues = [0.5, 1.5, 3.2];


    // Calculate spacing based on the largest legend circle
    // so items don't overlap.
    const maxPopRadius = sizeScale(d3.max(populationValues));
    const popSpacing = maxPopRadius * 2 + 10;


    const populationItems = sizeLegend
        .selectAll(".population-item")
        .data(populationValues)
        .join("g")
        .attr("class", "population-item")
        .attr(
            "transform",
            (d, i) => `translate(15, ${i * popSpacing})`
        );


    populationItems.append("circle")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr(
            "r",
            d => sizeScale(d)
        )
        .attr("fill", "none")
        .attr("stroke", "#555");


    populationItems.append("text")
        .attr("x", 35)
        .attr("y", 0)
        .attr("dominant-baseline", "middle")
        .text(d => `${d} million`);


}).catch(function(error) {

    console.error("Error loading city data:", error);

});