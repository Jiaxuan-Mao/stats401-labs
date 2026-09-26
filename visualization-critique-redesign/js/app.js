import { compareCarrier, flowOpacity, formatEnergy, isDestinationKind, nextYear, playbackYears, selectCountry, yearsForCountry } from './model.mjs';

const state = { data: null, country: 'EU27_2020', year: 2023, selectedCarrier: 'gas', majorOnly: true, playing: false };
const labels = new Map();
let playTimer = null;

const el = (id) => document.getElementById(id);
const slider = el('year-slider');
const svg = d3.select('#sankey');
const tooltip = el('tooltip');

fetch('data/europe_energy_flows.json')
  .then((response) => {
    if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    state.data = data;
    state.country = selectCountry(data, 'EU27_2020').id;
    state.year = selectCountry(data, state.country).years.at(-1).year;
    selectCountry(data, state.country).years[0].nodes.forEach((node) => labels.set(node.id, node.label));
    configureControls();
    render();
  })
  .catch((error) => {
    el('sankey-wrap').innerHTML = `<p class="load-error">Could not load the local dataset. Start a local web server and refresh.<br><small>${error.message}</small></p>`;
  });

function currentCountry() { return selectCountry(state.data, state.country); }
function years() { return yearsForCountry(state.data, state.country); }
function yearData(year = state.year) { return currentCountry().years.find((item) => item.year === Number(year)); }

function configureControls() {
  const countrySelect = el('country-select');
  countrySelect.innerHTML = state.data.countries.map((country) => `<option value="${country.id}">${country.name}</option>`).join('');
  countrySelect.value = state.country;
  countrySelect.disabled = false;
  countrySelect.addEventListener('change', () => setCountry(countrySelect.value));
  slider.max = String(years().length - 1);
  slider.value = String(years().indexOf(state.year));
  document.querySelector('.timeline__labels').innerHTML = years().map((year) => `<b>${year}</b>`).join('');
  slider.addEventListener('input', () => setYear(years()[Number(slider.value)]));
  el('prev-year').addEventListener('click', () => setYear(years()[Math.max(0, years().indexOf(state.year) - 1)]));
  el('next-year').addEventListener('click', () => setYear(nextYear(years(), state.year)));
  el('play-years').addEventListener('click', togglePlayback);
  el('stable-scale').addEventListener('change', render);
  el('compare-years').addEventListener('change', renderDetails);
  el('clear-focus').addEventListener('click', () => selectCarrier(null));
  document.querySelectorAll('[data-flow-mode]').forEach((button) => button.addEventListener('click', () => {
    state.majorOnly = button.dataset.flowMode === 'major';
    document.querySelectorAll('[data-flow-mode]').forEach((item) => item.classList.toggle('is-active', item === button));
    updateLinkStyles();
  }));
}

function setCountry(countryId) {
  stopPlayback();
  state.country = selectCountry(state.data, countryId).id;
  if (!years().includes(state.year)) state.year = years().at(-1);
  labels.clear();
  currentCountry().years[0].nodes.forEach((node) => labels.set(node.id, node.label));
  slider.max = String(years().length - 1);
  slider.value = String(years().indexOf(state.year));
  document.querySelector('.timeline__labels').innerHTML = years().map((year) => `<b>${year}</b>`).join('');
  render();
}

function setYear(year) {
  state.year = Number(year);
  slider.value = String(years().indexOf(state.year));
  render();
}

function togglePlayback() {
  if (state.playing) return stopPlayback();
  let queue = playbackYears(years(), state.year);
  if (!queue.length) { setYear(years()[0]); queue = playbackYears(years(), years()[0]); }
  state.playing = true;
  el('play-years').innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  playTimer = window.setInterval(() => {
    const next = queue.shift();
    if (next == null) return stopPlayback();
    setYear(next);
  }, 1300);
}

function stopPlayback() {
  state.playing = false;
  window.clearInterval(playTimer);
  el('play-years').innerHTML = '<span aria-hidden="true">▶</span> Play';
}

function selectCarrier(carrier) {
  state.selectedCarrier = carrier;
  updateLinkStyles();
  renderDetails();
  renderLegend();
  el('clear-focus').hidden = !carrier;
}

function render() {
  el('page-title').textContent = `${currentCountry().name} energy flow`;
  document.title = `${currentCountry().name} Energy Flow — Sankey Redesign`;
  el('hero-year').textContent = state.year;
  el('chart-year').textContent = state.year;
  renderLegend();
  renderSankey();
  renderDetails();
}

function renderLegend() {
  const carriers = yearData().carriers;
  el('legend').innerHTML = carriers.map((item) => `
    <button type="button" data-carrier="${item.id}" class="${state.selectedCarrier === item.id ? 'is-selected' : ''}" aria-pressed="${state.selectedCarrier === item.id}">
      <i style="background:${item.color}"></i>${item.label}
    </button>`).join('');
  el('legend').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => selectCarrier(button.dataset.carrier)));
}

function renderSankey() {
  const container = el('sankey-wrap');
  const width = Math.max(880, container.clientWidth - 20);
  const fullHeight = 560;
  const currentTotal = totalSystemInflow(yearData());
  const maxTotal = Math.max(...currentCountry().years.map(totalSystemInflow));
  const scaleRatio = el('stable-scale').checked ? Math.max(.76, currentTotal / maxTotal) : 1;
  const height = fullHeight * scaleRatio;
  svg.attr('viewBox', `0 0 ${width} ${fullHeight}`);
  svg.selectAll('*').remove();

  const graph = {
    nodes: yearData().nodes.map((item) => ({ ...item })),
    links: yearData().links.map((item) => ({ ...item })),
  };
  const sankey = d3.sankey()
    .nodeId((d) => d.id)
    .nodeWidth(10)
    .nodePadding(7)
    .nodeAlign((node) => node.stage)
    .extent([[65, 8], [width - 70, height - 8]])
    .iterations(48);
  sankey(graph);

  const defs = svg.append('defs');
  graph.links.forEach((link, index) => {
    const sourceColor = carrierColor(link.carrier);
    const targetColor = link.carrier === 'mixed' ? '#9aa4a8' : sourceColor;
    const gradient = defs.append('linearGradient').attr('id', `flow-${index}`).attr('gradientUnits', 'userSpaceOnUse')
      .attr('x1', link.source.x1).attr('x2', link.target.x0);
    gradient.append('stop').attr('offset', '0%').attr('stop-color', sourceColor);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', targetColor).attr('stop-opacity', .72);
    link.gradient = `url(#flow-${index})`;
  });

  svg.append('g').attr('fill', 'none').selectAll('path').data(graph.links).join('path')
    .attr('class', 'link')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', (d) => d.gradient)
    .attr('stroke-width', (d) => Math.max(1, d.width))
    .attr('data-carrier', (d) => d.carrier)
    .attr('data-value', (d) => d.value)
    .attr('data-kind', (d) => d.kind)
    .on('click', (_, d) => d.carrier !== 'mixed' && selectCarrier(d.carrier))
    .on('pointermove', (event, d) => showTooltip(event, `<strong>${d.source.label} → ${d.target.label}</strong>${formatEnergy(d.value)}`))
    .on('pointerleave', hideTooltip);

  const nodes = svg.append('g').selectAll('g').data(graph.nodes).join('g').attr('class', 'node')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`);
  nodes.append('rect')
    .attr('height', (d) => Math.max(1, d.y1 - d.y0))
    .attr('width', (d) => d.x1 - d.x0)
    .attr('fill', (d) => nodeColor(d))
    .attr('opacity', (d) => state.selectedCarrier && d.carrier && d.carrier !== state.selectedCarrier ? .25 : 1)
    .attr('tabindex', (d) => d.carrier ? 0 : null)
    .attr('role', (d) => d.carrier ? 'button' : null)
    .attr('aria-label', (d) => `${d.label}, ${formatEnergy(d.value)}`)
    .on('click', (_, d) => d.carrier && selectCarrier(d.carrier))
    .on('keydown', (event, d) => { if (d.carrier && ['Enter', ' '].includes(event.key)) selectCarrier(d.carrier); })
    .on('pointermove', (event, d) => showTooltip(event, `<strong>${d.label}</strong>${formatEnergy(d.value)}`))
    .on('pointerleave', hideTooltip);
  nodes.append('text')
    .attr('x', (d) => d.x0 < width / 2 ? 15 : -5)
    .attr('y', (d) => (d.y1 - d.y0) / 2)
    .attr('dy', '.35em')
    .attr('text-anchor', (d) => d.x0 < width / 2 ? 'start' : 'end')
    .text((d) => d.y1 - d.y0 > 4 ? d.label : '');
  updateLinkStyles();
}

function updateLinkStyles() {
  svg.selectAll('.link').style('opacity', function() {
    const link = { carrier: this.dataset.carrier, value: Number(this.dataset.value) };
    return flowOpacity(link, state.selectedCarrier, state.majorOnly);
  });
}

function renderDetails() {
  const carrier = yearData().carriers.find((item) => item.id === state.selectedCarrier) || yearData().carriers[0];
  if (!carrier) return;
  const links = yearData().links.filter((item) => item.carrier === carrier.id);
  const sources = aggregate(links.filter((item) => item.kind === 'source'), (item) => labels.get(item.source));
  const destinations = aggregate(links.filter((item) => isDestinationKind(item.kind)), (item) => labels.get(item.target));
  const total = [...sources.values()].reduce((sum, value) => sum + value, 0);
  el('detail-title').textContent = carrier.label;
  el('detail-swatch').style.background = carrier.color;
  el('detail-total').textContent = formatEnergy(total);
  renderBars('source-bars', sources, carrier.color, total);
  renderBars('destination-bars', destinations, carrier.color);

  const compare = el('compare-years').checked;
  const previous = currentCountry().years.filter((item) => item.year < state.year).at(-1);
  const deltaText = el('detail-delta');
  const changeSection = el('change-section');
  if (!compare || !previous) {
    deltaText.textContent = compare ? 'No earlier year is available' : 'Choose compare to see year-over-year change';
    deltaText.className = '';
    changeSection.hidden = true;
    return;
  }
  const previousLinks = previous.links.filter((item) => item.carrier === carrier.id);
  const previousTotal = previousLinks.filter((item) => item.kind === 'source').reduce((sum, item) => sum + item.value, 0);
  const delta = compareCarrier(previous.year, state.year, previousTotal, total);
  const sign = delta.absolute > 0 ? '+' : '';
  deltaText.textContent = `${sign}${formatEnergy(delta.absolute)} · ${delta.percent == null ? 'n/a' : `${sign}${delta.percent.toFixed(1)}%`} vs ${previous.year}`;
  deltaText.className = delta.direction === 'up' ? 'positive' : delta.direction === 'down' ? 'negative' : '';
  const priorDestinations = aggregate(previousLinks.filter((item) => isDestinationKind(item.kind)), (item) => labels.get(item.target));
  const changes = [...new Set([...destinations.keys(), ...priorDestinations.keys()])].map((name) => ({
    name,
    value: (destinations.get(name) || 0) - (priorDestinations.get(name) || 0),
  })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 4);
  el('change-list').innerHTML = changes.map((item) => `<div class="change-item"><span>${item.name}</span><b class="${item.value >= 0 ? 'up' : 'down'}">${item.value >= 0 ? '+' : ''}${formatEnergy(item.value)}</b></div>`).join('');
  changeSection.hidden = false;
}

function aggregate(items, keyFn) {
  const result = new Map();
  items.forEach((item) => result.set(keyFn(item), (result.get(keyFn(item)) || 0) + item.value));
  return new Map([...result.entries()].sort((a, b) => b[1] - a[1]));
}

function renderBars(containerId, values, color, total = null) {
  const max = total || Math.max(...values.values(), 1);
  el(containerId).innerHTML = [...values.entries()].slice(0, 6).map(([name, value]) => `
    <div class="bar-row">
      <div class="bar-row__meta"><b>${name}</b><span>${formatEnergy(value)}</span></div>
      <div class="bar-track"><i style="--bar-color:${color};width:${Math.max(1, value / max * 100)}%"></i></div>
    </div>`).join('') || '<small>No recorded flow</small>';
}

function totalSystemInflow(data) { return data.links.filter((item) => item.kind === 'source').reduce((sum, item) => sum + item.value, 0); }
function carrierColor(carrier) { return yearData().carriers.find((item) => item.id === carrier)?.color || '#9aa4a8'; }
function nodeColor(node) {
  if (node.color) return node.color;
  if (node.kind === 'transformation') return '#243947';
  if (node.kind === 'adjustment') return '#c3c9cc';
  if (node.kind === 'source') return '#536772';
  return '#aeb8bd';
}
function showTooltip(event, html) {
  const box = el('sankey-wrap').getBoundingClientRect();
  tooltip.innerHTML = html;
  tooltip.style.left = `${event.clientX - box.left}px`;
  tooltip.style.top = `${event.clientY - box.top}px`;
  tooltip.style.opacity = 1;
}
function hideTooltip() { tooltip.style.opacity = 0; }

window.addEventListener('resize', () => state.data && renderSankey());
