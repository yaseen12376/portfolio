import json, sys, time, urllib.request
req = open('fire-req.json', 'rb').read()
out = {}
for lang in sys.argv[1:]:
    r = urllib.request.Request('http://localhost:8081/api/fire/stream', req, {'content-type': 'application/json', 'X-Language': lang, 'Accept': 'text/event-stream'})
    t0 = time.time()
    ev, stages, result = None, [], None
    for raw in urllib.request.urlopen(r, timeout=300):
        line = raw.decode('utf8').rstrip('\n')
        if line.startswith('event:'): ev = line[6:]
        elif line.startswith('data:'):
            d = json.loads(line[5:])
            if ev == 'stage': stages.append(d)
            elif ev == 'result': result = d
            elif ev == 'error': print(lang, 'ERROR', d)
    m = result['meta']
    out[lang] = {'stages': stages, 'wall': round(time.time() - t0, 2), 'fireImpact': result.get('fireImpact'),
                 'milestones': [x.get('action') for x in result.get('milestones', [])],
                 'sipAllocation': [x.get('recommendation') for x in result.get('sipAllocation', [])],
                 'trust': m.get('trust'), 'source': m.get('explanationSource'), 'latencyMs': m.get('latencyMs'),
                 'citations': [(c['id'], c['title'], c.get('section')) for c in m.get('citations', [])]}
    print(lang, [(s['step'], s['status'], s['ms'], s.get('detail')) for s in stages if s['status'] != 'start'], 'trust', (m.get('trust') or {}).get('groundedScore'), m.get('explanationSource'), m.get('latencyMs'))
json.dump(out, open('fire-langs.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
