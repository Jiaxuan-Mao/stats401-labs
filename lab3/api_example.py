"""Acquire 2,000 television-show records from the TVmaze public API.

Install the dependency: python -m pip install requests
Run from the project root: python lab3/api_example.py
Source and pagination documentation: https://www.tvmaze.com/api
Data credit: TVmaze, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
This script selects records and flattens nested fields into a CSV subset.
Existing output files are protected; use --output with a new path to refresh.
"""

from __future__ import annotations

import argparse
import csv
import math
import time
from datetime import date
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import requests

API_URL = "https://api.tvmaze.com/shows"
DEFAULT_TARGET = 2_000
DEFAULT_DELAY = 1.0
OUTPUT_FIELDS = (
    "id", "name", "type", "language", "genres", "status", "premiered",
    "runtime_minutes", "rating", "network", "country", "show_url",
)
USER_AGENT = "STATS401-Lab3-Assignment/1.0 (educational use)"


def normalize_show(item: object) -> dict[str, object]:
    """Flatten show metadata without inventing values for missing fields."""
    if not isinstance(item, dict):
        raise ValueError("The API returned a record that is not a JSON object.")

    required_fields = (
        "id", "name", "type", "language", "genres", "status", "premiered",
        "runtime", "rating", "network", "webChannel", "url",
    )
    missing = [field for field in required_fields if field not in item]
    if missing:
        raise ValueError(f"API record is missing fields: {', '.join(missing)}")

    if type(item["id"]) is not int or item["id"] < 1:
        raise ValueError("A show must have a positive integer ID.")
    if not isinstance(item["name"], str) or not item["name"].strip():
        raise ValueError("A show must have a name.")
    link = urlparse(item["url"] or "")
    if link.scheme != "https" or link.hostname != "www.tvmaze.com":
        raise ValueError("Expected an HTTPS TVmaze show URL.")
    if not link.path.startswith(f"/shows/{item['id']}/"):
        raise ValueError("The show URL does not match its ID.")
    genres = item["genres"]
    if not isinstance(genres, list) or any(not isinstance(g, str) for g in genres):
        raise ValueError("Genres must be a list of strings.")
    if item["premiered"] is not None:
        date.fromisoformat(item["premiered"])

    rating = (item["rating"] or {}).get("average")
    runtime = item["runtime"]
    for label, value, maximum in (("rating", rating, 10), ("runtime", runtime, math.inf)):
        if value is not None and (
            type(value) not in (int, float) or not math.isfinite(value)
            or value < 0 or value > maximum
        ):
            raise ValueError(f"Invalid {label}: {value}")

    # Use the broadcast network, or the streaming platform when no network exists.
    network = item["network"] or item["webChannel"] or {}
    country = network.get("country") or {}
    return {
        "id": item["id"], "name": item["name"], "type": item["type"],
        "language": item["language"], "genres": " | ".join(genres) or None,
        "status": item["status"], "premiered": item["premiered"],
        "runtime_minutes": runtime, "rating": rating,
        "network": network.get("name"), "country": country.get("name"),
        "show_url": item["url"],
    }


def fetch_page(
    session: requests.Session,
    page: int,
    *,
    max_attempts: int = 3,
) -> list[object] | None:
    """Download one page, retrying temporary request failures."""
    for attempt in range(1, max_attempts + 1):
        try:
            response = session.get(
                API_URL,
                params={"page": page},
                timeout=15,
            )
            # TVmaze documents 404 as the end of its paginated show index.
            if response.status_code == 404:
                return None
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("The API response is not a JSON array.")
            return payload
        except requests.RequestException as error:
            if attempt == max_attempts:
                raise RuntimeError(
                    f"Page {page} failed after {max_attempts} attempts: {error}"
                ) from error
            if (error.response is not None
                    and 400 <= error.response.status_code < 500
                    and error.response.status_code != 429):
                raise RuntimeError(f"Page {page} was rejected: {error}") from error
            wait_seconds = attempt * 2
            if error.response is not None:
                retry_after = error.response.headers.get("Retry-After", "")
                if retry_after.isdigit():
                    wait_seconds = max(wait_seconds, int(retry_after))
            print(
                f"Page {page} request failed ({error}); "
                f"retrying in {wait_seconds} second(s)."
            )
            time.sleep(wait_seconds)

    raise AssertionError("Retry loop ended unexpectedly.")


def collect_shows(
    session: requests.Session,
    *,
    target: int = DEFAULT_TARGET,
    delay: float = DEFAULT_DELAY,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> list[dict[str, object]]:
    """Collect exactly ``target`` unique shows from zero-based API pages."""
    if target < 1:
        raise ValueError("target must be at least 1")
    if not math.isfinite(delay) or delay < 0:
        raise ValueError("delay cannot be negative")

    records: list[dict[str, object]] = []
    seen_ids: set[object] = set()
    page = 0

    while len(records) < target:
        if page >= 1000:
            raise RuntimeError("Stopped at the safety limit of 1,000 pages.")
        page_items = fetch_page(session, page)
        if page_items is None:
            raise RuntimeError(
                f"The API ended on page {page} with only {len(records)} records."
            )

        previous_count = len(records)
        for item in page_items:
            record = normalize_show(item)
            if record["id"] not in seen_ids:
                seen_ids.add(record["id"])
                records.append(record)
            if len(records) == target:
                break

        if page_items and len(records) == previous_count:
            raise RuntimeError("The API repeated a page without any new show IDs.")

        print(f"Downloaded page {page}: {len(records)}/{target} unique records")
        if len(records) < target:
            sleep_fn(delay)
            page += 1

    return records


def write_csv(records: list[dict[str, object]], output_path: Path) -> None:
    """Write validated records to a UTF-8 CSV file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(records)


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=project_root / "data" / "lab3_data.csv",
        help="CSV output path (default: data/lab3_data.csv)",
    )
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.output.exists():
        raise FileExistsError(f"Keep the existing dataset; choose a new --output path: {args.output}")
    with requests.Session() as session:
        session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
        records = collect_shows(
            session,
            target=args.target,
            delay=args.delay,
        )

    write_csv(records, args.output)
    print(f"Saved {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
