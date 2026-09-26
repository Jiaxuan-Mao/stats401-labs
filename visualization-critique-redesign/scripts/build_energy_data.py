#!/usr/bin/env python3
"""Build a balanced, browser-ready Sankey dataset from Eurostat nrg_bal_c."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


CARRIERS = [
    {"id": "solid", "code": "C0000X0350-0370", "label": "Solid fossil fuels", "color": "#5B6573"},
    {"id": "gas", "code": "G3000", "label": "Natural gas", "color": "#168AAD"},
    {"id": "oil", "code": "O4000XBIO", "label": "Oil products", "color": "#E07A2D"},
    {"id": "renewables", "code": "RA000", "label": "Renewables & biofuels", "color": "#2E9D6F"},
    {"id": "waste", "code": "W6100_6220", "label": "Non-renewable waste", "color": "#8A6D3B"},
    {"id": "nuclear", "code": "N900H", "label": "Nuclear heat", "color": "#9C6ADE"},
    {"id": "electricity", "code": "E7000", "label": "Electricity", "color": "#E6B325"},
    {"id": "heat", "code": "H8000", "label": "Heat", "color": "#D45353"},
]

COUNTRY_ORDER = ["EU27_2020", "DE", "FR", "PL", "SE", "NO", "ES", "IT", "NL"]

DISPLAY_NAMES = {
    "EU27_2020": "Europe",
}

TRANSFORMATIONS = {
    "power": {
        "label": "Power & heat plants",
        "inputs": ["TI_EHG_E"],
        "outputs": ["TO_EHG"],
    },
    "refineries": {
        "label": "Refineries",
        "inputs": ["TI_RPI_E"],
        "outputs": ["TO_RPI"],
    },
    "other": {
        "label": "Other transformation",
        "inputs": [
            "TI_CO_E", "TI_BF_E", "TI_GW_E", "TI_PF_E", "TI_BKBPB_E",
            "TI_CL_E", "TI_BNG_E", "TI_LBB_E", "TI_CPP_E", "TI_GTL_E", "TI_NSP_E",
        ],
        "outputs": [
            "TO_CO", "TO_BF", "TO_GW", "TO_PF", "TO_BKBPB", "TO_CL",
            "TO_BNG", "TO_LBB", "TO_CPP", "TO_GTL", "TO_NSP",
        ],
    },
}

SOURCE_META = {
    "production": "Primary production",
    "imports": "Imports",
    "stock_draw": "Stock draw",
    "other": "Recovered & recycled",
}

USE_META = {
    "industry": "Industry",
    "transport": "Transport",
    "households": "Residential",
    "services": "Commercial & public services",
    "other_final": "Other final consumption",
    "non_energy": "Non-energy use",
    "exports": "Exports",
    "other_energy": "Other energy flows",
}

USE_TARGET = {
    "industry": "industry",
    "transport": "transport",
    "households": "households",
    "services": "services",
    "agriculture_other": "other_final",
    "non_energy": "non_energy",
    "exports": "exports",
    "bunkers": "other_energy",
    "energy_own_use": "other_energy",
    "losses": "other_energy",
    "statistical": "other_energy",
}


class JsonStatCube:
    def __init__(self, payload: dict):
        self.payload = payload
        self.dimensions = payload["id"]
        self.sizes = payload["size"]
        self.indices = {
            name: info["category"]["index"]
            for name, info in payload["dimension"].items()
        }

    def get(self, **members):
        coordinates = []
        for name in self.dimensions:
            requested = members.get(name)
            if requested is None:
                index = 0
            else:
                index = self.indices[name].get(str(requested))
                if index is None:
                    return None
            coordinates.append(index)

        flat = 0
        for coordinate, size in zip(coordinates, self.sizes):
            flat = flat * size + coordinate
        values = self.payload.get("value", {})
        if isinstance(values, list):
            return values[flat] if flat < len(values) else None
        return values.get(str(flat))


def _sum(cube: JsonStatCube, flows: list[str], product: str) -> float:
    return sum(float(cube.get(nrg_bal=flow, siec=product) or 0) for flow in flows)


def extract_year(payload: dict) -> dict:
    cube = JsonStatCube(payload)
    year = int(next(iter(cube.indices["time"])))
    carriers = []
    for meta in CARRIERS:
        code = meta["code"]
        stock = float(cube.get(nrg_bal="STK_CHG", siec=code) or 0)
        statistical = float(cube.get(nrg_bal="STATDIFF", siec=code) or 0)
        industry = float(cube.get(nrg_bal="FC_IND_E", siec=code) or 0)
        transport = float(cube.get(nrg_bal="FC_TRA_E", siec=code) or 0)
        households = float(cube.get(nrg_bal="FC_OTH_HH_E", siec=code) or 0)
        services = float(cube.get(nrg_bal="FC_OTH_CP_E", siec=code) or 0)
        other_final = _sum(cube, ["FC_OTH_AF_E", "FC_OTH_FISH_E", "FC_OTH_NSP_E"], code)
        carriers.append({
            **meta,
            "sources": {
                "production": float(cube.get(nrg_bal="PPRD", siec=code) or 0),
                "imports": float(cube.get(nrg_bal="IMP", siec=code) or 0),
                "stock_draw": max(stock, 0),
                "other": float(cube.get(nrg_bal="RCV_RCY", siec=code) or 0),
            },
            "stock_build": max(-stock, 0),
            "transformation_inputs": {
                key: _sum(cube, spec["inputs"], code) for key, spec in TRANSFORMATIONS.items()
            },
            "transformation_outputs": {
                key: _sum(cube, spec["outputs"], code) for key, spec in TRANSFORMATIONS.items()
            },
            "uses": {
                "industry": industry,
                "transport": transport,
                "households": households,
                "services": services,
                "agriculture_other": other_final,
                "non_energy": float(cube.get(nrg_bal="FC_NE", siec=code) or 0),
                "exports": float(cube.get(nrg_bal="EXP", siec=code) or 0),
                "bunkers": _sum(cube, ["INTAVI", "INTMARB"], code),
                "energy_own_use": float(cube.get(nrg_bal="NRG_E", siec=code) or 0),
                "losses": float(cube.get(nrg_bal="DL", siec=code) or 0),
                "statistical": max(statistical, 0),
            },
            "statistical_inflow": max(-statistical, 0),
        })
    return {"year": year, "carriers": carriers}


def build_graph(raw: dict) -> dict:
    nodes = {}
    links = []

    def node(node_id, label, stage, kind, **extra):
        nodes.setdefault(node_id, {"id": node_id, "label": label, "stage": stage, "kind": kind, **extra})

    def link(source, target, value, carrier, kind):
        value = float(value or 0)
        if value > 1e-9:
            links.append({"source": source, "target": target, "value": round(value, 3), "carrier": carrier, "kind": kind})

    for key, label in SOURCE_META.items():
        node(f"source:{key}", label, 0, "source")
    for key, label in USE_META.items():
        node(f"use:{key}", label, 4, "sink")
    node("adjustment:source", "Balancing inflow", 0, "adjustment")

    for key, spec in TRANSFORMATIONS.items():
        node(f"transform:{key}", spec["label"], 2, "transformation")

    for carrier in raw["carriers"]:
        cid = carrier["id"]
        color = carrier["color"]
        supply_id = f"carrier:{cid}:supply"
        available_id = f"carrier:{cid}:available"
        node(supply_id, carrier["label"], 1, "carrier_supply", carrier=cid, color=color)
        node(available_id, carrier["label"], 3, "carrier_available", carrier=cid, color=color)

        source_total = 0.0
        for key, value in carrier["sources"].items():
            link(f"source:{key}", supply_id, value, cid, "source")
            source_total += value

        pre_fixed = carrier.get("stock_build", 0) + sum(carrier["transformation_inputs"].values())
        pass_through = max(source_total - pre_fixed, 0)
        if pre_fixed > source_total:
            link("adjustment:source", supply_id, pre_fixed - source_total, cid, "balance_adjustment")
        link(supply_id, "use:other_energy", carrier.get("stock_build", 0), cid, "other_energy")
        for key, value in carrier["transformation_inputs"].items():
            link(supply_id, f"transform:{key}", value, cid, "transformation_input")
        link(supply_id, available_id, pass_through, cid, "direct")

        available_in = pass_through + sum(carrier["transformation_outputs"].values()) + carrier.get("statistical_inflow", 0)
        for key, value in carrier["transformation_outputs"].items():
            link(f"transform:{key}", available_id, value, cid, "transformation_output")
        link("adjustment:source", available_id, carrier.get("statistical_inflow", 0), cid, "balance_adjustment")

        grouped_uses = {}
        for key, value in carrier["uses"].items():
            target = USE_TARGET[key]
            grouped_uses[target] = grouped_uses.get(target, 0.0) + value
        use_total = sum(grouped_uses.values())
        for target, value in grouped_uses.items():
            flow_kind = "export" if target == "exports" else "other_energy" if target == "other_energy" else "final_use"
            link(available_id, f"use:{target}", value, cid, flow_kind)
        if available_in > use_total:
            link(available_id, "use:other_energy", available_in - use_total, cid, "other_energy")
        elif use_total > available_in:
            link("adjustment:source", available_id, use_total - available_in, cid, "balance_adjustment")

    for key in TRANSFORMATIONS:
        node_id = f"transform:{key}"
        incoming = sum(item["value"] for item in links if item["target"] == node_id)
        outgoing = sum(item["value"] for item in links if item["source"] == node_id)
        if incoming > outgoing:
            link(node_id, "use:other_energy", incoming - outgoing, "mixed", "other_energy")
        elif outgoing > incoming:
            link("adjustment:source", node_id, outgoing - incoming, "mixed", "balance_adjustment")

    return {
        "year": raw["year"],
        "nodes": list(nodes.values()),
        "links": links,
        "carriers": [
            {k: item.get(k, "") for k in ("id", "code", "label", "color")}
            for item in raw["carriers"]
        ],
    }


def node_residuals(graph: dict) -> dict[str, float]:
    internal = {
        node["id"] for node in graph["nodes"]
        if node["kind"] in {"carrier_supply", "carrier_available", "transformation"}
    }
    incoming = {node_id: 0.0 for node_id in internal}
    outgoing = {node_id: 0.0 for node_id in internal}
    for item in graph["links"]:
        if item["target"] in incoming:
            incoming[item["target"]] += item["value"]
        if item["source"] in outgoing:
            outgoing[item["source"]] += item["value"]
    return {node_id: incoming[node_id] - outgoing[node_id] for node_id in internal}


def build_dataset(paths: list[Path]) -> dict:
    grouped = {}
    for path in paths:
        with Path(path).open(encoding="utf-8") as handle:
            payload = json.load(handle)
        geo_index = payload["dimension"]["geo"]["category"]["index"]
        geo_code = next(iter(geo_index))
        geo_labels = payload["dimension"]["geo"]["category"].get("label", {})
        country = grouped.setdefault(geo_code, {
            "id": geo_code,
            "name": DISPLAY_NAMES.get(geo_code, geo_labels.get(geo_code, geo_code)),
            "years": [],
        })
        country["years"].append(build_graph(extract_year(payload)))
    for country in grouped.values():
        country["years"].sort(key=lambda item: item["year"])
    countries = sorted(
        grouped.values(),
        key=lambda item: COUNTRY_ORDER.index(item["id"]) if item["id"] in COUNTRY_ORDER else len(COUNTRY_ORDER),
    )
    return {
        "meta": {
            "title": "European energy flow",
            "unit": "TJ",
            "source": "Eurostat complete energy balances (nrg_bal_c)",
            "generated": "2026-09-26",
        },
        "countries": countries,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    dataset = build_dataset([Path(item) for item in args.sources])
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dataset, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
