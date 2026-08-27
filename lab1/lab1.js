// ----------------------------------------
// Task 1: Basic JavaScript
// ----------------------------------------

console.log("Hello STATS 401!");

let course = "STATS 401";
let students = 40;

console.log(course);
console.log(students);


// Arrays
let data = [10, 20, 30, 40, 50];

console.log(data);


// Objects
let student = {
    name: "Alice",
    score: 85
};

console.log(student.name);
console.log(student.score);


// Array of objects
let studentsList = [
    { name: "Alice", score: 85 },
    { name: "Bob", score: 72 },
    { name: "Carol", score: 91 }
];

console.log(studentsList);
console.log(studentsList[0].name);


// ----------------------------------------
// Task 2: D3.js
// ----------------------------------------

console.log("D3 version:", d3.version);


// ----------------------------------------
// Task 3: D3 Data Binding
// ----------------------------------------

const dataForNumbers = [10, 20, 30, 40, 50];


// Create paragraphs for the data
// This section works if #numbers exists in the HTML
d3.select("#numbers")
    .selectAll("p")
    .data(dataForNumbers)
    .join("p")
    .text(d => `Value: ${d}`);


// ----------------------------------------
// Task 4: SVG
// ----------------------------------------

// The final Lab 1 chart uses #chart.
// The SVG is created using D3.

const svg = d3.select("#chart")
    .append("svg")
    .attr("width", 700)
    .attr("height", 450);


// ----------------------------------------
// Task 5: Load CSV Data
// ----------------------------------------

d3.csv("../data/students.csv", d => {

    return {
        name: d.name,
        score: +d.score
    };

}).then(data => {

    console.log("Student data:", data);


    // ----------------------------------------
    // Chart Settings
    // ----------------------------------------

    const chartWidth = 700;
    const chartHeight = 450;

    const margin = {
        top: 40,
        right: 20,
        bottom: 100,
        left: 20
    };

    const barBottom = 320;
    const barScale = 3;


    // ----------------------------------------
    // Chart Title
    // ----------------------------------------

    svg.append("text")
        .attr("x", margin.left)
        .attr("y", 25)
        .attr("text-anchor", "start")
        .attr("font-weight", "bold")
        .attr("font-size", "18px");


    // ----------------------------------------
    // Create Bars
    // ----------------------------------------

    svg.selectAll("rect")
        .data(data)
        .join("rect")
        .attr("x", (d, i) => {
            return margin.left + i * 80;
        })
        .attr("y", d => {
            return barBottom - d.score * barScale;
        })
        .attr("width", 55)
        .attr("height", d => {
            return d.score * barScale;
        })
        .attr("fill", "#fba7e4");


    // ----------------------------------------
    // Student Names
    // ----------------------------------------

    svg.selectAll(".student-name")
        .data(data)
        .join("text")
        .attr("class", "student-name")
        .attr("x", (d, i) => {
            return margin.left + i * 80 + 27.5;
        })
        .attr("y", 350)
        .attr("text-anchor", "middle")
        .text(d => d.name);


    // ----------------------------------------
    // Student Scores
    // ----------------------------------------

    // Scores are displayed BELOW the student names.
    svg.selectAll(".student-score")
        .data(data)
        .join("text")
        .attr("class", "student-score")
        .attr("x", (d, i) => {
            return margin.left + i * 80 + 27.5;
        })
        .attr("y", 375)
        .attr("text-anchor", "middle")
        .text(d => d.score);


}).catch(error => {

    console.error("Error loading student data:", error);

});