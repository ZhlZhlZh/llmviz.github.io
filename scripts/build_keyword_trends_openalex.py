"""Build keyword_trends.json from OpenAlex yearly topic counts.

The theme-river chart expects records shaped as:
{"keyword": str, "year": int, "count": int}

OpenAlex counts can differ by orders of magnitude across broad and new
topics, so this script converts raw publication counts to a display
heat score with log1p scaling while keeping raw counts in the cache.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path
from typing import Any

import requests


OPENALEX_WORKS_URL = "https://api.openalex.org/works"
AI_CONCEPT_ID = "C154945302"
YEARS = list(range(2013, 2026))

SERIES = [
    {
        "keyword": "natural language processing",
        "source": "concept",
        "id": "C204321447",
    },
    {
        "keyword": "computer vision",
        "source": "concept",
        "id": "C31972630",
    },
    {
        "keyword": "deep learning",
        "source": "concept",
        "id": "C108583219",
    },
    {
        "keyword": "reinforcement learning",
        "source": "concept",
        "id": "C97541855",
    },
    {
        "keyword": "generative adversarial networks",
        "source": "concept",
        "id": "C2988773926",
    },
    {
        "keyword": "multimodal learning",
        "source": "concept",
        "id": "C2780660688",
    },
    {
        "keyword": "robotics",
        "source": "concept",
        "id": "C34413123",
    },
    {
        "keyword": "transformer models",
        "source": "search",
        "query": "transformer attention",
        "search_field": "title.search",
        "ai_only": True,
    },
    {
        "keyword": "diffusion models",
        "source": "search",
        "query": "diffusion model image",
        "search_field": "title.search",
        "ai_only": True,
    },
    {
        "keyword": "large language models",
        "source": "search",
        "query": "large language model",
        "search_field": "title.search",
        "ai_only": True,
    },
    {
        "keyword": "retrieval augmented generation",
        "source": "search",
        "query": "retrieval augmented generation",
        "search_field": "title.search",
        "ai_only": True,
    },
    {
        "keyword": "AI safety and alignment",
        "source": "search",
        "query": "AI alignment",
        "search_field": "abstract.search",
        "ai_only": True,
    },
]


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def openalex_id(value: str) -> str:
    return value.rsplit("/", 1)[-1]


def works_group_counts(
    session: requests.Session,
    params: dict[str, str],
    cache: dict[str, Any],
    delay: float,
) -> dict[int, int]:
    key = json.dumps({"url": OPENALEX_WORKS_URL, "params": params}, sort_keys=True)
    if key not in cache:
        response = session.get(OPENALEX_WORKS_URL, params=params, timeout=30)
        response.raise_for_status()
        cache[key] = response.json()
        time.sleep(delay)

    data = cache[key]
    result = {year: 0 for year in YEARS}
    for group in data.get("group_by", []) or []:
        try:
            year = int(group["key"])
        except (KeyError, TypeError, ValueError):
            continue
        if year in result:
            result[year] = int(group.get("count") or 0)
    return result


def filter_for_series(series: dict[str, Any], include_ai_filter: bool = True) -> str:
    filters = ["from_publication_date:2013-01-01", "to_publication_date:2025-12-31"]
    if series["source"] == "concept":
        filters.append(f"concepts.id:{openalex_id(series['id'])}")
    elif include_ai_filter and series.get("ai_only"):
        filters.append(f"concepts.id:{AI_CONCEPT_ID}")
    if series["source"] == "search":
        filters.append(f"{series.get('search_field', 'title.search')}:{series['query']}")
    return ",".join(filters)


def fetch_series_counts(
    session: requests.Session,
    series: dict[str, Any],
    cache: dict[str, Any],
    delay: float,
) -> dict[int, int]:
    params = {
        "filter": filter_for_series(series),
        "group_by": "publication_year",
        "per-page": "200",
    }
    counts = works_group_counts(session, params, cache, delay)
    if series["source"] == "search" and sum(counts.values()) == 0 and series.get("ai_only"):
        params["filter"] = filter_for_series(series, include_ai_filter=False)
        counts = works_group_counts(session, params, cache, delay)
    return counts


def heat_score(raw_count: int) -> int:
    if raw_count <= 0:
        return 0
    return max(1, round(math.log1p(raw_count) * 100))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data/processed/keyword_trends.json")
    parser.add_argument("--cache", default="data/raw/openalex_keyword_trends_cache.json")
    parser.add_argument("--delay", type=float, default=0.12)
    parser.add_argument("--mailto", default="")
    args = parser.parse_args()

    cache_path = Path(args.cache)
    cache = load_json(cache_path, default={})
    session = requests.Session()
    session.headers.update({"User-Agent": "llmviz-openalex-keyword-trends/1.0"})

    records = []
    raw_summary: dict[str, dict[str, int]] = {}

    for series in SERIES:
        print(f"fetching {series['keyword']}")
        counts = fetch_series_counts(session, series, cache, args.delay)
        raw_summary[series["keyword"]] = {str(year): counts[year] for year in YEARS}
        for year in YEARS:
            records.append(
                {
                    "keyword": series["keyword"],
                    "year": year,
                    "count": heat_score(counts[year]),
                }
            )

    records.sort(key=lambda item: (item["keyword"], item["year"]))
    write_json(Path(args.out), records)
    write_json(cache_path, {"series": SERIES, "raw_counts": raw_summary, "responses": cache})
    print(f"wrote {args.out} ({len(records)} records)")
    print(f"wrote {args.cache}")


if __name__ == "__main__":
    main()
