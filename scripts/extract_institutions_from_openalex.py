"""
从 openalex_cli_work_metadata 目录中的原始 Work JSON 提取机构信息，
更新 nodes.json 的 institution 字段，并重建 institutions_geo.json 和 institution_aliases.json。
"""

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA_DIR = ROOT / "data" / "raw" / "openalex_cli_work_metadata"
NODES_PATH = ROOT / "data" / "processed" / "nodes.json"
INSTITUTIONS_GEO_PATH = ROOT / "data" / "processed" / "institutions_geo.json"
ALIASES_PATH = ROOT / "data" / "processed" / "institution_aliases.json"
OPENALEX_CACHE_PATH = ROOT / "data" / "raw" / "openalex_arxiv_cache.json"


# 国家代码 -> 坐标（首都/主要城市近似）
COUNTRY_COORDS = {
    "US": (38.9, -77.0), "GB": (51.5, -0.1), "CN": (39.9, 116.4),
    "CA": (45.4, -75.7), "DE": (52.5, 13.4), "FR": (48.9, 2.3),
    "JP": (35.7, 139.7), "AU": (33.9, 151.2), "IN": (28.6, 77.2),
    "KR": (37.6, 127.0), "IL": (32.1, 34.8), "NL": (52.4, 4.9),
    "CH": (47.4, 8.5), "IT": (41.9, 12.5), "SG": (1.35, 103.8),
    "SE": (59.3, 18.1), "HK": (22.3, 114.2), "ES": (40.4, -3.7),
    "BR": (23.5, -46.6), "AT": (48.2, 16.4), "DK": (55.7, 12.6),
    "FI": (60.2, 24.9), "NO": (59.9, 10.7), "BE": (50.8, 4.4),
    "IE": (53.3, -6.3), "PT": (38.7, -9.1), "PL": (52.2, 21.0),
    "CZ": (50.1, 14.4), "TW": (25.0, 121.5), "RU": (55.8, 37.6),
    "NZ": (41.3, 174.8), "SA": (24.7, 46.7), "AE": (25.2, 55.3),
    "GR": (37.98, 23.73), "TR": (39.93, 32.86), "MX": (19.43, -99.13),
    "AR": (34.6, -58.4), "CL": (33.4, -70.6), "ZA": (33.9, 18.4),
}

# 机构类型映射
TYPE_MAP = {
    "education": "university",
    "company": "company",
    "facility": "research_lab",
    "government": "research_lab",
    "healthcare": "research_lab",
    "nonprofit": "research_lab",
    "other": "research_lab",
}

# 社区分类
CHINESE_COUNTRIES = {"CN", "HK", "TW"}


def normalize_openalex_id(value):
    return str(value or "").strip().replace("https://openalex.org/", "")


def load_openalex_to_node_map():
    """建立 openalex_id -> node_id 的映射"""
    cache = json.loads(OPENALEX_CACHE_PATH.read_text(encoding="utf-8"))
    works = cache.get("works", {})
    # 也加载 shard 文件
    for shard in sorted((ROOT / "data" / "raw").glob("openalex_arxiv_cache.shard*.json")):
        shard_data = json.loads(shard.read_text(encoding="utf-8"))
        works.update(shard_data.get("works", {}))

    oa_to_node = {}
    for node_id, work in works.items():
        if work.get("status") == "matched":
            oa_id = normalize_openalex_id(work.get("openalex_id", ""))
            if oa_id:
                oa_to_node[oa_id] = node_id
    return oa_to_node


def extract_institutions_from_metadata():
    """从原始 Work JSON 中提取机构信息"""
    # openalex_id -> list of institutions
    work_institutions = {}

    for path in sorted(METADATA_DIR.glob("W*.json")):
        try:
            work = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        oa_id = normalize_openalex_id(work.get("id", ""))
        if not oa_id:
            continue

        institutions = set()
        for authorship in work.get("authorships", []):
            for inst in authorship.get("institutions", []):
                name = inst.get("display_name", "").strip()
                if name:
                    institutions.add((
                        name,
                        inst.get("country_code", ""),
                        inst.get("type", "education"),
                        normalize_openalex_id(inst.get("id", "")),
                    ))

        if institutions:
            work_institutions[oa_id] = list(institutions)

    return work_institutions


def main():
    print("加载 OpenAlex -> node_id 映射...")
    oa_to_node = load_openalex_to_node_map()
    print(f"  映射条目: {len(oa_to_node)}")

    print("从原始 Work JSON 提取机构...")
    work_institutions = extract_institutions_from_metadata()
    print(f"  有机构信息的 Work: {len(work_institutions)}")

    # 加载 nodes.json
    print("加载 nodes.json...")
    nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    node_by_id = {n["id"]: n for n in nodes}

    # 更新 nodes 的 institution 字段
    updated_count = 0
    # 统计机构出现次数
    inst_stats = defaultdict(lambda: {
        "papers_count": 0,
        "citations_count": 0,
        "country_code": "",
        "org_type": "education",
        "openalex_inst_id": "",
    })

    for oa_id, inst_list in work_institutions.items():
        node_id = oa_to_node.get(oa_id)
        if not node_id or node_id not in node_by_id:
            continue

        node = node_by_id[node_id]
        inst_names = []
        for name, country, org_type, inst_oa_id in inst_list:
            inst_names.append(name)
            stats = inst_stats[name]
            stats["papers_count"] += 1
            stats["citations_count"] += node.get("citations_count", 0)
            if not stats["country_code"]:
                stats["country_code"] = country
            if not stats["org_type"]:
                stats["org_type"] = org_type
            if not stats["openalex_inst_id"]:
                stats["openalex_inst_id"] = inst_oa_id

        # 去重并更新
        node["institution"] = list(dict.fromkeys(inst_names))[:5]
        updated_count += 1

    # 对没有匹配到的节点，清空占位机构
    for node in nodes:
        if node.get("institution") == ["arXiv AI Metadata Corpus"]:
            node["institution"] = []

    print(f"  更新了 {updated_count} 个节点的机构字段")

    # 写回 nodes.json
    NODES_PATH.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"✓ nodes.json 已更新")

    # 构建 institutions_geo.json
    # 只保留出现次数 >= 3 的机构（避免太多长尾）
    MIN_PAPERS = 3
    qualified = {name: stats for name, stats in inst_stats.items() if stats["papers_count"] >= MIN_PAPERS}
    print(f"  符合条件的机构 (papers >= {MIN_PAPERS}): {len(qualified)}")

    # 按引用数排序，取 top 50
    top_institutions = sorted(qualified.items(), key=lambda x: -x[1]["citations_count"])[:50]

    max_citations = top_institutions[0][1]["citations_count"] if top_institutions else 1
    institutions_geo = []
    for name, stats in top_institutions:
        country = stats["country_code"] or "US"
        lat, lng = COUNTRY_COORDS.get(country, (0, 0))
        org_type = TYPE_MAP.get(stats["org_type"], "research_lab")
        community = "chinese" if country in CHINESE_COUNTRIES else "english"
        influence = round(stats["citations_count"] / max(max_citations, 1) * 100)

        inst_id = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        institutions_geo.append({
            "id": f"inst_{inst_id}",
            "institution": name,
            "city": "",
            "country": country,
            "lat": lat,
            "lng": lng,
            "community": community,
            "org_type": org_type,
            "papers_count": stats["papers_count"],
            "citations_count": stats["citations_count"],
            "influence_score": influence,
        })

    INSTITUTIONS_GEO_PATH.write_text(
        json.dumps(institutions_geo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"✓ institutions_geo.json ({len(institutions_geo)} 个机构)")

    # 构建 institution_aliases.json（简单版本，不做复杂别名）
    aliases = []
    # 识别一些常见别名
    KNOWN_ALIASES = {
        "Massachusetts Institute of Technology": ["MIT"],
        "Carnegie Mellon University": ["CMU"],
        "University of California, Berkeley": ["UC Berkeley", "Berkeley"],
        "Stanford University": ["Stanford"],
        "University of Oxford": ["Oxford"],
        "University of Cambridge": ["Cambridge"],
        "ETH Zurich": ["ETH Zürich"],
        "University of Toronto": ["UofT"],
        "Google": ["Google Research", "Google AI", "Google Brain", "Google DeepMind"],
        "Microsoft": ["Microsoft Research", "MSR"],
        "Meta": ["Meta AI", "Facebook AI", "FAIR"],
        "Chinese Academy of Sciences": ["CAS"],
        "Tsinghua University": ["THU", "Tsinghua"],
        "Peking University": ["PKU"],
    }
    for canonical, alias_list in KNOWN_ALIASES.items():
        if canonical in inst_stats or any(a in inst_stats for a in alias_list):
            aliases.append({"canonical": canonical, "aliases": alias_list})

    ALIASES_PATH.write_text(
        json.dumps(aliases, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"✓ institution_aliases.json ({len(aliases)} 组)")

    # 打印 top 10 机构
    print("\nTop 10 机构:")
    for name, stats in top_institutions[:10]:
        print(f"  {name}: {stats['papers_count']} papers, {stats['citations_count']} citations, {stats['country_code']}")


if __name__ == "__main__":
    main()
