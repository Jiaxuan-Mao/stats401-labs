import importlib.util
import json
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "build_energy_data.py"
SPEC = importlib.util.spec_from_file_location("build_energy_data", MODULE_PATH)
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


def jsonstat_fixture():
    # Dimensions are deliberately ordered unlike the display labels. Values are
    # sparse, matching Eurostat's JSON-stat2 response format.
    return {
        "id": ["freq", "nrg_bal", "siec", "unit", "geo", "time"],
        "size": [1, 2, 2, 1, 1, 1],
        "dimension": {
            "freq": {"category": {"index": {"A": 0}}},
            "nrg_bal": {"category": {"index": {"PPRD": 0, "IMP": 1}}},
            "siec": {"category": {"index": {"G3000": 0, "E7000": 1}}},
            "unit": {"category": {"index": {"TJ": 0}}},
            "geo": {"category": {"index": {"DE": 0}}},
            "time": {"category": {"index": {"2023": 0}}},
        },
        "value": {"0": 100.0, "1": 5.0, "2": 20.0},
    }


class JsonStatTests(unittest.TestCase):
    def test_lookup_decodes_sparse_flat_indices(self):
        cube = builder.JsonStatCube(jsonstat_fixture())
        self.assertEqual(cube.get(nrg_bal="PPRD", siec="G3000"), 100.0)
        self.assertEqual(cube.get(nrg_bal="PPRD", siec="E7000"), 5.0)
        self.assertEqual(cube.get(nrg_bal="IMP", siec="G3000"), 20.0)
        self.assertIsNone(cube.get(nrg_bal="IMP", siec="E7000"))

    def test_unknown_dimension_member_is_missing_not_zero(self):
        cube = builder.JsonStatCube(jsonstat_fixture())
        self.assertIsNone(cube.get(nrg_bal="NO_SUCH_FLOW", siec="G3000"))


class SankeyBuildTests(unittest.TestCase):
    def test_carrier_selection_has_no_overlapping_parent_aggregates(self):
        codes = [item["code"] for item in builder.CARRIERS]
        self.assertEqual(len(codes), 8)
        self.assertEqual(len(codes), len(set(codes)))
        self.assertNotIn("TOTAL", codes)
        self.assertNotIn("C0000", codes)

    def test_balance_adjustment_makes_every_internal_node_conserve_flow(self):
        raw = {
            "year": 2023,
            "carriers": [
                {
                    "id": "gas",
                    "label": "Natural gas",
                    "color": "#168aad",
                    "sources": {"production": 20, "imports": 90, "stock_draw": 0, "other": 0},
                    "transformation_inputs": {"power": 30, "refineries": 0, "other": 5},
                    "transformation_outputs": {"power": 0, "refineries": 0, "other": 0},
                    "uses": {"industry": 25, "transport": 2, "households": 30, "services": 12,
                             "agriculture_other": 3, "non_energy": 3, "exports": 0, "bunkers": 0,
                             "energy_own_use": 3, "losses": 1, "statistical": 0},
                }
            ],
        }
        graph = builder.build_graph(raw)
        self.assertTrue(all(link["value"] >= 0 for link in graph["links"]))
        residuals = builder.node_residuals(graph)
        self.assertTrue(all(abs(value) < 1e-9 for value in residuals.values()), residuals)
        self.assertTrue(any(link["kind"] == "balance_adjustment" for link in graph["links"]))

    def test_right_side_uses_original_iea_style_categories(self):
        raw = {
            "year": 2023,
            "carriers": [
                {
                    "id": "gas", "label": "Natural gas", "color": "#168aad",
                    "sources": {"production": 20, "imports": 72, "stock_draw": 0, "other": 0},
                    "stock_build": 2,
                    "transformation_inputs": {"power": 0, "refineries": 0, "other": 0},
                    "transformation_outputs": {"power": 0, "refineries": 0, "other": 0},
                    "uses": {
                        "industry": 25, "transport": 2, "households": 30, "services": 12,
                        "agriculture_other": 3, "non_energy": 3, "exports": 4, "bunkers": 5,
                        "energy_own_use": 3, "losses": 1, "statistical": 2,
                    },
                }
            ],
        }
        graph = builder.build_graph(raw)
        sink_labels = {node["label"] for node in graph["nodes"] if node["kind"] == "sink"}
        self.assertEqual(sink_labels, {
            "Industry", "Transport", "Residential", "Commercial & public services",
            "Other final consumption", "Non-energy use", "Exports", "Other energy flows",
        })
        final_links = [link for link in graph["links"] if link["source"] == "carrier:gas:available"]
        by_target = {}
        for link in final_links:
            by_target[link["target"]] = by_target.get(link["target"], 0) + link["value"]
        self.assertEqual(by_target["use:other_final"], 3)
        self.assertEqual(by_target["use:other_energy"], 11)

    def test_builds_europe_and_eight_countries_with_continuous_2019_to_2023_sequences(self):
        project = Path(__file__).parents[1]
        sources = sorted((project / "data/source").glob("nrg_bal_c_*.json"))
        self.assertEqual(len(sources), 45, "Europe plus eight countries times five years must be present")
        dataset = builder.build_dataset(sources)
        self.assertEqual(
            [country["id"] for country in dataset["countries"]],
            ["EU27_2020", "DE", "FR", "PL", "SE", "NO", "ES", "IT", "NL"],
        )
        self.assertEqual(dataset["countries"][0]["name"], "Europe")
        for country in dataset["countries"]:
            self.assertEqual([item["year"] for item in country["years"]], [2019, 2020, 2021, 2022, 2023])
            for year in country["years"]:
                self.assertTrue(all(link["value"] >= 0 for link in year["links"]))
                self.assertTrue(all(abs(v) < 0.01 for v in builder.node_residuals(year).values()))


if __name__ == "__main__":
    unittest.main()
