// Lab 8 — Task 10 CSV loading, Task 11 joins/scales, Tasks 12–15 interactions.
(function () {
    "use strict";
    const status = document.querySelector("#lab8-status");
    if (typeof d3 === "undefined") {
        status.textContent = "D3 could not load. Check your connection and reload.";
        status.classList.add("error");
        return;
    }
    Promise.all([
        d3.csv("../data/lab8_embedding_map.csv", d => ({...d, x: +d.x, y: +d.y,
            cluster: +d.cluster, word_count: +d.word_count, page: +d.page, page_end: +d.page_end})),
        d3.json("../data/lab8_neighbors.json"),
        d3.json("../data/lab8_corpus_report.json"),
        d3.json("../data/lab8_model_report.json"),
        d3.json("../data/lab8_analysis_summary.json"),
        d3.csv("../data/lab8_top_terms.csv", d => ({term: d.term, mean_tfidf: +d.mean_tfidf})),
        d3.csv("../data/lab8_topic_section_matrix.csv", d => ({...d, cluster: +d.cluster, count: +d.count})),
        d3.json("narrative.json")
    ]).then(function ([data, neighbors, corpus, model, analysis, terms, matrix, narrative]) {
        validate(data, neighbors, corpus, matrix);
        draw(data, neighbors, corpus, model, analysis, terms, matrix, narrative);
        status.textContent = `${data.length.toLocaleString()} passages · ${corpus.formal_sections} formal sections · 8 semantic topics. Ready to explore.`;
    }).catch(function (error) {
        status.textContent = `Could not load Lab 8: ${error.message}. Open through Live Server or an HTTP server.`;
        status.classList.add("error");
    });

    function sectionKey(d) { return JSON.stringify([d.chapter, d.section]); }
    function cellKey(d) { return JSON.stringify([d.chapter, d.section, d.cluster]); }
    function validate(data, neighbors, corpus, matrix) {
        const ids = new Set(data.map(d => d.passage_id));
        if (!data.length || ids.size !== data.length || data.length !== corpus.clean_passages) throw Error("Invalid passage count or IDs");
        if (data.some(d => !d.text || !d.chapter || !d.section || !d.subsection ||
            ![d.x,d.y,d.word_count,d.page,d.page_end,d.cluster].every(Number.isFinite) || d.word_count < 20 ||
            d.page < 10 || d.page_end > 396 || d.page_end < d.page || !Number.isInteger(d.cluster) || d.cluster < 0 || d.cluster > 7)) throw Error("Invalid passage fields");
        for (const d of data) {
            const list = neighbors[d.passage_id];
            if (!list || list.length !== 5 || new Set(list.map(n => n.passage_id)).size !== 5 ||
                list.some(n => !ids.has(n.passage_id) || n.passage_id === d.passage_id || !Number.isFinite(n.score) || Math.abs(n.score)>1.00001)) throw Error("Invalid semantic neighbors");
        }
        const counts = d3.rollup(data, v => v.length, cellKey);
        if (matrix.length !== counts.size || matrix.some(d => d.count !== counts.get(cellKey(d)))) throw Error("Matrix does not match passages");
    }

    function draw(data, neighbors, corpus, model, analysis, terms, matrix, narrative) {
        const byId = new Map(data.map(d => [d.passage_id, d]));
        const topics = analysis.topics;
        const sections = analysis.sections;
        const color = d3.scaleOrdinal(d3.range(8), ["#3874ad", "#b94c70", "#36867d", "#9260aa", "#b97827", "#77853d", "#696a99", "#a96748"]);
        const width = 960, height = 550;
        const xScale = d3.scaleLinear().domain(d3.extent(data, d => d.x)).nice().range([35, width-35]);
        const yScale = d3.scaleLinear().domain(d3.extent(data, d => d.y)).nice().range([height-35, 35]);
        const radius = d3.scaleSqrt().domain([0, d3.max(data,d=>d.word_count)]).range([0, 10]);
        let selected = null, neighborIds = new Set(), zoomK = 1;
        const search = d3.select("#search"), sectionFilter = d3.select("#section-filter"), topicFilter = d3.select("#topic-filter");
        d3.selectAll(".lab8-controls input, .lab8-controls select, .lab8-actions button").property("disabled", false);
        const sectionOptions = sectionFilter.selectAll("optgroup").data(d3.groups(sections,d=>d.chapter)).join("optgroup").attr("label",d=>d[0]);
        sectionOptions.selectAll("option").data(d=>d[1]).join("option").attr("value",sectionKey).text(d=>d.section);
        topicFilter.selectAll("option.topic").data(topics).join("option").attr("class","topic").attr("value",d=>d.cluster).text(d=>d.name);

        // Tasks 3–5: a bar chart and term table expose corpus-level summaries before the embedding map.
        const metrics = [["Raw passage candidates",corpus.raw_passages],["After cleaning",corpus.clean_passages],
            ["Mean words / passage",d3.format(".1f")(corpus.average_words)],["Formal sections",corpus.formal_sections]];
        const stats = d3.select("#corpus-stats").selectAll("div").data(metrics).join("div");
        stats.append("dt").text(d=>d[0]);stats.append("dd").text(d=>d[1]);
        d3.select("#corpus-scope").text(corpus.scope);
        d3.select("#corpus-hierarchy").text(corpus.hierarchy);
        d3.select("#corpus-cleaning").text(`Raw candidates are counted after excluding document furniture and ruled tables, before text cleaning. Removed ${corpus.cleaning_reasons.short_fragment_under_20_words} short fragments, ${corpus.cleaning_reasons.standalone_prerequisite_list} standalone prerequisite blocks and ${corpus.cleaning_reasons.duplicate_normalized_text} exact normalized duplicates. Whitespace and Unicode were normalized; no stop-word removal was applied to embeddings.`);
        // Basic D3 horizontal bars: a shared zero baseline makes counts comparable.
        const barWidth = 600, barLeft = 305, barRight = 40;
        const barScale = d3.scaleLinear().domain([0, d3.max(sections, d => d.count)]).nice()
            .range([barLeft, barWidth - barRight]);
        const rankedSections = sections.slice().sort((a, b) => d3.descending(a.count, b.count));
        const barContainer = d3.select("#section-summary");
        const barHeader = barContainer.append("svg").attr("class", "lab8-bar-axis")
            .attr("width", barWidth).attr("height", 52);
        barHeader.append("text").attr("x", 12).attr("y", 19).text("Formal section");
        barHeader.append("text").attr("x", barLeft).attr("y", 19).text("Passages");
        barHeader.append("g").attr("transform", "translate(0,48)")
            .call(d3.axisTop(barScale).ticks(5).tickFormat(d3.format("d")));
        const barSvg = barContainer.append("svg").attr("class", "lab8-section-bars")
            .attr("width", barWidth).attr("role", "group").attr("aria-label", "Passage count by formal section");
        // Wrap long original section labels; shorten only the repeated catalogue prefix.
        const measure = barSvg.append("text").attr("class", "lab8-bar-label");
        let nextY = 0;
        const barData = rankedSections.map(function(d) {
            const words = d.section.replace("Courses with Course Subject: ", "").split(/\s+/);
            const lines = []; let line = "";
            words.forEach(function(word) {
                const candidate = line ? line + " " + word : word;
                if (line && measure.text(candidate).node().getComputedTextLength() > barLeft - 28) {
                    lines.push(line); line = word;
                } else line = candidate;
            });
            lines.push(line);
            const rowHeight = Math.max(34, lines.length * 15 + 14);
            const row = {...d, lines, rowHeight, rowY: nextY};
            nextY += rowHeight;
            return row;
        });
        measure.remove();barSvg.attr("height", nextY);
        const barRows = barSvg.selectAll("g.lab8-bar-row").data(barData).join("g")
            .attr("class", "lab8-bar-row").attr("transform", d => `translate(0,${d.rowY})`)
            .attr("tabindex", 0).attr("role", "img")
            .attr("aria-label", d => `${d.chapter}; ${d.section}: ${d.count} passages`);
        barRows.append("title").text(d => `${d.chapter}\n${d.section}\n${d.count} passages`);
        barRows.append("line").attr("x1", 0).attr("x2", barWidth)
            .attr("y1", d => d.rowHeight).attr("y2", d => d.rowHeight).attr("stroke", "#eee5ea");
        barRows.append("text").attr("class", "lab8-bar-label").each(function(d) {
            d3.select(this).selectAll("tspan").data(d.lines).join("tspan")
                .attr("x", 12).attr("y", (line, i) => (d.rowHeight - (d.lines.length - 1) * 15) / 2 + i * 15)
                .attr("dominant-baseline", "middle").text(line => line);
        });
        barRows.append("rect").attr("class", "lab8-section-bar").attr("x", barScale(0))
            .attr("y", d => d.rowHeight / 2 - 8).attr("height", 16)
            .attr("width", d => barScale(d.count) - barScale(0)).attr("fill", "#b94c70");
        barRows.append("text").attr("class", "lab8-bar-value")
            .attr("x", d => barScale(d.count) + 6).attr("y", d => d.rowHeight / 2)
            .attr("dominant-baseline", "middle").text(d => d.count);
        const termRows = d3.select("#term-summary tbody").selectAll("tr").data(terms.slice(0,12)).join("tr");
        termRows.append("td").text(d=>d.term);termRows.append("td").text(d=>d3.format(".4f")(d.mean_tfidf));

        // Task 11: each original passage has one SVG point with UMAP position.
        const svg = d3.select("#semantic-map").append("svg").attr("viewBox",`0 0 ${width} ${height}`)
            .attr("role","group").attr("aria-label","Semantic passage map; position approximates semantic similarity");
        svg.append("title").text("UMAP semantic map of the DKU Bulletin");
        svg.append("defs").append("clipPath").attr("id","map-clip").append("rect").attr("width",width).attr("height",height);
        const panLayer = svg.append("g").attr("clip-path","url(#map-clip)").append("g");
        const points = panLayer.selectAll("circle").data(data,d=>d.passage_id).join("circle")
            .attr("class","passage").attr("data-id",d=>d.passage_id)
            .attr("cx",d=>xScale(d.x)).attr("cy",d=>yScale(d.y)).attr("r",d=>radius(d.word_count))
            .attr("fill",d=>color(d.cluster)).attr("stroke","white").attr("stroke-width",.5)
            .attr("tabindex",0).attr("role","button")
            .attr("aria-label",d=>`${d.passage_id}: ${d.section}; ${d.cluster_name}; page ${d.page}; ${d.word_count} words`)
            .on("click",(event,d)=>selectPassage(d))
            .on("keydown",function(event,d) { if (["Enter"," "].includes(event.key)) {event.preventDefault();selectPassage(d);} });
        points.append("title").text(d=>`${d.passage_id} · ${d.cluster_name}\n${d.section} · page ${d.page}\n${d.text.slice(0,150)}…`);
        const zoom = d3.zoom().scaleExtent([1,12]).extent([[0,0],[width,height]])
            .translateExtent([[-width,-height],[width*2,height*2]])
            .on("zoom",function(event) { zoomK=event.transform.k;panLayer.attr("transform",event.transform);updateMarks(); });
        svg.call(zoom);
        d3.select("#zoom-in").on("click",()=>svg.call(zoom.scaleBy,1.5));
        d3.select("#zoom-out").on("click",()=>svg.call(zoom.scaleBy,1/1.5));
        d3.select("#reset-view").on("click",()=>svg.call(zoom.transform,d3.zoomIdentity));
        const keys=d3.select("#topic-legend").selectAll("span.lab8-key").data(topics).join("span").attr("class","lab8-key");
        keys.append("span").attr("class","lab8-swatch").style("background",d=>color(d.cluster));
        keys.append("span").text(d=>d.name);
        const sizeSvg=d3.select("#size-legend").append("svg").attr("width",260).attr("height",80);
        sizeSvg.append("text").attr("x",0).attr("y",15).attr("font-size",13).text("Circle area → passage word count");
        [25,100,250].forEach((n,i)=>{
            sizeSvg.append("circle").attr("cx",35+i*85).attr("cy",40).attr("r",radius(n)).attr("fill","#8d7e88");
            sizeSvg.append("text").attr("x",35+i*85).attr("y",68).attr("text-anchor","middle").attr("font-size",12).text(`${n} words`);
        });

        // Tasks 14–15: D3-generated count matrix, including true zero cells.
        const maxCount=d3.max(matrix,d=>d.count);
        const cellColor=d3.scaleSequential([0,maxCount],d3.interpolatePuRd);
        const counts=new Map(matrix.map(d=>[cellKey(d),d.count]));
        const matrixHead=d3.select("#topic-matrix thead").append("tr");
        matrixHead.append("th").attr("scope","col").text("Formal section ↓ / semantic topic →");
        matrixHead.selectAll("th.topic-header").data(topics).join("th").attr("class","topic-header").attr("scope","col").text(d=>d.name);
        const rows=d3.select("#topic-matrix tbody").selectAll("tr").data(sections).join("tr").attr("data-section",sectionKey);
        rows.append("th").attr("scope","row").attr("title",d=>`${d.chapter} — ${d.section}`).append("span").text(d=>d.section);
        const cells=rows.selectAll("td").data(s=>topics.map(t=>({chapter:s.chapter,section:s.section,cluster:t.cluster,cluster_name:t.name,
            total:s.count,count:counts.get(cellKey({...s,cluster:t.cluster}))||0}))).join("td").append("button")
            .attr("class","matrix-cell").attr("data-key",cellKey)
            .style("background",d=>d.count===0?"#faf8fa":cellColor(d.count))
            .style("color",d=>d.count>maxCount*.55?"white":"#29232c")
            .text(d=>d.count || "·")
            .attr("aria-label",d=>`${d.section}; ${d.cluster_name}; ${d.count} passages; ${d3.format(".1%")(d.count/d.total)} of section`)
            .on("pointerenter focus",function(event,d){showTooltip(event,d,this);})
            .on("pointerleave blur",()=>d3.select("#matrix-tooltip").attr("hidden",true))
            .on("click",function(event,d){
                search.property("value","");sectionFilter.property("value",sectionKey(d));topicFilter.property("value",d.cluster);
                selected=null;neighborIds.clear();resetDetails();refresh();
                d3.select("#matrix-tooltip").attr("hidden",true);
                document.querySelector("#semantic-map").scrollIntoView({behavior:"smooth",block:"center"});
            });
        const legend=d3.select("#matrix-legend").append("svg").attr("width",330).attr("height",54);
        const gradient=legend.append("defs").append("linearGradient").attr("id","count-gradient");
        d3.range(0,1.01,.1).forEach(t=>gradient.append("stop").attr("offset",`${t*100}%`).attr("stop-color",cellColor(t*maxCount)));
        legend.append("rect").attr("width",180).attr("height",12).attr("y",4).attr("fill","url(#count-gradient)");
        legend.append("text").attr("y",33).attr("font-size",12).text("0");
        legend.append("text").attr("x",180).attr("y",33).attr("text-anchor","end").attr("font-size",12).text(maxCount);
        legend.append("text").attr("x",195).attr("y",15).attr("font-size",12).text("Passage count");
        function showTooltip(event,d,element) {
            const tip=d3.select("#matrix-tooltip").attr("hidden",null)
                .text(`${d.chapter}\n${d.section}\n${d.cluster_name}\n${d.count} passages (${d3.format(".1%")(d.count/d.total)} of this section)`);
            const box=element.getBoundingClientRect(), bounds=tip.node().getBoundingClientRect();
            const px=event.clientX||box.left,py=event.clientY||box.top;
            tip.style("left",`${Math.max(8,Math.min(px+12,innerWidth-bounds.width-8))}px`)
                .style("top",`${Math.max(8,Math.min(py+12,innerHeight-bounds.height-8))}px`);
        }
        document.addEventListener("keydown",event=>{if(event.key==="Escape")d3.select("#matrix-tooltip").attr("hidden",true);});

        function matches(d) {
            const q=search.property("value").trim().toLowerCase(), s=sectionFilter.property("value"), t=topicFilter.property("value");
            return (!q||d.text.toLowerCase().includes(q))&&(!s||sectionKey(d)===s)&&(t===""||d.cluster===+t);
        }
        function updateMarks() {
            points.attr("r",d=>radius(d.word_count)/zoomK)
                .attr("opacity",d=>matches(d)?.82:.055)
                .attr("stroke",d=>selected===d.passage_id?"#17151c":neighborIds.has(d.passage_id)?"#f28a24":"white")
                .attr("stroke-width",d=>(selected===d.passage_id?3:neighborIds.has(d.passage_id)?2.5:.5)/zoomK)
                .attr("aria-pressed",d=>selected===d.passage_id?"true":"false");
            points.filter(d=>neighborIds.has(d.passage_id)||d.passage_id===selected).raise();
        }
        function refresh() {
            updateMarks();
            const matched=data.filter(matches);
            const outside=selected&&!matches(byId.get(selected));
            d3.select("#match-status").text(`${matched.length} / ${data.length} passages match all conditions.${matched.length===0?" No matches; clear a filter or change the search.":""}${outside?" Selected passage is outside the current filters; Reset all to clear selection.":""}`);
            cells.classed("selected-cell",d=>selected&&cellKey(d)===cellKey(byId.get(selected)))
                .classed("filter-cell",d=>sectionKey(d)===sectionFilter.property("value")&&String(d.cluster)===topicFilter.property("value"));
            const visible=matched.slice(0,60);
            d3.select("#result-note").text(`Showing ${visible.length} of ${matched.length} matches. Refine the search or filters to narrow the list.`);
            d3.select("#passage-results").selectAll("button").data(visible,d=>d.passage_id).join("button")
                .text(d=>`${d.passage_id} · p. ${d.page} · ${d.section} — ${d.text.slice(0,100)}…`)
                .on("click",(event,d)=>selectPassage(d));
        }
        function resetDetails() {
            const panel=d3.select("#detail-panel");panel.attr("data-id",null).selectAll("*").remove();
            panel.append("h3").text("Passage details");panel.append("p").text("Select a passage to see its full text, source and nearest neighbors.");
        }
        function jumpToPassage(id) {
            search.property("value","");sectionFilter.property("value","");topicFilter.property("value","");
            svg.call(zoom.transform,d3.zoomIdentity);selectPassage(byId.get(id));
            document.querySelector("#semantic-map").scrollIntoView({behavior:"smooth",block:"start"});
        }
        function selectPassage(d) {
            selected=d.passage_id;neighborIds=new Set(neighbors[selected].map(n=>n.passage_id));
            const panel=d3.select("#detail-panel");panel.selectAll("*").remove();
            panel.attr("data-id",selected).append("h3").text(`Passage ${selected}`);
            const meta=panel.append("dl");
            [["Chapter",d.chapter],["Section",d.section],["Subsection",d.subsection],["Page",d.page===d.page_end?d.page:`${d.page}–${d.page_end}`],["Topic",d.cluster_name],["Length",`${d.word_count} words`]].forEach(([k,v])=>{meta.append("dt").text(k);meta.append("dd").text(v);});
            panel.append("p").attr("class","lab8-original").text(d.text);
            panel.append("a").attr("href",`${corpus.source}#page=${d.page}`).attr("target","_blank").attr("rel","noopener").text(`Read original PDF, page ${d.page}`);
            panel.append("h4").text("Five nearest semantic passages");
            panel.append("p").attr("class","lab8-hint").text("Ranked by cosine similarity in the original 384-dimensional space, excluding the selected passage. Choosing a neighbor clears filters and resets the map view to reveal it. Similarity is not a probability.");
            const items=panel.append("ol").attr("class","lab8-neighbors").selectAll("li").data(neighbors[selected]).join("li");
            items.append("button").attr("data-neighbor",n=>n.passage_id).text(n=>{
                const p=byId.get(n.passage_id);return `${n.passage_id} · cosine ${n.score.toFixed(3)} · p. ${p.page} · ${p.section}${p.section===d.section?" (same section)":" (different section)"}`;
            }).on("click",(event,n)=>jumpToPassage(n.passage_id));
            items.append("p").text(n=>byId.get(n.passage_id).text);
            refresh();
            // Scroll only within the matrix, leaving the reader at the chosen passage.
            const active=cells.filter(c=>cellKey(c)===cellKey(d)).node();
            if(active) {
                const container=document.querySelector(".lab8-matrix-scroll");
                container.scrollTop += active.getBoundingClientRect().top - container.getBoundingClientRect().top - 110;
            }
        }
        search.on("input",refresh);sectionFilter.on("change",refresh);topicFilter.on("change",refresh);
        d3.select("#reset").on("click",function(){
            search.property("value","");sectionFilter.property("value","");topicFilter.property("value","");
            selected=null;neighborIds.clear();resetDetails();svg.call(zoom.transform,d3.zoomIdentity);refresh();
        });

        // Parts G/H: findings are written after inspecting real model output.
        const findings=d3.select("#findings").selectAll("li").data(narrative.findings).join("li");
        findings.append("strong").text(d=>d.question);findings.append("span").text(d=>d.answer);
        findings.each(function(d){
            for(const id of d.passage_ids||[]) d3.select(this).append("button").style("margin","8px 8px 0 0").text(`Explore ${id}`).on("click",()=>jumpToPassage(id));
        });
        const articles=d3.select("#topic-evidence").selectAll("article").data(topics).join("article");
        articles.append("h3").text(d=>`${d.name} (${d.count} passages)`);
        articles.append("p").text(d=>`Characteristic terms: ${d.terms.join(", ")}.`);
        articles.append("p").text(d=>d.rationale);
        articles.each(function(d){for(const id of d.representative_ids)d3.select(this).append("button").style("margin-right","8px").text(id).on("click",()=>jumpToPassage(id));});
        d3.select("#design-description").selectAll("p").data(narrative.design).join("p").text(d=>d);
        d3.select("#model-note").text(`Model: ${model.model}; ${model.dimensions} dimensions; normalized vectors. UMAP: n_neighbors=15, min_dist=0.15, metric=cosine, n_components=2, random_state=401. KMeans: 8 clusters, n_init=auto, random_state=401, fitted to original embeddings. ${model.embedding_chunks.long_passages_chunked} long passages use normalized, token-weighted mean chunk embeddings; max_seq_length=256. TF-IDF: English stop words, 1–2 grams, min_df=3, max_df=0.8. Design description: ${narrative.design.join(" ").split(/\s+/).length} words.`);
        refresh();
    }
})();
