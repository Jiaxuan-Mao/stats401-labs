"""Lab 6 Part A: convert the provided GDP CSV to a hierarchical JSON file.

Run from any directory: python3 /path/to/Lab/lab6/convert_hierarchy.py
Requires pandas. The original CSV is never modified.
Source: https://github.com/hiilab/stats-401/blob/main/data/lab6_assignment_gdp.csv
"""

import json
import math
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEVELS = ["continent", "area", "country"]
STATUSES = {"Increase", "Unchanged", "Decrease"}


def validate_data(df):
    """Inspect the source before converting; reject ambiguous or invalid rows."""
    required = LEVELS + ["gdp_billion_usd", "gdp_status"]
    if not set(required).issubset(df.columns):
        raise ValueError("The CSV is missing a required GDP column.")
    print("Shape:", df.shape)
    print("Data types:\n", df.dtypes)
    print("Missing values:\n", df[required].isna().sum())
    print("Duplicate rows:", int(df.duplicated().sum()))
    print("Duplicate country paths:", int(df.duplicated(LEVELS).sum()))

    if df.empty or df[required].isna().any().any():
        raise ValueError("The dataset is empty or contains missing required values.")
    for column in LEVELS + ["gdp_status"]:
        if not df[column].map(lambda x: isinstance(x, str) and x.strip() == x and bool(x)).all():
            raise ValueError(f"Empty, non-text, or untrimmed label in {column}.")
    if df.duplicated(LEVELS).any():
        raise ValueError("Duplicate country paths would double-count GDP.")
    if not df["gdp_status"].isin(STATUSES).all():
        raise ValueError("GDP status must be Increase, Unchanged, or Decrease.")
    gdp = pd.to_numeric(df["gdp_billion_usd"], errors="raise")
    if not gdp.map(lambda x: math.isfinite(x) and x > 0).all():
        raise ValueError("This treemap requires finite, positive GDP values.")


def build_hierarchy(dataframe, levels):
    """Task 2: group one level, then recursively build its children."""
    if len(levels) == 1:
        return [
            {
                "name": row[levels[0]],
                "gdp": float(row["gdp_billion_usd"]),
                "status": row["gdp_status"],
            }
            for _, row in dataframe.iterrows()
        ]

    children = []
    for name, group in dataframe.groupby(levels[0], sort=True):
        children.append({
            "name": name,
            "children": build_hierarchy(group, levels[1:]),
        })
    return children


def main():
    source = PROJECT_ROOT / "data" / "lab6_assignment_gdp.csv"
    output = PROJECT_ROOT / "data" / "lab6_assignment_gdp.json"
    df = pd.read_csv(source)
    validate_data(df)
    hierarchy = {"name": "World", "children": build_hierarchy(df, LEVELS)}
    with output.open("w", encoding="utf-8") as file:
        json.dump(hierarchy, file, indent=2, ensure_ascii=False, allow_nan=False)
        file.write("\n")
    print(f"Saved {len(df)} countries to {output}")
    print(f"Total GDP: {df['gdp_billion_usd'].sum():,.0f} billion USD")


if __name__ == "__main__":
    main()
