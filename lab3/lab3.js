// ----------------------------------------
// Lab 3: Web Data Acquisition with D3
// ----------------------------------------

// ----------------------------------------
// Task 1: Load and Process the Data
// ----------------------------------------

d3.csv("../data/lab3_data.csv?v=tvmaze", function(d) {

    if (!d.name || !d.show_url) {
        throw new Error("Expected the TVmaze dataset. Run api_example.py first.");
    }

    return {
        id: +d.id,
        name: d.name,
        type: d.type,
        language: d.language,
        genres: d.genres,
        status: d.status,
        premiered: d.premiered,
        runtime_minutes: d.runtime_minutes === "" ? null : +d.runtime_minutes,
        rating: d.rating === "" ? null : +d.rating,
        network: d.network,
        country: d.country,
        show_url: d.show_url
    };

}).then(function(data) {

    console.log("TVmaze show records loaded:", data.length);

    if (data.length === 0) {
        throw new Error("The CSV file contains no records.");
    }


    // ----------------------------------------
    // Task 2: Table Settings
    // ----------------------------------------

    const columns = [
        "id",
        "name",
        "type",
        "language",
        "genres",
        "status",
        "premiered",
        "runtime_minutes",
        "rating",
        "network",
        "country",
        "show_url"
    ];

    const columnLabels = {
        id: "Show ID",
        name: "Show Name",
        type: "Show Type",
        language: "Language",
        genres: "Genres",
        status: "Status",
        premiered: "Premiere Date",
        runtime_minutes: "Runtime (min)",
        rating: "Rating (0–10)",
        network: "Network / Platform",
        country: "Network Country",
        show_url: "Details URL"
    };

    const table = d3.select("#data-table");
    const status = d3.select("#table-status");

    let sortColumn = null;
    let ascending = true;


    // ----------------------------------------
    // Task 3: Create the Table Headings
    // ----------------------------------------

    const header = table.select("thead")
        .append("tr");

    const headerCells = header.selectAll("th")
        .data(columns)
        .join("th")
        .attr("scope", "col")
        .attr("tabindex", 0)
        .attr("aria-sort", "none")
        .text(function(column) {
            return columnLabels[column];
        })
        .on("click", function(event, column) {
            sortByColumn(column);
        })
        .on("keydown", function(event, column) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                sortByColumn(column);
            }
        });


    // ----------------------------------------
    // Task 4: Display the Records
    // ----------------------------------------

    function updateRows() {

        const rows = table.select("tbody")
            .selectAll("tr")
            .data(data, function(d) {
                return d.id;
            })
            .join("tr");

        rows.selectAll("td")
            .data(function(row) {
                return columns.map(function(column) {
                    return {
                        column: column,
                        value: row[column],
                        name: row.name,
                        url: row.show_url
                    };
                });
            })
            .join("td")
            .each(function(cell) {

                const element = d3.select(this);
                element.text("");

                // Link directly to the details URL supplied by TVmaze.
                if (cell.column === "name" || cell.column === "show_url") {

                    element.append("a")
                        .attr("href", cell.url)
                        .attr("target", "_blank")
                        .attr("rel", "noopener noreferrer")
                        .attr("title", "View " + cell.name + " on TVmaze")
                        .text(cell.column === "name" ? cell.value : "View show");

                } else {
                    element.text(
                        cell.value === null || cell.value === "" ? "N/A" : cell.value
                    );
                }
            });
    }


    // ----------------------------------------
    // Task 5: Sort by Clicking a Heading
    // ----------------------------------------

    function sortByColumn(column) {

        // A new column starts ascending.
        // Clicking the same column reverses its direction.
        if (sortColumn === column) {
            ascending = !ascending;
        } else {
            sortColumn = column;
            ascending = true;
        }

        // IDs, ratings, and runtimes were converted to numbers in Task 1.
        // Missing values stay last, even when the direction changes.
        // ISO dates (YYYY-MM-DD) sort chronologically as strings.
        data.sort(function(a, b) {
            const aMissing = a[column] === null || a[column] === "";
            const bMissing = b[column] === null || b[column] === "";
            if (aMissing && bMissing) return 0;
            if (aMissing) return 1;
            if (bMissing) return -1;
            if (ascending) {
                return d3.ascending(a[column], b[column]);
            }
            return d3.descending(a[column], b[column]);
        });

        headerCells
            .attr("aria-sort", function(heading) {
                if (heading !== sortColumn) {
                    return "none";
                }
                return ascending ? "ascending" : "descending";
            })
            .text(function(heading) {
                if (heading !== sortColumn) {
                    return columnLabels[heading];
                }

                const arrow = ascending ? " ↑" : " ↓";
                return columnLabels[heading] + arrow;
            });

        updateRows();

        const direction = ascending ? "ascending" : "descending";
        status.text(
            "Sorted by " + columnLabels[column] + ", " + direction + "."
        );
    }


    // ----------------------------------------
    // Task 6: Show the Initial Table
    // ----------------------------------------

    updateRows();

    d3.select("#record-count")
        .text(data.length.toLocaleString("en-US"));

    status.text(
        data.length.toLocaleString("en-US") + " records loaded."
    );

    const missingSummary = columns
        .map(function(column) {
            const count = data.filter(function(d) {
                return d[column] === null || d[column] === "";
            }).length;
            return count ? columnLabels[column] + ": " + count : null;
        })
        .filter(function(value) { return value !== null; });

    d3.select("#quality-summary").text(
        "Missing values in this snapshot — " + missingSummary.join("; ") + "."
    );

}).catch(function(error) {

    console.error("Error loading TVmaze data:", error);

    d3.select("#record-count")
        .text("Unavailable");

    d3.select("#table-status")
        .classed("error", true)
        .text(
            "Could not load the dataset: " + error.message +
            ". Check that data/lab3_data.csv exists, and open this page " +
            "using Live Server or a local HTTP server."
        );

});
