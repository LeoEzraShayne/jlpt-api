"""Independent read-only audit; stdlib only. Never imports D pricing helpers.
Usage: python3 test/sentence-lab/ai-audit/recompute.py /absolute/D/worktree > audit.json
"""
import collections, hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1]) / 'scripts/ai-cost'
files = ['usage-initial.json', 'usage-gemini-server-initial.json', 'usage-gemini31-v2.json']
rows, manifest = [], []
for name in files:
    raw = (root/name).read_bytes()
    manifest.append({'path': str(root/name), 'sha256': hashlib.sha256(raw).hexdigest()})
    rows.extend(json.loads(raw))
assert len({r['requestId'] for r in rows}) == len(rows), 'Duplicate request receipts'
rates = {'deepseek-flash': (.30, 1.20), 'gemini-3.1-flash-lite': (.25, 1.50), 'gemini-3.5-flash': (1.50, 9), 'gemini-2.5-flash-lite': (.10, .40)}
# These provisional semantic denominators reproduce the declared INITIAL cohort,
# not final repair quality; reviewers must not call them human certification.
accepted_override = {('deepseek-flash','GRAMMAR_REVIEW'): 10, ('deepseek-flash','VOCABULARY_GENERATE'): 2}
stats = []
for model, purpose in sorted({(r['model'],r['purpose']) for r in rows}):
    cohort = [r for r in rows if (r['model'],r['purpose']) == (model,purpose)]
    known, unknown, algebra_errors = [], 0, []
    for r in cohort:
        i,o,t = r['inputTokens'],r['outputTokens'],r['totalTokens']
        if None in (i,o,t) or not r['usageComplete'] or r.get('cacheWriteTokens') not in (None,0):
            unknown += 1
            continue
        billed = o if r['provider']=='DEEPSEEK' else t-i
        if t != i + o + (r.get('thinkingTokens') or 0) and r['provider']!='DEEPSEEK':
            algebra_errors.append(r['requestId'])
        if r['provider']=='DEEPSEEK' and t != i+o:
            algebra_errors.append(r['requestId'])
        assert billed >= o and i >= 0
        known.append((i*rates[model][0] + billed*rates[model][1])/1e6)
    assert not algebra_errors, algebra_errors
    successes = sum(r['success'] for r in cohort)
    accepted = accepted_override.get((model,purpose), successes)
    stats.append({'model':model,'purpose':purpose,'calls':len(cohort),'schemaAccepted':successes,'provisionalAccepted':accepted,'unknownUsageCalls':unknown,'knownCostPeakColdUsd':sum(known),'knownCostPerAccepted':sum(known)/accepted if accepted else None,'errors':dict(collections.Counter(r['errorCode'] for r in cohort if r['errorCode']))})
products = [('USD launch year',64,.066,365),('USD standard year',99.99,.066,365),('JPY year',6400/150,.046,365),('USD day',.99,.066,1),('JPY day',100/150,.046,1)]
scenarios = []
for model in ['deepseek-flash','gemini-3.1-flash-lite']:
    s = {r['purpose']:r['knownCostPerAccepted'] for r in stats if r['model']==model}
    g,a,q = [s[p] for p in ['GRAMMAR_REVIEW','VOCABULARY_ASSESS','VOCABULARY_GENERATE']]
    for vocab_share in [0,.5,1]:
      for gen_per_review in [1/3,1]:
        unit = (1-vocab_share)*g + vocab_share*(a+q*gen_per_review)
        free_year = 365*((1-vocab_share)*15*g + vocab_share*(15*a+5*q))
        for daily in [20,40,120,240]:
          for name,gross,fee,days in products:
            net = gross*(1-fee); cost = unit*daily*days
            scenarios.append({'model':model,'vocabShare':vocab_share,'generationsPerVocabularyReview':gen_per_review,'dailyReviews':daily,'product':name,'days':days,'netUsd':net,'aiKnownCostUsd':cost,'cashContributionBeforeFixedAndFreeUsd':net-cost,'freeUserAnnualKnownCostUsd':free_year})
print(json.dumps({'sourceManifest':manifest,'uniqueCalls':len(rows),'fixedAnnualUsd':40*12/7.2+5*12,'fxScenario':{'JPYperUSD':150,'CNYperUSD':7.2},'warning':'INITIAL synthetic cohort, paid-price KNOWN-COST LOWER BOUND. Semantic acceptance provisional. Unknown usage, retries/fallback after repair, taxes, refunds, acquisition and overages unpriced. A positive value is not profit or release approval. Day-pass fixed allocation requires sold pass-days, not an assumed 365 repeat purchases.','measurements':stats,'scenarios':scenarios},ensure_ascii=False,indent=2))
