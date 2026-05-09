import argparse
import csv
import gzip
import json
import re
import time
from pathlib import Path

from build_processed_from_arxiv_ai import csv_path, parse_authors, parse_year, stable_id


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_PATH = ROOT / "data" / "raw" / "openalex_arxiv_cache.json"


def normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def normalize_doi(value: str) -> str:
    value = (value or "").strip().lower()
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value)
    return value


def arxiv_id_from_entry(entry_id: str) -> str:
    value = (entry_id or "").strip().rstrip("/")
    if not value:
        return ""
    return re.sub(r"v\d+$", "", value.split("/")[-1].lower())


def normalize_openalex_id(value: str) -> str:
    return str(value or "").strip().replace("https://openalex.org/", "")


def iter_work_files(paths: list[Path]):
    for path in paths:
        if path.is_file() and path.suffix in {".gz", ".jsonl"}:
            yield path
        elif path.is_dir():
            yield from sorted(path.rglob("*.gz"))
            yield from sorted(path.rglob("*.jsonl"))


def iter_json_lines(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as file:
        for line in file:
            line = line.strip()
            if line:
                yield json.loads(line)


def build_targets() -> tuple[dict, dict, dict, dict]:
    by_doi = {}
    by_arxiv = {}
    by_title = {}
    target_rows = {}

    with csv_path().open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))

    for row in rows:
        title = (row.get("title") or "").strip()
        year = parse_year(row.get("published", ""))
        authors = parse_authors(row.get("authors", ""))
        entry_id = (row.get("entry_id") or "").strip()
        node_id = stable_id(entry_id or f"{title}|{year}|{','.join(authors)}")
        doi = normalize_doi(row.get("doi", ""))
        arxiv_id = arxiv_id_from_entry(entry_id)
        title_key = normalize_title(title)

        target_rows[node_id] = {
            "node_id": node_id,
            "title": title,
            "year": year,
            "doi": doi,
            "entry_id": entry_id,
            "arxiv_id": arxiv_id,
            "title_key": title_key,
            "title_compact": compact(title),
        }
        if doi:
            by_doi[doi] = node_id
        if arxiv_id:
            by_arxiv[arxiv_id] = node_id
        if title_key:
            by_title[title_key] = node_id

    return target_rows, by_doi, by_arxiv, by_title


def arxiv_ids_in_work(work: dict) -> set[str]:
    found = set()
    ids = work.get("ids") or {}
    for value in ids.values():
        value = str(value or "").lower()
        if "arxiv.org/abs/" in value or "arxiv.org/pdf/" in value:
            found.add(arxiv_id_from_entry(value))
    locations = [work.get("primary_location") or {}, *(work.get("locations") or [])]
    for location in locations:
        for key in ("landing_page_url", "pdf_url"):
            value = str(location.get(key) or "").lower()
            if "arxiv.org/abs/" in value or "arxiv.org/pdf/" in value:
                found.add(arxiv_id_from_entry(value))
    return {item for item in found if item}


def title_score(target: dict, work: dict) -> float:
    work_title = normalize_title(work.get("display_name", ""))
    if not work_title:
        return 0.0
    if work_title == target["title_key"]:
        return 1.0
    target_tokens = set(target["title_key"].split())
    work_tokens = set(work_title.split())
    overlap = len(target_tokens & work_tokens) / max(len(target_tokens | work_tokens), 1)
    if target.get("year") and work.get("publication_year"):
        overlap -= min(abs(int(work["publication_year"]) - int(target["year"])), 5) * 0.03
    return overlap


def find_target_node(work: dict, by_doi: dict, by_arxiv: dict, by_title: dict, targets: dict) -> tuple[str | None, str, float | None]:
    doi = normalize_doi(work.get("doi", ""))
    if doi and doi in by_doi:
        return by_doi[doi], "doi", 1.0

    for arxiv_id in arxiv_ids_in_work(work):
        if arxiv_id in by_arxiv:
            return by_arxiv[arxiv_id], "arxiv", 1.0

    title_key = normalize_title(work.get("display_name", ""))
    node_id = by_title.get(title_key)
    if node_id:
        return node_id, "title_exact", 1.0

    # Snapshot scanning is expensive, so use fuzzy title matching only against
    # same-year candidates when exact identifiers are absent.
    if not title_key:
        return None, "", None
    best_node = None
    best_score = 0.0
    work_year = work.get("publication_year")
    for target in targets.values():
        if work_year and target.get("year") and abs(int(work_year) - int(target["year"])) > 1:
            continue
        if not target["title_key"][:8] or target["title_key"][:8] not in title_key:
            continue
        score = title_score(target, work)
        if score > best_score:
            best_node = target["node_id"]
            best_score = score
    if best_score >= 0.86:
        return best_node, "title_fuzzy", round(best_score, 4)
    return None, "", round(best_score, 4) if best_score else None


def slim_work(work: dict, matched_by: str, match_score: float | None) -> dict:
    return {
        "status": "matched",
        "matched_by": matched_by,
        "match_score": match_score,
        "openalex_id": work.get("id", ""),
        "display_name": work.get("display_name", ""),
        "doi": work.get("doi", ""),
        "publication_year": work.get("publication_year"),
        "cited_by_count": work.get("cited_by_count", 0),
        "referenced_works": work.get("referenced_works") or [],
        "ids": work.get("ids") or {},
    }


def save_cache(path: Path, works: dict, scanned_files: int, scanned_works: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "schema": 1,
        "source": "OpenAlex works snapshot",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scanned_files": scanned_files,
        "scanned_works": scanned_works,
        "works": works,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build OpenAlex citation cache by scanning local works snapshot files.")
    parser.add_argument("paths", nargs="+", help="OpenAlex works snapshot directories or .gz/.jsonl files.")
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE_PATH), help="Output cache JSON path.")
    parser.add_argument("--save-every", type=int, default=20000, help="Save after this many scanned works.")
    parser.add_argument("--limit-files", type=int, default=None, help="Debug: scan only N files.")
    args = parser.parse_args()

    cache_path = Path(args.cache_path)
    if not cache_path.is_absolute():
        cache_path = ROOT / cache_path

    targets, by_doi, by_arxiv, by_title = build_targets()
    work_files = list(iter_work_files([Path(path) for path in args.paths]))
    if args.limit_files:
        work_files = work_files[: args.limit_files]

    works = {}
    scanned_works = 0
    scanned_files = 0
    for path in work_files:
        scanned_files += 1
        print(f"scan {scanned_files}/{len(work_files)} {path}")
        for work in iter_json_lines(path):
            scanned_works += 1
            node_id, matched_by, score = find_target_node(work, by_doi, by_arxiv, by_title, targets)
            if node_id and node_id not in works:
                works[node_id] = slim_work(work, matched_by, score)
                print(f"matched {len(works)}/{len(targets)} {matched_by} cites={works[node_id]['cited_by_count']} {targets[node_id]['title'][:90]}")
                if len(works) >= len(targets):
                    save_cache(cache_path, works, scanned_files, scanned_works)
                    print(f"complete cache={cache_path}")
                    return
            if args.save_every and scanned_works % args.save_every == 0:
                save_cache(cache_path, works, scanned_files, scanned_works)
        save_cache(cache_path, works, scanned_files, scanned_works)

    for node_id, target in targets.items():
        if node_id not in works:
            works[node_id] = {
                "status": "not_found",
                "matched_by": "snapshot",
                "match_score": None,
                "query": target,
            }
    save_cache(cache_path, works, scanned_files, scanned_works)
    print(f"finished cache={cache_path} matched={sum(1 for w in works.values() if w.get('status') == 'matched')} total={len(works)}")


if __name__ == "__main__":
    main()
