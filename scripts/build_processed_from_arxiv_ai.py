import ast
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSV_CANDIDATES = [ROOT / "arxiv_ai.csv", ROOT / "arxiv.ai.csv"]
PROCESSED_DIR = ROOT / "data" / "processed"
OPENALEX_CACHE_PATH = ROOT / "data" / "raw" / "openalex_arxiv_cache.json"


CATEGORY_LABELS = {
    "cs.AI": "Artificial Intelligence",
    "cs.CL": "Natural Language Processing",
    "cs.CV": "Computer Vision",
    "cs.LG": "Machine Learning",
    "cs.NE": "Neural and Evolutionary Computing",
    "cs.LO": "Logic in Computer Science",
    "cs.DB": "Databases",
    "cs.IR": "Information Retrieval",
    "cs.MA": "Multi-Agent Systems",
    "cs.RO": "Robotics",
    "cs.GT": "Game Theory",
    "cs.PL": "Programming Languages",
    "cs.CC": "Computational Complexity",
    "stat.ML": "Machine Learning",
}


HOTSPOT_TOPICS = [
    {
        "label": "Search and Planning",
        "terms": [
            "search", "planning", "planner", "plan recognition", "path finding",
            "heuristic", "backtracking", "sat", "satisfiability", "a star", "a*",
        ],
    },
    {
        "label": "Knowledge Representation and Reasoning",
        "terms": [
            "knowledge representation", "reasoning", "commonsense", "ontology",
            "description logic", "belief", "argumentation", "nonmonotonic",
            "answer set", "semantic web", "logic", "inference",
        ],
    },
    {
        "label": "Constraint Solving and Optimization",
        "terms": [
            "constraint", "optimization", "scheduling", "integer programming",
            "local search", "max-sat", "csp", "combinatorial", "solver",
        ],
    },
    {
        "label": "Machine Learning and Neural Networks",
        "terms": [
            "machine learning", "deep learning", "neural", "bayesian network",
            "classification", "clustering", "kernel", "supervised", "unsupervised",
            "representation learning", "graph neural", "gnn",
        ],
    },
    {
        "label": "Natural Language Processing and LLMs",
        "terms": [
            "natural language", "language model", "large language model", "llm",
            "transformer", "bert", "gpt", "question answering", "text",
            "dialogue", "dialog", "translation", "summarization", "chatbot",
        ],
    },
    {
        "label": "Computer Vision and Multimodal AI",
        "terms": [
            "computer vision", "image", "visual", "video", "multimodal",
            "multi-modal", "vision-language", "clip", "diffusion", "object detection",
        ],
    },
    {
        "label": "Multi-Agent Systems and Game AI",
        "terms": [
            "multi-agent", "multiagent", "agent", "game", "negotiation",
            "auction", "market", "mechanism design", "coordination", "cooperation",
        ],
    },
    {
        "label": "Robotics and Autonomous Systems",
        "terms": [
            "robot", "robotics", "autonomous", "navigation", "motion planning",
            "control", "vehicle", "manipulation", "swarm",
        ],
    },
    {
        "label": "Probabilistic and Causal AI",
        "terms": [
            "probabilistic", "bayesian", "markov", "uncertainty", "causal",
            "causality", "probability", "stochastic", "decision network",
        ],
    },
    {
        "label": "Data Mining and Information Retrieval",
        "terms": [
            "data mining", "information retrieval", "retrieval", "recommender",
            "recommendation", "web", "database", "ranking", "search engine",
        ],
    },
    {
        "label": "AI Safety, Ethics and Explainability",
        "terms": [
            "safety", "ethic", "fairness", "explainable", "explanation",
            "interpretability", "trustworthy", "privacy", "bias", "alignment",
        ],
    },
    {
        "label": "Reinforcement Learning and Decision Making",
        "terms": [
            "reinforcement learning", "policy", "reward", "decision making",
            "markov decision", "mdp", "q-learning", "bandit", "rl",
        ],
    },
]


AUTHOR_RE = re.compile(r"Author\('([^']+)'\)")
TOKEN_RE = re.compile(r"[a-z][a-z0-9\-]{2,}")
STOPWORDS = {
    "the", "and", "for", "with", "from", "using", "based", "this", "that",
    "into", "over", "under", "paper", "approach", "method", "model", "models",
    "system", "systems", "problem", "problems", "towards", "toward", "study",
    "analysis", "artificial", "intelligence",
}


def csv_path() -> Path:
    for path in CSV_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError("Expected arxiv_ai.csv or arxiv.ai.csv in the project root.")


def stable_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def normalize_openalex_id(value: str) -> str:
    return str(value or "").strip().replace("https://openalex.org/", "")


def load_openalex_cache() -> dict:
    works = {}
    paths = []
    if OPENALEX_CACHE_PATH.exists():
        paths.append(OPENALEX_CACHE_PATH)
    paths.extend(sorted((ROOT / "data" / "raw").glob("openalex_arxiv_cache.shard*.json")))
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        works.update(data.get("works", {}))
    return works


def parse_authors(value: str) -> list[str]:
    if not value:
        return []
    matches = AUTHOR_RE.findall(value)
    if matches:
        return [name.strip() for name in matches if name.strip()]
    try:
        parsed = ast.literal_eval(value)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except Exception:
        pass
    return [part.strip(" []'\"") for part in value.split(",") if part.strip(" []'\"")]


def parse_categories(value: str) -> list[str]:
    try:
        parsed = ast.literal_eval(value or "[]")
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except Exception:
        pass
    return [part.strip(" []'\"") for part in (value or "").split(",") if part.strip(" []'\"")]


def parse_year(value: str) -> int | None:
    match = re.match(r"(\d{4})", value or "")
    return int(match.group(1)) if match else None


def normalized_author(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def category_labels(categories: list[str], primary: str) -> list[str]:
    labels = []
    for code in [primary, *categories]:
        if not code:
            continue
        labels.append(CATEGORY_LABELS.get(code, code))
    return list(dict.fromkeys(labels))


def topic_matches(text: str, categories: list[str]) -> list[str]:
    lower = f" {text.lower()} "
    matched = []
    category_hint = set(categories)
    for topic in HOTSPOT_TOPICS:
        if any(term in lower for term in topic["terms"]):
            matched.append(topic["label"])
    if "cs.CL" in category_hint and "Natural Language Processing and LLMs" not in matched:
        matched.append("Natural Language Processing and LLMs")
    if "cs.CV" in category_hint and "Computer Vision and Multimodal AI" not in matched:
        matched.append("Computer Vision and Multimodal AI")
    if ("cs.LG" in category_hint or "stat.ML" in category_hint) and "Machine Learning and Neural Networks" not in matched:
        matched.append("Machine Learning and Neural Networks")
    if "cs.MA" in category_hint and "Multi-Agent Systems and Game AI" not in matched:
        matched.append("Multi-Agent Systems and Game AI")
    if "cs.LO" in category_hint and "Knowledge Representation and Reasoning" not in matched:
        matched.append("Knowledge Representation and Reasoning")
    return matched or ["General AI"]


def topical_terms(text: str, matched_topics: list[str]) -> list[str]:
    lower = text.lower()
    terms = []
    for topic in HOTSPOT_TOPICS:
        if topic["label"] not in matched_topics:
            continue
        for term in topic["terms"]:
            if term in lower:
                terms.append(term)
    tokens = [
        token for token in TOKEN_RE.findall(lower)
        if token not in STOPWORDS and len(token) > 3
    ]
    top_tokens = [token for token, _ in Counter(tokens).most_common(4)]
    return list(dict.fromkeys([*matched_topics, *terms[:5], *top_tokens]))[:10]


def truncate(text: str, limit: int = 620) -> str:
    clean = re.sub(r"\s+", " ", text or "").strip()
    return clean if len(clean) <= limit else clean[: limit - 3].rstrip() + "..."


def build_nodes(rows: list[dict], openalex_cache: dict | None = None) -> list[dict]:
    openalex_cache = openalex_cache or {}
    author_counts = Counter()
    year_topic_counts = Counter()
    parsed_rows = []
    years = []

    for row in rows:
        year = parse_year(row.get("published", ""))
        if not year:
            continue
        title = (row.get("title") or "").strip()
        if not title:
            continue
        authors = parse_authors(row.get("authors", ""))
        categories = parse_categories(row.get("categories", ""))
        primary = (row.get("primary_category") or "").strip() or (categories[0] if categories else "cs.AI")
        text = f"{title} {row.get('summary') or ''} {' '.join(categories)}"
        topics = topic_matches(text, categories)
        for author in authors:
            author_counts[normalized_author(author)] += 1
        for topic in topics:
            year_topic_counts[(year, topic)] += 1
        years.append(year)
        parsed_rows.append((row, year, title, authors, categories, primary, topics, text))

    min_year = min(years)
    max_year = max(years)
    nodes = []
    for row, year, title, authors, categories, primary, topics, text in parsed_rows:
        topic_popularity = sum(year_topic_counts[(year, topic)] for topic in topics)
        author_signal = sum(min(author_counts[normalized_author(author)], 24) for author in authors[:6])
        metadata_bonus = 12 if row.get("doi") else 0
        metadata_bonus += 8 if row.get("journal_ref") else 0
        recency = 1 + ((year - min_year) / max(max_year - min_year, 1)) * 9
        hotness = round(
            6
            + math.sqrt(max(topic_popularity, 1)) * 3.6
            + math.log1p(max(author_signal, 0)) * 5.5
            + recency
            + metadata_bonus
        )
        entry_id = (row.get("entry_id") or "").strip()
        node_id = stable_id(entry_id or f"{title}|{year}|{','.join(authors)}")
        openalex = openalex_cache.get(node_id) or {}
        has_openalex = openalex.get("status") == "matched"
        cited_by_count = int(openalex.get("cited_by_count") or 0) if has_openalex else 0
        nodes.append({
            "id": node_id,
            "title": title,
            "year": year,
            "abstract": truncate(row.get("summary") or ""),
            "authors": authors,
            "topic": category_labels(categories, primary),
            "keywords": topical_terms(text, topics),
            "link": entry_id or (row.get("pdf_url") or "").strip(),
            "pdf_url": (row.get("pdf_url") or "").strip(),
            "doi": (row.get("doi") or "").strip(),
            "entry_id": entry_id,
            "primary_category": primary,
            "categories": categories,
            "published": row.get("published", ""),
            "updated": row.get("updated", ""),
            "journal_ref": row.get("journal_ref", ""),
            "citations_count": cited_by_count,
            "hotness_score": hotness,
            "citation_source": "OpenAlex" if has_openalex else "unmatched",
            "openalex_id": openalex.get("openalex_id", "") if has_openalex else "",
            "openalex_match": {
                "status": openalex.get("status", "missing"),
                "matched_by": openalex.get("matched_by", ""),
                "match_score": openalex.get("match_score"),
                "display_name": openalex.get("display_name", ""),
            },
            "venue": row.get("journal_ref") or primary or "arXiv",
            "institution": ["arXiv AI Metadata Corpus"],
        })

    return sorted(nodes, key=lambda item: (item["year"], item["title"].lower()))


def node_terms(node: dict) -> set[str]:
    return {
        re.sub(r"\s+", " ", term.lower()).strip()
        for term in [*node.get("keywords", []), *node.get("topic", []), node.get("primary_category", "")]
        if term
    }


def build_edges(nodes: list[dict]) -> list[dict]:
    history_by_topic = defaultdict(list)
    history_by_category = defaultdict(list)
    history_by_author = defaultdict(list)
    terms_by_id = {node["id"]: node_terms(node) for node in nodes}
    authors_by_id = {
        node["id"]: {normalized_author(author) for author in node.get("authors", []) if normalized_author(author)}
        for node in nodes
    }
    edges = []
    seen = set()

    for index, node in enumerate(nodes):
        candidates = set()
        node_id = node["id"]
        for topic in node.get("keywords", [])[:4]:
            candidates.update(history_by_topic[topic][-28:])
        for category in node.get("categories", [])[:3]:
            candidates.update(history_by_category[category][-18:])
        for author in authors_by_id[node_id]:
            candidates.update(history_by_author[author][-18:])

        scored = []
        for target_id in candidates:
            if target_id == node_id:
                continue
            target = nodes_by_id[target_id]
            if target["year"] > node["year"]:
                continue
            shared_terms = len(terms_by_id[node_id] & terms_by_id[target_id])
            shared_authors = len(authors_by_id[node_id] & authors_by_id[target_id])
            same_primary = int(node.get("primary_category") == target.get("primary_category"))
            score = shared_authors * 12 + shared_terms * 3 + same_primary * 2
            score -= min(max(node["year"] - target["year"], 0), 12) * 0.12
            if score >= 5:
                scored.append((score, target.get("hotness_score", 0), target_id))

        for _, _, target_id in sorted(scored, reverse=True)[:3]:
            key = (node_id, target_id)
            if key in seen:
                continue
            seen.add(key)
            edges.append({"source": node_id, "target": target_id})

        for topic in node.get("keywords", [])[:4]:
            history_by_topic[topic].append(node_id)
        for category in node.get("categories", [])[:3]:
            history_by_category[category].append(node_id)
        for author in authors_by_id[node_id]:
            history_by_author[author].append(node_id)

    return edges


def build_openalex_edges(nodes: list[dict], openalex_cache: dict | None = None) -> list[dict]:
    openalex_cache = openalex_cache or {}
    openalex_to_node_id = {}
    for node in nodes:
        work = openalex_cache.get(node["id"]) or {}
        if work.get("status") != "matched":
            continue
        openalex_id = normalize_openalex_id(work.get("openalex_id"))
        if openalex_id:
            openalex_to_node_id[openalex_id] = node["id"]

    edges = []
    seen = set()
    for node in nodes:
        work = openalex_cache.get(node["id"]) or {}
        if work.get("status") != "matched":
            continue
        for ref in work.get("referenced_works") or []:
            target_id = openalex_to_node_id.get(normalize_openalex_id(ref))
            if not target_id or target_id == node["id"]:
                continue
            key = (node["id"], target_id)
            if key in seen:
                continue
            seen.add(key)
            edges.append({
                "source": node["id"],
                "target": target_id,
                "relation": "cites",
                "source_openalex_id": work.get("openalex_id", ""),
                "target_openalex_id": ref,
            })
    return edges


def build_keyword_trends(nodes: list[dict]) -> list[dict]:
    years = list(range(min(node["year"] for node in nodes), max(node["year"] for node in nodes) + 1))
    topic_labels = [topic["label"] for topic in HOTSPOT_TOPICS] + ["General AI"]
    counts = Counter()
    for node in nodes:
        labels = [kw for kw in node.get("keywords", []) if kw in topic_labels]
        for label in labels or ["General AI"]:
            counts[(label, node["year"])] += 1
    totals = Counter()
    for (label, _year), count in counts.items():
        totals[label] += count
    selected = [label for label, _ in totals.most_common(12)]
    return [
        {"keyword": label, "year": year, "count": counts[(label, year)]}
        for label in selected
        for year in years
    ]


def build_institutions(nodes: list[dict]) -> tuple[list[dict], list[dict]]:
    total_citations = sum(node.get("citations_count", 0) for node in nodes)
    total_hotness = sum(node.get("hotness_score", 0) for node in nodes)
    institution = {
        "id": "inst_arxiv_ai_metadata_corpus",
        "institution": "arXiv AI Metadata Corpus",
        "city": "Ithaca",
        "country": "United States",
        "lat": 42.444,
        "lng": -76.5019,
        "org_type": "research_lab",
        "community": "international",
        "papers_count": len(nodes),
        "citations_count": total_citations,
        "influence_score": round((total_citations or total_hotness) / max(len(nodes), 1), 2),
    }
    aliases = [{
        "canonical": "arXiv AI Metadata Corpus",
        "aliases": ["arXiv.org", "Cornell arXiv", "arXiv AI Corpus"],
    }]
    return [institution], aliases


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")


def main() -> None:
    source = csv_path()
    with source.open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))

    openalex_cache = load_openalex_cache()
    nodes = build_nodes(rows, openalex_cache)
    global nodes_by_id
    nodes_by_id = {node["id"]: node for node in nodes}
    edges = build_openalex_edges(nodes, openalex_cache)
    keyword_trends = build_keyword_trends(nodes)
    institutions, aliases = build_institutions(nodes)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    write_json(PROCESSED_DIR / "nodes.json", nodes)
    write_json(PROCESSED_DIR / "edges.json", edges)
    write_json(PROCESSED_DIR / "keyword_trends.json", keyword_trends)
    write_json(PROCESSED_DIR / "institutions_geo.json", institutions)
    write_json(PROCESSED_DIR / "institution_aliases.json", aliases)

    print(f"source={source.name}")
    print(f"nodes={len(nodes)}")
    print(f"edges={len(edges)}")
    print(f"openalex_cache={len(openalex_cache)}")
    print(f"openalex_matched={sum(1 for node in nodes if node.get('citation_source') == 'OpenAlex')}")
    print(f"keyword_trends={len(keyword_trends)} rows")
    print(f"years={nodes[0]['year']}-{nodes[-1]['year']}")
    print("top_topics=" + ", ".join(
        f"{label}:{sum(row['count'] for row in keyword_trends if row['keyword'] == label)}"
        for label in list(dict.fromkeys(row["keyword"] for row in keyword_trends))[:8]
    ))


nodes_by_id = {}


if __name__ == "__main__":
    main()
