"""Build keyword_trends.json from OpenAlex yearly topic counts.

The theme-river chart expects records shaped as:
{"keyword": str, "year": int, "count": int}

The chart intentionally keeps the original OpenAlex group_by `count`
attribute so the y-axis can be read as yearly works count.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

import requests


OPENALEX_WORKS_URL = "https://api.openalex.org/works"
AI_CONCEPT_ID = "C154945302"
YEARS = list(range(2013, 2026))

# The upper-level buckets follow recurring axes in LLM surveys and
# foundation-model frameworks: pre-training, adaptation, utilization,
# evaluation, systems, data, and risks. The visible river stripes stay
# fine-grained so the chart reads as a dense topic flow.
SERIES = [
    {"keyword": "word embeddings", "source": "search", "query": "word embedding language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "sequence-to-sequence learning", "source": "search", "query": "sequence to sequence learning language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "attention mechanisms", "source": "search", "query": "attention mechanism language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "transformer architectures", "source": "search", "query": "transformer architecture", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "state space sequence models", "source": "search", "query": "state space sequence model language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "mixture-of-experts models", "source": "search", "query": "mixture of experts language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "pretraining objectives", "source": "search", "query": "pretraining objective language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "masked language modeling", "source": "search", "query": "masked language modeling", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "autoregressive language modeling", "source": "search", "query": "autoregressive language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "text-to-text transfer", "source": "search", "query": "text-to-text transfer transformer", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "foundation models", "source": "search", "query": "foundation model language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "open foundation models", "source": "search", "query": "open foundation model language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "scaling laws", "source": "search", "query": "scaling law language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "emergent abilities", "source": "search", "query": "emergent abilities language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "training data curation", "source": "search", "query": "training data curation language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "synthetic data", "source": "search", "query": "synthetic data language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "prompt engineering", "source": "search", "query": "prompt engineering language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "in-context learning", "source": "search", "query": "in-context learning language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "chain-of-thought reasoning", "source": "search", "query": "chain-of-thought reasoning", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "planning and reasoning", "source": "search", "query": "planning reasoning language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "LLM agents", "source": "search", "query": "large language model agent", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "retrieval augmented generation", "source": "search", "query": "retrieval augmented generation", "search_field": "title.search", "ai_only": True},
    {"keyword": "knowledge editing", "source": "search", "query": "knowledge editing language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "question answering", "source": "search", "query": "question answering language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "long-context modeling", "source": "search", "query": "long context language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "instruction tuning", "source": "search", "query": "instruction tuning language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "reinforcement learning from human feedback", "source": "search", "query": "reinforcement learning from human feedback language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "preference optimization", "source": "search", "query": "preference optimization language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "constitutional AI", "source": "search", "query": "constitutional AI language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "alignment and safety", "source": "search", "query": "alignment safety language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "evaluation benchmarks", "source": "search", "query": "evaluation benchmark large language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "hallucination and factuality", "source": "search", "query": "hallucination factuality language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "robustness and calibration", "source": "search", "query": "robustness calibration language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "interpretability", "source": "search", "query": "interpretability language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "bias and fairness", "source": "search", "query": "bias fairness language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "privacy and security", "source": "search", "query": "privacy security jailbreak language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "multimodal LLMs", "source": "search", "query": "multimodal large language model", "search_field": "title.search", "ai_only": True},
    {"keyword": "vision-language models", "source": "search", "query": "vision language model", "search_field": "title.search", "ai_only": True},
    {"keyword": "code language models", "source": "search", "query": "code language model program synthesis", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "domain-specific LLMs", "source": "search", "query": "domain specific large language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "medical LLMs", "source": "search", "query": "medical large language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "multilingual LLMs", "source": "search", "query": "multilingual large language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "parameter-efficient finetuning", "source": "search", "query": "parameter efficient fine tuning language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "LoRA and adapters", "source": "search", "query": "LoRA adapter language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "distillation and compression", "source": "search", "query": "distillation compression language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "quantization", "source": "search", "query": "quantization language model", "search_field": "abstract.search", "ai_only": True},
    {"keyword": "efficient inference and serving", "source": "search", "query": "efficient inference serving language model", "search_field": "abstract.search", "ai_only": True},
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
                    "count": counts[year],
                }
            )

    records.sort(key=lambda item: (item["keyword"], item["year"]))
    write_json(Path(args.out), records)
    write_json(cache_path, {"series": SERIES, "raw_counts": raw_summary, "responses": cache})
    print(f"wrote {args.out} ({len(records)} records)")
    print(f"wrote {args.cache}")


if __name__ == "__main__":
    main()
