import urllib.request, json

# Test Semantic Scholar API with the provided key
# GPT-1 paper ID
paper_id = 'cd18800a0fe0b668a1cc19f2ec95b5003d0a5035'
url = f'https://api.semanticscholar.org/graph/v1/paper/{paper_id}?fields=title,references.paperId'

req = urllib.request.Request(url)
req.add_header('x-api-key', 'eacWmrGqmt4hmYtBWo4Y36TiheW623hk3p1sTuoL')

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        d = json.loads(resp.read())
        print(f"Title: {d.get('title')}")
        refs = d.get('references', [])
        print(f"References count: {len(refs)}")
        print(f"Sample: {[r.get('paperId','')[:20] for r in refs[:5]]}")
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print(f"HTTP {e.code}: {e.reason}")
    print(f"Body: {body[:500]}")
    print(f"Headers: {dict(e.headers)}")
except Exception as e:
    print(f"Error: {e}")
