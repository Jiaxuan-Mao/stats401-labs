export function nextYear(years, currentYear) {
  const ordered = [...years].sort((a, b) => a - b);
  const index = ordered.indexOf(Number(currentYear));
  if (index < 0) return ordered[0];
  return ordered[Math.min(index + 1, ordered.length - 1)];
}

export function playbackYears(years, currentYear) {
  return [...years]
    .map(Number)
    .sort((a, b) => a - b)
    .filter((year) => year > Number(currentYear));
}

export function compareCarrier(fromYear, toYear, fromValue, toValue) {
  const absolute = toValue - fromValue;
  return {
    fromYear,
    toYear,
    absolute,
    percent: fromValue === 0 ? null : (absolute / fromValue) * 100,
    direction: absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat',
  };
}

export function flowOpacity(link, selectedCarrier, majorOnly, majorThreshold = 10_000) {
  if (selectedCarrier && link.carrier !== selectedCarrier) return 0.08;
  if (!selectedCarrier && majorOnly && link.value < majorThreshold) return 0.08;
  return selectedCarrier ? 0.82 : 0.5;
}

export function formatEnergy(valueTJ) {
  const pj = Number(valueTJ || 0) / 1000;
  if (pj === 0) return '0 PJ';
  if (Math.abs(pj) < 1) return `${pj.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} PJ`;
  return `${Math.round(pj).toLocaleString('en-US')} PJ`;
}

export function isDestinationKind(kind) {
  return ['final_use', 'export', 'other_energy'].includes(kind);
}

export function selectCountry(data, countryId) {
  return data.countries.find((country) => country.id === countryId) || data.countries[0];
}

export function yearsForCountry(data, countryId) {
  return selectCountry(data, countryId).years.map((item) => item.year).sort((a, b) => a - b);
}
