import urllib.request, json

# Test Semantic Scholar API WITHOUT key (public rate limit)
paper_id = 'cd18800a0fe0b668a1cc19f2ec95b5003d0a5035'
url = f'https://api.semanticscholar.org/graph/v1/paper/{paper_id}?fields=title,references.paperId'

req = urllib.request.Request(url)
req.add_header('User-Agent', 'llmviz-research-project')

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.loads(resp.read())
        print(f"Title: {d.get('title')}")
        refs = d.get('references', [])
        print(f"References count: {len(refs)}")
        ref_ids = [r.get('paperId','') for r in refs if r.get('paperId')]
        print(f"Sample IDs: {ref_ids[:5]}")
        # Check if Attention paper is referenced
        attn_id = '204e3073870fae3d05bcbc2f6a8e263d9b72e776'
        print(f"Contains Attention paper: {attn_id in ref_ids}")
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print(f"HTTP {e.code}: {e.reason}")
    print(f"Body: {body[:300]}")
except Exception as e:
    print(f"Error: {e}")
