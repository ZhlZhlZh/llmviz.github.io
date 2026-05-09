import argparse
import csv
import json
import re
from pathlib import Path

from build_processed_from_arxiv_ai import csv_path, parse_authors, parse_year, stable_id


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_PATH = ROOT / "data" / "raw" / "openalex_arxiv_cache.json"


def normalize_doi(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value)
    return value


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def build_targets() -> tuple[dict, dict]:
    by_doi = {}
    by_title = {}
    with csv_path().open("r", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            title = (row.get("title") or "").strip()
            year = parse_year(row.get("published", ""))
            authors = parse_authors(row.get("authors", ""))
            entry_id = (row.get("entry_id") or "").strip()
            node_id = stable_id(entry_id or f"{title}|{year}|{','.join(authors)}")
            doi = normalize_doi(row.get("doi", ""))
            title_key = normalize_title(title)
            target = {
                "node_id": node_id,
                "title": title,
                "year": year,
                "doi": doi,
                "title_key": title_key,
            }
            if doi:
                by_doi[doi] = target
            if title_key:
                by_title[title_key] = target
    return by_doi, by_title


def iter_metadata_files(paths: list[Path]):
    for path in paths:
        if path.is_file() and path.suffix == ".json":
            yield path
        elif path.is_dir():
            yield from sorted(path.rglob("*.json"))


def title_score(target: dict, work: dict) -> float:
    work_title = normalize_title(work.get("display_name") or work.get("title") or "")
    if not work_title:
        return 0.0
    if work_title == target["title_key"]:
        return 1.0
    a = set(target["title_key"].split())
    b = set(work_title.split())
    score = len(a & b) / max(len(a | b), 1)
    if target.get("year") and work.get("publication_year"):
        score -= min(abs(int(work["publication_year"]) - int(target["year"])), 5) * 0.03
    return score


def match_target(work: dict, by_doi: dict, by_title: dict) -> tuple[dict | None, str, float | None]:
    doi = normalize_doi(work.get("doi", ""))
    if doi and doi in by_doi:
        return by_doi[doi], "doi", 1.0
    title_key = normalize_title(work.get("display_name") or work.get("title") or "")
    if title_key in by_title:
        return by_title[title_key], "title_exact", 1.0
    best = None
    best_score = 0.0
    for target in by_title.values():
        if work.get("publication_year") and target.get("year") and abs(int(work["publication_year"]) - int(target["year"])) > 1:
            continue
        score = title_score(target, work)
        if score > best_score:
            best = target
            best_score = score
    if best and best_score >= 0.86:
        return best, "title_fuzzy", round(best_score, 4)
    return None, "", round(best_score, 4) if best_score else None


def slim_work(work: dict, matched_by: str, score: float | None) -> dict:
    return {
        "status": "matched",
        "matched_by": f"openalex_cli:{matched_by}",
        "match_score": score,
        "openalex_id": work.get("id", ""),
        "display_name": work.get("display_name") or work.get("title") or "",
        "doi": work.get("doi", ""),
        "publication_year": work.get("publication_year"),
        "cited_by_count": work.get("cited_by_count", 0),
        "referenced_works": work.get("referenced_works") or [],
        "ids": work.get("ids") or {},
    }


def load_cache(path: Path) -> dict:
    if not path.exists():
        return {
            "schema": 1,
            "source": "OpenAlex CLI metadata",
            "updated_at": None,
            "works": {},
        }
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Import metadata JSON files downloaded by openalex download into project cache.")
    parser.add_argument("paths", nargs="+", help="OpenAlex CLI output directories or metadata JSON files.")
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE_PATH), help="Cache JSON to update.")
    args = parser.parse_args()

    cache_path = Path(args.cache_path)
    if not cache_path.is_absolute():
        cache_path = ROOT / cache_path

    by_doi, by_title = build_targets()
    cache = load_cache(cache_path)
    works = cache.setdefault("works", {})
    scanned = 0
    imported = 0

    for path in iter_metadata_files([Path(item) for item in args.paths]):
        scanned += 1
        try:
            work = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        target, matched_by, score = match_target(work, by_doi, by_title)
        if not target:
            continue
        works[target["node_id"]] = slim_work(work, matched_by, score)
        imported += 1

    cache["source"] = "OpenAlex CLI metadata"
    cache["updated_at"] = None
    save_cache(cache_path, cache)
    print(f"scanned_json={scanned}")
    print(f"imported={imported}")
    print(f"cache={cache_path}")
    print(f"cached_total={len(works)}")


if __name__ == "__main__":
    main()
