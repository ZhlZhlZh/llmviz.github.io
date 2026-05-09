import urllib.request, urllib.parse, json

# OpenAlex uses the new developers.openalex.org or api.openalex.org
# Works can be fetched by ID: /works/W2963403868
# The select param may not work on old endpoint. Let's try the simplest form.

# Test 1: Get a work by OpenAlex ID
url = 'https://api.openalex.org/works/W2963403868'
req = urllib.request.Request(url)
req.add_header('User-Agent', 'llmviz-project (mailto:test@example.com)')
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        d = json.loads(resp.read())
        print(f"Title: {d.get('title')}")
        refs = d.get('referenced_works', [])
        print(f'referenced_works count: {len(refs)}')
        print(f'Sample: {refs[:3]}')
        # Check IDs format
        ids = d.get('ids', {})
        print(f'IDs: {json.dumps(ids, indent=2)[:300]}')
except Exception as e:
    print(f'Error 1: {e}')

print()

# Test 2: Search by title with URL encoding
params = urllib.parse.urlencode({
    'filter': 'title.search:Improving Language Understanding by Generative Pre-Training',
    'per_page': '1'
})
url2 = f'https://api.openalex.org/works?{params}'
req2 = urllib.request.Request(url2)
req2.add_header('User-Agent', 'llmviz-project (mailto:test@example.com)')
try:
    with urllib.request.urlopen(req2, timeout=15) as resp:
        d = json.loads(resp.read())
        results = d.get('results', [])
        print(f'Search results: {len(results)}')
        if results:
            r = results[0]
            print(f"Title: {r.get('title')}")
            refs = r.get('referenced_works', [])
            print(f'referenced_works count: {len(refs)}')
            # Check if Attention paper is in refs
            attn_ref = [x for x in refs if 'W2963403868' in x]
            print(f'Contains Attention paper: {bool(attn_ref)}')
except Exception as e:
    print(f'Error 2: {e}')
