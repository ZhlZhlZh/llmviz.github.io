import requests
import json

def get_one_paper(title):
    query = title

    # ✅ 修正：移除 publicationVenue.name，改用 venue 和 publicationVenue
    fields = ",".join([
        "paperId", "corpusId", "title", "year", "abstract",
        "authors.name", "authors.authorId", "authors.affiliations", "authors.normalizedAffiliations",
        "fieldsOfStudy", "s2FieldsOfStudy",
        "url", "citationCount",
        "venue", "publicationVenue"  # ← 改为这两个字段
    ])

    url = "https://api.semanticscholar.org/graph/v1/paper/search/match"
    params = {"query": query, "fields": fields}

    response = requests.get(url, params=params)
    result = response.json()

    if response.status_code == 200 and "data" in result and len(result["data"]) > 0:
        paper = result["data"][0]
        
        # 提取机构
        institutions = []
        for author in paper.get("authors", []):
            if author.get("normalizedAffiliations"):
                institutions.extend([a["rorDisplayName"] for a in author["normalizedAffiliations"] if a.get("rorDisplayName")])
            elif author.get("affiliations"):
                institutions.extend(author["affiliations"])
                
        # 提取主题
        topics = paper.get("s2FieldsOfStudy", []) or paper.get("fieldsOfStudy", [])
        topic_list = [t.get("category") if isinstance(t, dict) else t for t in topics]
        
        # ✅ 正确处理 venue
        venue_name = (paper.get("publicationVenue", {}).get("name") or 
                      paper.get("venue") or 
                      "Unknown")

        metadata = {
            "id": paper.get("paperId"),
            "title": paper.get("title"),
            "year": paper.get("year"),
            "abstract": paper.get("abstract"),
            "authors": [a.get("name") for a in paper.get("authors", []) if a.get("name")],
            "topic": list(set(topic_list)),
            "link": paper.get("url"),
            "citations_count": paper.get("citationCount"),
            "venue": venue_name,
            "institution": list(set(institutions))
        }
        
        print("✅ 查询成功！返回元信息：")
        print(json.dumps(metadata, indent=2, ensure_ascii=False))
    else:
        print(f"❌ 查询失败: {response.status_code}")
        print(json.dumps(result, indent=2, ensure_ascii=False))

# 示例调用（可选，如需调用可取消注释）
if __name__ == "__main__":
    get_one_paper("Attention Is All You Need")