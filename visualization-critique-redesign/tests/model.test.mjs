import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCarrier,
  flowOpacity,
  formatEnergy,
  isDestinationKind,
  selectCountry,
  yearsForCountry,
  nextYear,
  playbackYears,
} from '../js/model.mjs';

test('nextYear advances chronologically and stops at the final year', () => {
  const years = [2021, 2022, 2023];
  assert.equal(nextYear(years, 2021), 2022);
  assert.equal(nextYear(years, 2023), 2023);
});

test('playbackYears starts after the current year and includes the final year once', () => {
  assert.deepEqual(playbackYears([2020, 2021, 2022, 2023], 2021), [2022, 2023]);
  assert.deepEqual(playbackYears([2020, 2021], 2021), []);
});

test('compareCarrier reports signed absolute and percentage change', () => {
  assert.deepEqual(compareCarrier(2022, 2023, 800, 920), {
    fromYear: 2022,
    toYear: 2023,
    absolute: 120,
    percent: 15,
    direction: 'up',
  });
  assert.equal(compareCarrier(2022, 2023, 0, 50).percent, null);
});

test('flowOpacity keeps selected carrier paths prominent and mutes unrelated paths', () => {
  const selected = 'gas';
  assert.equal(flowOpacity({ carrier: 'gas', value: 50 }, selected, false), 0.82);
  assert.equal(flowOpacity({ carrier: 'oil', value: 50 }, selected, false), 0.08);
  assert.equal(flowOpacity({ carrier: 'gas', value: 2 }, selected, true), 0.82);
  assert.equal(flowOpacity({ carrier: 'gas', value: 2 }, null, true), 0.08);
});

test('formatEnergy converts TJ to readable PJ without hiding small values', () => {
  assert.equal(formatEnergy(1_245_600), '1,246 PJ');
  assert.equal(formatEnergy(420), '0.42 PJ');
  assert.equal(formatEnergy(0), '0 PJ');
});

test('detail destinations include final use, exports, and grouped other energy flows', () => {
  assert.equal(isDestinationKind('final_use'), true);
  assert.equal(isDestinationKind('export'), true);
  assert.equal(isDestinationKind('other_energy'), true);
  assert.equal(isDestinationKind('source'), false);
  assert.equal(isDestinationKind('transformation_input'), false);
});

test('country selection returns the requested country and its own ordered years', () => {
  const data = {
    countries: [
      { id: 'DE', name: 'Germany', years: [{ year: 2020 }, { year: 2021 }] },
      { id: 'FR', name: 'France', years: [{ year: 2019 }, { year: 2021 }] },
    ],
  };
  assert.equal(selectCountry(data, 'FR').name, 'France');
  assert.deepEqual(yearsForCountry(data, 'FR'), [2019, 2021]);
  assert.equal(selectCountry(data, 'NO_SUCH_COUNTRY').id, 'DE');
});
