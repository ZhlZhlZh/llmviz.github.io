"""Build processed paper graph data from seed papers.

The script expands each seed paper with a balanced mix of references
(papers cited by the seed) and citations (papers citing the seed), then
writes nodes.json, edges.json, and institutions_geo.json.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import requests


S2_BASE_URL = "https://api.semanticscholar.org/graph/v1"
PAPER_FIELDS = ",".join(
    [
        "paperId",
        "title",
        "year",
        "abstract",
        "authors",
        "fieldsOfStudy",
        "s2FieldsOfStudy",
        "url",
        "citationCount",
        "venue",
        "publicationVenue",
    ]
)
RELATION_FIELDS = ",".join([f"citedPaper.{field}" for field in PAPER_FIELDS.split(",")])
RELATION_FIELDS_CITATIONS = ",".join([f"citingPaper.{field}" for field in PAPER_FIELDS.split(",")])


KNOWN_INSTITUTIONS: dict[str, dict[str, Any]] = {
    "OpenAI": {"city": "San Francisco", "country": "USA", "lat": 37.7749, "lng": -122.4194, "community": "english", "org_type": "research_lab"},
    "Google Research": {"city": "Mountain View", "country": "USA", "lat": 37.422, "lng": -122.0841, "community": "english", "org_type": "company"},
    "Google": {"city": "Mountain View", "country": "USA", "lat": 37.422, "lng": -122.0841, "community": "english", "org_type": "company"},
    "DeepMind": {"city": "London", "country": "UK", "lat": 51.5074, "lng": -0.1278, "community": "english", "org_type": "company"},
    "Google DeepMind": {"city": "London", "country": "UK", "lat": 51.5074, "lng": -0.1278, "community": "english", "org_type": "company"},
    "Anthropic": {"city": "San Francisco", "country": "USA", "lat": 37.7897, "lng": -122.3972, "community": "english", "org_type": "research_lab"},
    "Meta AI": {"city": "Menlo Park", "country": "USA", "lat": 37.4848, "lng": -122.1484, "community": "english", "org_type": "company"},
    "Facebook AI Research": {"city": "Menlo Park", "country": "USA", "lat": 37.4848, "lng": -122.1484, "community": "english", "org_type": "company"},
    "Microsoft Research": {"city": "Redmond", "country": "USA", "lat": 47.674, "lng": -122.1215, "community": "english", "org_type": "company"},
    "Microsoft": {"city": "Redmond", "country": "USA", "lat": 47.674, "lng": -122.1215, "community": "english", "org_type": "company"},
    "NVIDIA": {"city": "Santa Clara", "country": "USA", "lat": 37.3541, "lng": -121.9552, "community": "english", "org_type": "company"},
    "Stanford University": {"city": "Stanford", "country": "USA", "lat": 37.4275, "lng": -122.1697, "community": "english", "org_type": "university"},
    "UC Berkeley": {"city": "Berkeley", "country": "USA", "lat": 37.8715, "lng": -122.273, "community": "english", "org_type": "university"},
    "University of California, Berkeley": {"city": "Berkeley", "country": "USA", "lat": 37.8715, "lng": -122.273, "community": "english", "org_type": "university"},
    "MIT": {"city": "Cambridge", "country": "USA", "lat": 42.3601, "lng": -71.0942, "community": "english", "org_type": "university"},
    "MIT CSAIL": {"city": "Cambridge", "country": "USA", "lat": 42.3601, "lng": -71.0942, "community": "english", "org_type": "university"},
    "Carnegie Mellon University": {"city": "Pittsburgh", "country": "USA", "lat": 40.4433, "lng": -79.9436, "community": "english", "org_type": "university"},
    "University of Toronto": {"city": "Toronto", "country": "Canada", "lat": 43.6629, "lng": -79.3957, "community": "english", "org_type": "university"},
    "Mila": {"city": "Montreal", "country": "Canada", "lat": 45.5088, "lng": -73.5878, "community": "english", "org_type": "research_lab"},
    "University of Montreal": {"city": "Montreal", "country": "Canada", "lat": 45.5017, "lng": -73.5673, "community": "english", "org_type": "university"},
    "New York University": {"city": "New York", "country": "USA", "lat": 40.7295, "lng": -73.9965, "community": "english", "org_type": "university"},
    "Cornell University": {"city": "Ithaca", "country": "USA", "lat": 42.4534, "lng": -76.4735, "community": "english", "org_type": "university"},
    "Princeton University": {"city": "Princeton", "country": "USA", "lat": 40.3431, "lng": -74.6551, "community": "english", "org_type": "university"},
    "Tsinghua University": {"city": "Beijing", "country": "China", "lat": 39.9997, "lng": 116.3264, "community": "chinese", "org_type": "university"},
    "Peking University": {"city": "Beijing", "country": "China", "lat": 39.9928, "lng": 116.3055, "community": "chinese", "org_type": "university"},
    "Shanghai AI Lab": {"city": "Shanghai", "country": "China", "lat": 31.2304, "lng": 121.4737, "community": "chinese", "org_type": "research_lab"},
    "Chinese Academy of Sciences": {"city": "Beijing", "country": "China", "lat": 39.9042, "lng": 116.4074, "community": "chinese", "org_type": "research_lab"},
    "University of Oxford": {"city": "Oxford", "country": "UK", "lat": 51.7548, "lng": -1.2544, "community": "english", "org_type": "university"},
    "University of Cambridge": {"city": "Cambridge", "country": "UK", "lat": 52.2043, "lng": 0.1149, "community": "english", "org_type": "university"},
    "University College London": {"city": "London", "country": "UK", "lat": 51.5246, "lng": -0.134, "community": "english", "org_type": "university"},
    "EPFL": {"city": "Lausanne", "country": "Switzerland", "lat": 46.5191, "lng": 6.5668, "community": "english", "org_type": "university"},
    "ETH Zurich": {"city": "Zurich", "country": "Switzerland", "lat": 47.3763, "lng": 8.548, "community": "english", "org_type": "university"},
    "Allen Institute for AI": {"city": "Seattle", "country": "USA", "lat": 47.6062, "lng": -122.3321, "community": "english", "org_type": "research_lab"},
    "EleutherAI": {"city": "Distributed", "country": "Global", "lat": 20.0, "lng": 0.0, "community": "english", "org_type": "research_lab"},
    "Hugging Face": {"city": "New York", "country": "USA", "lat": 40.7128, "lng": -74.006, "community": "english", "org_type": "company"},
    "University of Tokyo": {"city": "Tokyo", "country": "Japan", "lat": 35.7126, "lng": 139.761, "community": "english", "org_type": "university"},
}

AUTHOR_INSTITUTION_HINTS = {
    "Alec Radford": "OpenAI",
    "Ilya Sutskever": "OpenAI",
    "Tom B. Brown": "OpenAI",
    "Dario Amodei": "Anthropic",
    "Amanda Askell": "Anthropic",
    "Jacob Devlin": "Google Research",
    "Ming-Wei Chang": "Google Research",
    "Kenton Lee": "Google Research",
    "Kristina Toutanova": "Google Research",
    "Ashish Vaswani": "Google Research",
    "Noam Shazeer": "Google Research",
    "Niki Parmar": "Google Research",
    "Jakob Uszkoreit": "Google Research",
    "Lukasz Kaiser": "Google Research",
    "Illia Polosukhin": "Google Research",
    "Albert Gu": "Carnegie Mellon University",
    "Tri Dao": "Princeton University",
    "Yann LeCun": "Meta AI",
    "Yoshua Bengio": "Mila",
    "Geoffrey E. Hinton": "University of Toronto",
    "Percy Liang": "Stanford University",
    "Dan Jurafsky": "Stanford University",
    "Christopher D. Manning": "Stanford University",
    "Dawn Song": "UC Berkeley",
    "Ion Stoica": "UC Berkeley",
}


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_institutions(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []


def stable_inst_id(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return f"inst_{slug[:48] or 'unknown'}"


def extract_topic(paper: dict[str, Any]) -> list[str]:
    topics: list[str] = []
    for item in paper.get("s2FieldsOfStudy") or []:
        if isinstance(item, dict) and item.get("category"):
            topics.append(item["category"])
    for item in paper.get("fieldsOfStudy") or []:
        if isinstance(item, str):
            topics.append(item)
    return sorted(set(topics)) or ["Computer Science"]


def extract_institutions_from_authors(authors: list[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for author in authors or []:
        name = author.get("name")
        if name in AUTHOR_INSTITUTION_HINTS:
            found.append(AUTHOR_INSTITUTION_HINTS[name])
        for aff in author.get("affiliations") or []:
            if isinstance(aff, str) and aff.strip():
                found.append(aff.strip())
        for aff in author.get("normalizedAffiliations") or []:
            if isinstance(aff, dict) and aff.get("rorDisplayName"):
                found.append(aff["rorDisplayName"])
    return sorted(set(found))


def publication_venue_name(paper: dict[str, Any]) -> str:
    venue = paper.get("publicationVenue")
    if isinstance(venue, dict) and venue.get("name"):
        return venue["name"]
    return paper.get("venue") or "Unknown"


def paper_to_node(paper: dict[str, Any], fallback_topic: Any = None) -> dict[str, Any] | None:
    paper_id = paper.get("paperId")
    title = paper.get("title")
    if not paper_id or not title:
        return None
    authors = paper.get("authors") or []
    topic = extract_topic(paper)
    if topic == ["Computer Science"] and fallback_topic:
        topic = fallback_topic if isinstance(fallback_topic, list) else [str(fallback_topic)]
    return {
        "id": paper_id,
        "title": title,
        "year": paper.get("year"),
        "abstract": paper.get("abstract"),
        "authors": [a.get("name") for a in authors if isinstance(a, dict) and a.get("name")],
        "topic": topic,
        "link": paper.get("url") or f"https://www.semanticscholar.org/paper/{paper_id}",
        "citations_count": paper.get("citationCount") or 0,
        "venue": publication_venue_name(paper),
        "institution": extract_institutions_from_authors(authors),
    }


def request_json(
    session: requests.Session,
    url: str,
    params: dict[str, Any],
    cache: dict[str, Any],
    delay: float,
    offline_cache_only: bool = False,
) -> Any:
    key = url + "?" + json.dumps(params, sort_keys=True)
    if key in cache:
        return cache[key]
    if offline_cache_only:
        return {}
    for attempt in range(4):
        response = session.get(url, params=params, timeout=30)
        if response.status_code == 429:
            wait = max(float(response.headers.get("Retry-After", 2)), delay) * (attempt + 1)
            time.sleep(wait)
            continue
        response.raise_for_status()
        data = response.json()
        cache[key] = data
        time.sleep(delay)
        return data
    response.raise_for_status()
    return None


def fetch_relation(
    session: requests.Session,
    seed: dict[str, Any],
    relation: str,
    limit: int,
    cache: dict[str, Any],
    delay: float,
    offline_cache_only: bool,
) -> list[dict[str, Any]]:
    if relation == "references":
        fields = RELATION_FIELDS
        paper_key = "citedPaper"
    else:
        fields = RELATION_FIELDS_CITATIONS
        paper_key = "citingPaper"
    url = f"{S2_BASE_URL}/paper/{seed['id']}/{relation}"
    params = {"limit": limit, "fields": fields}
    data = request_json(session, url, params, cache, delay, offline_cache_only)
    rows = data.get("data") if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    nodes = []
    for row in rows:
        paper = row.get(paper_key) if isinstance(row, dict) else None
        if isinstance(paper, dict):
            node = paper_to_node(paper, fallback_topic=seed.get("topic"))
            if node:
                nodes.append(node)
    return nodes


def value_score(node: dict[str, Any], seed_year: int | None, relation: str) -> float:
    citations = node.get("citations_count") or 0
    year = node.get("year")
    score = math.log1p(citations)
    if isinstance(year, int) and isinstance(seed_year, int):
        if relation == "references" and year <= seed_year:
            score += 1.25
        if relation == "citations" and year >= seed_year:
            score += 1.25
        score -= min(abs(year - seed_year), 20) * 0.03
    if node.get("abstract"):
        score += 0.2
    if node.get("venue") and node.get("venue") != "Unknown":
        score += 0.15
    return score


def choose_balanced_candidates(
    seeds: list[dict[str, Any]],
    candidates_by_seed: dict[str, dict[str, list[dict[str, Any]]]],
    target_count: int,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    seed_ids = {seed["id"] for seed in seeds}
    selected: dict[str, dict[str, Any]] = {}
    for seed in seeds:
        selected.setdefault(seed["id"], dict(seed))
    edges: set[tuple[str, str]] = set()

    ranked: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for seed in seeds:
        seed_id = seed["id"]
        for relation in ("references", "citations"):
            items = candidates_by_seed.get(seed_id, {}).get(relation, [])
            unique = {item["id"]: item for item in items if item.get("id") and item["id"] not in seed_ids}
            ranked[(seed_id, relation)] = sorted(
                unique.values(),
                key=lambda item: value_score(item, seed.get("year"), relation),
                reverse=True,
            )

    relation_order = ("references", "citations")
    cursor: Counter[tuple[str, str]] = Counter()
    made_progress = True
    while len(selected) < target_count and made_progress:
        made_progress = False
        for relation in relation_order:
            for seed in seeds:
                if len(selected) >= target_count:
                    break
                key = (seed["id"], relation)
                options = ranked[key]
                while cursor[key] < len(options):
                    candidate = options[cursor[key]]
                    cursor[key] += 1
                    candidate_id = candidate["id"]
                    if candidate_id in selected:
                        continue
                    selected[candidate_id] = candidate
                    if relation == "references":
                        edges.add((seed["id"], candidate_id))
                    else:
                        edges.add((candidate_id, seed["id"]))
                    made_progress = True
                    break

    # Preserve additional edges discovered while fetching, even for already selected papers.
    selected_ids = set(selected)
    for seed in seeds:
        seed_id = seed["id"]
        for relation in relation_order:
            for candidate in ranked[(seed_id, relation)]:
                candidate_id = candidate["id"]
                if candidate_id not in selected_ids:
                    continue
                if relation == "references":
                    edges.add((seed_id, candidate_id))
                else:
                    edges.add((candidate_id, seed_id))

    return list(selected.values()), [{"source": source, "target": target} for source, target in sorted(edges) if source != target]


def enrich_edges_from_references(
    session: requests.Session,
    nodes: list[dict[str, Any]],
    existing_edges: list[dict[str, str]],
    cache: dict[str, Any],
    delay: float,
    limit_per_paper: int,
    offline_cache_only: bool,
) -> list[dict[str, str]]:
    node_ids = {node["id"] for node in nodes}
    edges = {(edge["source"], edge["target"]) for edge in existing_edges}
    fields = "citedPaper.paperId"
    for index, node in enumerate(nodes, start=1):
        url = f"{S2_BASE_URL}/paper/{node['id']}/references"
        params = {"limit": limit_per_paper, "fields": fields}
        try:
            data = request_json(session, url, params, cache, delay, offline_cache_only)
        except requests.RequestException as exc:
            print(f"warn: link scan failed for {node['id']}: {exc}")
            continue
        rows = data.get("data") if isinstance(data, dict) else []
        for row in rows or []:
            cited = (row.get("citedPaper") or {}).get("paperId") if isinstance(row, dict) else None
            if cited in node_ids and cited != node["id"]:
                edges.add((node["id"], cited))
        if index % 50 == 0:
            print(f"scanned references for {index}/{len(nodes)} selected nodes")
    return [{"source": source, "target": target} for source, target in sorted(edges)]


def load_geo_seed(backup_geo_path: Path) -> dict[str, dict[str, Any]]:
    geo_by_name: dict[str, dict[str, Any]] = {}
    for row in load_json(backup_geo_path, default=[]) or []:
        name = row.get("institution")
        if name:
            geo_by_name[name] = {k: row.get(k) for k in ["city", "country", "lat", "lng", "community", "org_type"]}
    for name, value in KNOWN_INSTITUTIONS.items():
        geo_by_name.setdefault(name, value)
    return geo_by_name


def infer_institution(node: dict[str, Any]) -> str | None:
    for inst in normalize_institutions(node.get("institution")):
        if inst:
            return inst
    for author in node.get("authors") or []:
        if author in AUTHOR_INSTITUTION_HINTS:
            return AUTHOR_INSTITUTION_HINTS[author]
    return None


def build_institutions_geo(nodes: list[dict[str, Any]], backup_geo_path: Path | None) -> list[dict[str, Any]]:
    geo_by_name = load_geo_seed(backup_geo_path) if backup_geo_path else dict(KNOWN_INSTITUTIONS)
    stats: dict[str, dict[str, Any]] = {}
    for node in nodes:
        inst = infer_institution(node)
        if not inst:
            continue
        if inst not in stats:
            stats[inst] = {"papers_count": 0, "citations_count": 0}
        stats[inst]["papers_count"] += 1
        stats[inst]["citations_count"] += int(node.get("citations_count") or 0)

    rows = []
    max_papers = max((row["papers_count"] for row in stats.values()), default=1)
    max_citations = max((row["citations_count"] for row in stats.values()), default=1)
    for inst, stat in sorted(stats.items(), key=lambda item: item[1]["citations_count"], reverse=True):
        geo = geo_by_name.get(inst)
        if not geo:
            continue
        influence = 30 + 70 * (
            0.45 * stat["papers_count"] / max_papers
            + 0.55 * math.log1p(stat["citations_count"]) / math.log1p(max_citations)
        )
        rows.append(
            {
                "id": stable_inst_id(inst),
                "institution": inst,
                "city": geo["city"],
                "country": geo["country"],
                "lat": geo["lat"],
                "lng": geo["lng"],
                "community": geo.get("community", "english"),
                "org_type": geo.get("org_type", "unknown"),
                "papers_count": stat["papers_count"],
                "citations_count": stat["citations_count"],
                "influence_score": round(influence),
            }
        )
    return rows


def validate_seed_preservation(seed_nodes: list[dict[str, Any]], output_nodes: list[dict[str, Any]]) -> None:
    by_id = {node["id"]: node for node in output_nodes}
    unique_seed_nodes: dict[str, dict[str, Any]] = {}
    for seed in seed_nodes:
        unique_seed_nodes.setdefault(seed["id"], seed)
    missing = [seed_id for seed_id in unique_seed_nodes if seed_id not in by_id]
    if missing:
        raise ValueError(f"missing seed papers in nodes.json: {missing[:5]}")
    for seed in unique_seed_nodes.values():
        node = by_id[seed["id"]]
        for key, value in seed.items():
            if node.get(key) != value:
                raise ValueError(f"seed field changed for {seed['id']} field {key!r}: {node.get(key)!r} != {value!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", default="data/seeds/seed.json")
    parser.add_argument("--out-dir", default="data/processed")
    parser.add_argument("--backup-dir", default="")
    parser.add_argument("--cache", default="data/raw/semantic_scholar_cache.json")
    parser.add_argument("--target", type=int, default=500)
    parser.add_argument("--relation-limit", type=int, default=60)
    parser.add_argument("--link-scan-limit", type=int, default=30)
    parser.add_argument("--delay", type=float, default=1.05)
    parser.add_argument("--skip-link-scan", action="store_true", default=True)
    parser.add_argument("--with-link-scan", action="store_false", dest="skip_link_scan")
    parser.add_argument("--offline-cache-only", action="store_true")
    args = parser.parse_args()

    seed_path = Path(args.seed)
    out_dir = Path(args.out_dir)
    backup_dir = Path(args.backup_dir) if args.backup_dir else None
    cache_path = Path(args.cache)

    seeds = load_json(seed_path, default=[])
    if not seeds:
        raise SystemExit(f"no seed papers found at {seed_path}")

    cache = load_json(cache_path, default={}) or {}
    session = requests.Session()
    session.headers.update({"User-Agent": "llmviz-data-builder/1.0"})

    candidates_by_seed: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(dict)
    for index, seed in enumerate(seeds, start=1):
        seed_id = seed["id"]
        print(f"fetching seed {index}/{len(seeds)}: {seed.get('title', seed_id)}")
        for relation in ("references", "citations"):
            try:
                candidates_by_seed[seed_id][relation] = fetch_relation(
                    session, seed, relation, args.relation_limit, cache, args.delay, args.offline_cache_only
                )
            except requests.RequestException as exc:
                print(f"warn: {relation} failed for {seed_id}: {exc}")
                candidates_by_seed[seed_id][relation] = []
        if index % 10 == 0:
            write_json(cache_path, cache)

    nodes, edges = choose_balanced_candidates(seeds, candidates_by_seed, args.target)
    print(f"selected {len(nodes)} nodes and {len(edges)} seed relation edges")

    if not args.skip_link_scan:
        edges = enrich_edges_from_references(
            session, nodes, edges, cache, args.delay, args.link_scan_limit, args.offline_cache_only
        )
        print(f"after selected-node link scan: {len(edges)} edges")

    validate_seed_preservation(seeds, nodes)
    backup_geo_path = backup_dir / "institutions_geo.json" if backup_dir else None
    institutions_geo = build_institutions_geo(nodes, backup_geo_path)

    write_json(out_dir / "nodes.json", nodes)
    write_json(out_dir / "edges.json", edges)
    write_json(out_dir / "institutions_geo.json", institutions_geo)
    write_json(cache_path, cache)

    print(f"wrote {out_dir / 'nodes.json'} ({len(nodes)} records)")
    print(f"wrote {out_dir / 'edges.json'} ({len(edges)} records)")
    print(f"wrote {out_dir / 'institutions_geo.json'} ({len(institutions_geo)} records)")


if __name__ == "__main__":
    main()
