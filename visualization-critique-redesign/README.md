# European Energy Flow — Sankey redesign

An interactive redesign study of the IEA Energy Sankey interface for a STAT 401 individual presentation. The public prototype uses reusable Eurostat data for the EU-27 aggregate and eight European countries rather than redistributing IEA data.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Rebuild the data

```bash
python3 scripts/build_energy_data.py \
  data/source/nrg_bal_c_*.json \
  --output data/europe_energy_flows.json
```

## Test

```bash
npm test
```

## Design choices

- High-contrast carrier colors replace a low-contrast, overly broad palette.
- Clicking a carrier highlights its complete path and keeps a persistent details panel on the same page.
- A 2019–2023 year slider and playback control make the pre-pandemic baseline, 2020 disruption, recovery, and later energy-market changes visible.
- The geography selector defaults to Europe, representing Eurostat's official EU-27 aggregate, and switches among Germany, France, Poland, Sweden, Norway, Spain, Italy and the Netherlands while preserving the selected year.
- “Same scale across years” controls comparability, not the measurement unit.
- Thin flows can be hidden in the default overview but remain available through “All flows”; a selected carrier always remains visible.
- Transformation, statistical, and balancing differences are explicitly labeled.
- Final destinations follow the original IEA-style reading categories: Industry, Transport, Residential, Commercial & public services, Other final consumption, Non-energy use, Exports, and a grouped Other energy flows category for technical balance items.

## Data

Source: Eurostat complete energy balances (`nrg_bal_c`), the official EU-27 aggregate (`EU27_2020`) and eight European countries, 2019–2023 annual data in terajoules. The interface shortens the aggregate's display name to “Europe”; it does not imply all geographic European countries. The source JSON-stat files are preserved in `data/source/` and the reproducible transform is in `scripts/build_energy_data.py`.

Eight non-overlapping aggregate carriers are used. Parent totals are intentionally excluded to prevent double counting. The generated graph separates carriers before and after conversion so the Sankey remains acyclic. Where published balance components do not reconcile exactly at the chosen aggregation level, explicit balancing inflows preserve conservation; corresponding technical outflows are included in the clearly labeled Other energy flows destination.

The interface is a redesign study inspired by IEA Energy Sankey. It does not contain IEA data.
