"""Audit frozen synthetic request/receipt joins and billable usage independently."""
import hashlib,json
from pathlib import Path
p=Path(__file__).parent
result=json.loads((p/'held-out-results.json').read_text())
raw=json.loads((p/'held-out-raw.json').read_text())['raw']
usage=json.loads((p/'held-out-usage.json').read_text())
assert len(raw)==len(usage)==len(result['rows'])==12
assert len({u['requestId'] for u in usage})==12
actual=peakcold=0
reviews=[]
for r in result['rows']:
 key=result['runId']+':'+r['caseId']
 u=next(u for u in usage if u['taskKey']==key)
 rawrow=next(v for v in raw if v['caseId']==r['caseId'])
 v=rawrow['usage']
 assert u['inputTokens']==v['prompt_tokens']
 assert u['outputTokens']==v['completion_tokens']
 assert u['totalTokens']==v['total_tokens']==u['inputTokens']+u['outputTokens']
 assert u['usageComplete'] and u['costUsd'] is not None
 cached=u['cachedInputTokens'] or 0
 # This frozen run is Saturday UTC: off-peak, .15/.003/.60 USD per million.
 cost=((u['inputTokens']-cached)*.15+cached*.003+u['outputTokens']*.6)/1e6
 assert abs(cost-float(u['costUsd']))<1e-12
 actual+=cost
 peakcold+=(u['inputTokens']*.3+u['outputTokens']*1.2)/1e6
 assert u['success']==('error' not in r)
 note='F model review: target evidence, correction and language semantically accepted.'
 status='PASS'
 if r['caseId']=='en:stem-wrong':
  body=json.loads(rawrow['content'])
  assert body['total_score']==30 and sum(body[k] for k in ['grammar_score','connection_score','completeness_score','naturalness_score','vocabulary_score'])==35
  assert r['error']=='AI_INVALID_RESPONSE' and not u['success'] and cost>0
  status='FAIL_CLOSED';note='Correct connection diagnosis, inconsistent score arithmetic. Rejected and charged; not usable feedback.'
 elif r['caseId'] in ['en:stem-valid','en:obligation']:
  status='PASS_WITH_MODEL_DEVIATION';note='Grammar/translation valid; absent scenario was reported completed. Existing worker requires matching stored scenario, otherwise persists null. No scenario success may be inferred from this provider field.'
 elif r['caseId']=='zh:reservation-alternative':
  note='Natural alternative correctly leaves target/meaning/reading unverified and original unchanged. 占好 translation is less idiomatic than 预留/订好 but does not reverse the booking meaning.'
 reviews.append({'caseId':r['caseId'],'requestId':u['requestId'],'structuralAccepted':u['success'],'reviewStatus':status,'reviewMethod':'F independent model review, not human linguist certification','note':note})
print(json.dumps({'runId':result['runId'],'requests':12,'validStructuredFeedback':11,'failedChargedFeedback':1,'unknownUsageCalls':0,'actualPaidEstimateUsd':actual,'peakColdSameCallsUsd':peakcold,'qualityGate':'NOT_APPROVED: bounded held-out set cannot certify general JLPT accuracy or close prior regression failures','sourceHashes':{f:hashlib.sha256((p/f).read_bytes()).hexdigest() for f in ['held-out-results.json','held-out-raw.json','held-out-usage.json']},'reviews':reviews},ensure_ascii=False,indent=2))
