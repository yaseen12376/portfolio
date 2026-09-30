"""Capture FinMind's two retrieval halves for a few questions, replicating
KnowledgeService.retrieve (expand, Qdrant top 8 at >= 0.52, FTS5 BM25 top 8,
RRF k=60, top 4) and checking the fused result against the running app's
/api/knowledge/search. Reads the scratch copy of the data only."""
import json, re, sqlite3, sys, urllib.parse, urllib.request

ROOT = r'C:\Users\asus\Desktop\HYDRABATH_HACK\ai-money-mentor\backend\src\main\resources\rules'
DB = sys.argv[1]
OUT = sys.argv[2]
STOP = set("the a an is are can i my me of in on for to and or what how do does under with it be this that should which".split())
MAP = json.load(open(ROOT + r'\section-map.json', encoding='utf8'))['mappings']
FORM_REF = re.compile(r'(?i)\bform\s*(no\.?\s*)?\d+[a-z]*')
SECTION_REF = re.compile(r'(?i)(?:section|sec\.?|u/s)\s*(\d{1,3}[A-Z]{0,5}(?:\s?\(\w{1,4}\))*)|\b(\d{2,3}[A-Z]{1,5}(?:\(\w{1,4}\))*)\b')


def expand(query):
    extra = []
    q = query.upper().replace(' ', '')
    for m in MAP:
        old = m['old'].upper().replace(' ', '')
        new = m['new']
        mentions_old = re.search(r'(?<![0-9A-Z])' + re.escape(old) + r'(?![0-9A-Z])', q)
        mentions_new = new.upper() != 'SCHEDULE' and re.search('SECTION' + re.escape(new.upper()) + r'(?![0-9])', q)
        if mentions_old:
            s = f"Section {new} (formerly {m['old']}) {m['topic']}"
        elif mentions_new:
            s = f"formerly section {m['old']} {m['topic']}"
        else:
            continue
        if s not in extra:
            extra.append(s)
    low = query.lower()
    for cond, s in ((('new regime' in low or 'new tax regime' in low), 'Section 202 new tax regime (formerly 115BAC)'), ('rebate' in low, 'Section 156 rebate (formerly 87A)')):
        if cond and s not in extra:
            extra.append(s)
    return query if not extra else query + ' | ' + ' | '.join(extra)


def to_match(query):
    terms = []
    for raw in re.split(r'[^a-z0-9()]+', query.lower()):
        t = re.sub(r'[()]', '', raw)
        if len(t) < 2 or t in STOP:
            continue
        if f'"{t}"' not in terms:
            terms.append(f'"{t}"')
        if len(terms) >= 16:
            break
    return ' OR '.join(terms)


def post(url, body):
    req = urllib.request.Request(url, json.dumps(body).encode(), {'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=120))


def short(text, n=140):
    t = re.sub(r'\s+', ' ', text or '').strip()
    t = re.sub(r'^\[[^\]]*\]\s*', '', t)  # the ingestion header
    return t[:n] + ('…' if len(t) > n else '')


QUESTIONS = [
    ('regime-80c', 'Can I claim 80C deductions under the new tax regime?', '2026-27'),
    ('direct-plan', 'What is a direct plan in mutual funds?', '2026-27'),
    ('form16', 'What is Form 16?', '2025-26'),
    ('off-topic', 'How do I buy crypto on Binance?', '2026-27'),
]

db = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
out = []
for qid, q, year in QUESTIONS:
    ex = expand(q)
    emb = post('http://localhost:11434/api/embed', {'model': 'bge-m3', 'input': ex})['embeddings'][0]
    res = post('http://localhost:6333/collections/mentor_knowledge/points/search', {
        'vector': emb, 'limit': 8, 'with_payload': True, 'score_threshold': 0.52,
        'filter': {'should': [{'key': 'tax_year', 'match': {'value': year}}, {'key': 'tax_year', 'match': {'value': 'all'}}]},
    })['result']
    vec = [{'id': p['id'], 'score': round(p['score'], 4), 'title': p['payload'].get('title'), 'authority': p['payload'].get('authority'),
            'section': p['payload'].get('section'), 'text': short(p['payload'].get('doc_content'))} for p in res]
    match = to_match(ex)
    kw = []
    if match:
        for r in db.execute("""SELECT chunk_id, text, title, authority, section, bm25(chunk_fts) AS rank FROM chunk_fts
                               WHERE chunk_fts MATCH ? AND (tax_year = ? OR tax_year = 'all') ORDER BY rank LIMIT 8""", (match, year)):
            kw.append({'id': r[0], 'bm25': round(r[5], 3), 'title': r[2], 'authority': r[3], 'section': r[4], 'text': short(r[1])})
    exact = bool(SECTION_REF.search(q)) or bool(FORM_REF.search(q))
    fused = {}
    for i, v in enumerate(vec):
        fused[v['id']] = fused.get(v['id'], 0) + 1 / (60 + i + 1)
    used_kw = bool(vec) or exact
    if used_kw:
        for i, h in enumerate(kw):
            fused[h['id']] = fused.get(h['id'], 0) + 1 / (60 + i + 1)
    top = sorted(fused.items(), key=lambda e: -e[1])[:4]
    app = json.load(urllib.request.urlopen('http://localhost:8080/api/knowledge/search?' + urllib.parse.urlencode({'q': q, 'taxYear': year}), timeout=120))
    mine = [round(s, 4) for _, s in top]
    theirs = [c['score'] for c in app]
    ok = mine == theirs
    by = {**{h['id']: h for h in kw}, **{v['id']: v for v in vec}}
    out.append({'id': qid, 'question': q, 'taxYear': year, 'expanded': ex, 'exactTerm': exact, 'keywordUsed': used_kw,
                'vector': vec, 'keyword': kw,
                'fused': [{'id': k, 'rrf': round(s, 4), 'title': by[k]['title'], 'authority': by[k]['authority'], 'section': by[k].get('section'),
                           'fromVector': next((i + 1 for i, v in enumerate(vec) if v['id'] == k), None),
                           'fromKeyword': next((i + 1 for i, h in enumerate(kw) if h['id'] == k), None) if used_kw else None,
                           'text': by[k]['text']} for k, s in top],
                'app': [{'id': c['id'], 'title': c['title'], 'section': c.get('section'), 'score': c['score']} for c in app],
                'matchesApp': ok})
    print(qid, 'vec', len(vec), 'kw', len(kw), 'exact', exact, 'fused', mine, 'app', theirs, 'OK' if ok else 'MISMATCH')
json.dump(out, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
