"""Independent stdlib audit of frozen mixed run; no D cost/validation helpers."""
from pathlib import Path
import json,hashlib,statistics,math,unicodedata
p=Path(__file__).parent
manifest=json.loads((p/'mixed-manifest.json').read_text())
for name,h in manifest['files'].items():assert hashlib.sha256((p/name).read_bytes()).hexdigest()==h
fixtures=[r for name in ['cases.json','extra-cases.json'] for r in json.loads((p/name).read_text())['rows']]
result=json.loads((p/'mixed-results.json').read_text());rows=result['rows']
raw=json.loads((p/'mixed-raw.json').read_text())['raw'];usage=json.loads((p/'mixed-usage.json').read_text())
assert len(fixtures)==len(rows)==24 and len(raw)==len(usage)<=48
assert len({u['requestId'] for u in usage})==len(usage)
assert len({(u['taskKey'],u['attempt']) for u in usage})==len(usage)
reviews=[];measurements={};operation_costs=[];actual=0
for f in fixtures:
 r=next(r for r in rows if r['caseId']==f['caseId']);assert 'error' not in r
 receipts=sorted([u for u in usage if u['taskKey']==result['runId']+':'+f['caseId']],key=lambda u:u['attempt'])
 assert 1<=len(receipts)==r['requests']<=2 and receipts[-1]['success']
 assert all(not u['success'] for u in receipts[:-1])
 opcost=0
 for u in receipts:
  a=next(a for a in raw if a['caseId']==f['caseId'] and a['ordinal']==u['attempt'])
  v=a['usage'];assert u['provider']=='DEEPSEEK' and u['model']=='deepseek-flash'
  assert u['inputTokens']==v['prompt_tokens'];assert u['outputTokens']==v['completion_tokens']
  assert u['totalTokens']==v['total_tokens']==u['inputTokens']+u['outputTokens']
  assert u['thinkingTokens']==v.get('completion_tokens_details',{}).get('reasoning_tokens')
  assert u['usageComplete'] and u['costUsd'] is not None
  assert a['thinking']['type']==('enabled' if f['kind']=='grammar' else 'disabled')
  if f['kind']=='grammar':assert a['maxTokens']==4096 and a['reasoningEffort']=='low'
  if f['kind']!='generate':assert a['originalSentenceRetained']
  if u['attempt']==2:assert a['repair']
  cached=u['cachedInputTokens'] or 0
  # Frozen Saturday UTC run: all off-peak. Reasoning already inside completion.
  priced=((u['inputTokens']-cached)*.15+cached*.003+u['outputTokens']*.6)/1e6
  assert abs(priced-float(u['costUsd']))<1e-12
  actual+=priced;opcost+=(u['inputTokens']*.3+u['outputTokens']*1.2)/1e6
 e=f['expected'];a=r['result'];purpose=receipts[0]['purpose']
 if f['kind']=='grammar':
  a=a['response']['result'];assert a['used_target_grammar']==e['usedTargetGrammar'];assert a['target_grammar_correct']==e['targetGrammarCorrect'];assert a['is_correct']==e['isCorrect']
  assert e['scoreMin']<=a['total_score']<=e['scoreMax'];assert a['total_score']==sum(a[k] for k in ['grammar_score','connection_score','completeness_score','naturalness_score','vocabulary_score'])
  assert a['scenario_task_completed']==False
  if e['unchangedOriginal']:assert a['corrected_sentence']==f['input']['sentence']
  if e['errorMustReferToOriginal']:
   assert a['error_spans'] and all(f['input']['sentence'][s['start']:s['end']]==s['text'] for s in a['error_spans'])
 elif f['kind']=='vocabulary':
  for k in ['usedTarget','targetCorrect','meaningCorrect','readingCorrect']:assert a[k]==e[k]
  if e['unchangedOriginal']:assert a['correctedSentence']==f['input']['sentence'] and not a['corrections']
 else:
  for key in ['promptZh','meaningHintZh']:
   assert f['input']['vocabulary']['word'] not in a[key] and f['input']['vocabulary']['reading'] not in a[key]
  plain=lambda s:''.join(c for c in s if not unicodedata.category(c).startswith('P') and not c.isspace())
  assert plain(''.join(a['chunks']))==plain(a['referenceSentence'])
 group=measurements.setdefault(purpose,{'operations':0,'networkCalls':0,'rejectedCandidates':0,'peakColdKnownUsd':0,'latenciesMs':[]})
 group['operations']+=1;group['networkCalls']+=len(receipts);group['rejectedCandidates']+=len(receipts)-1;group['peakColdKnownUsd']+=opcost;group['latenciesMs'].append(r['latencyMs'])
 operation_costs.append({'caseId':f['caseId'],'purpose':purpose,'peakColdUsd':opcost})
 reviews.append({'caseId':f['caseId'],'coreSemanticJudgment':'PASS','reviewMethod':'F independent model reading of original/final sentence, readings, translation, meaning/polarity and target evidence; not human expert certification','advisory':'Correct target rejection and correction, but explanation incorrectly describes 貯金 as an eating object although it is the original predicate. Keep this diagnostic wording defect visible.' if f['caseId']=='zh:saving-wrong' else None})
for g in measurements.values():
 g['unitPeakColdUsd']=g['peakColdKnownUsd']/g['operations'];ls=g.pop('latenciesMs');g['medianLatencyMs']=statistics.median(ls);g['p95NearestRankMs']=sorted(ls)[math.ceil(.95*len(ls))-1]
g,a,q=[measurements[k]['unitPeakColdUsd'] for k in ['GRAMMAR_REVIEW','VOCABULARY_ASSESS','VOCABULARY_GENERATE']]
scenarios=[]
for vocabshare in [0,.5,1]:
 for genratio in [1/3,1]:
  unit=(1-vocabshare)*g+vocabshare*(a+genratio*q)
  for daily in [20,40,120,240]:
   for name,net,days in [('USD launch year',59.776,365),('USD standard year',93.39066,365),('JPY year',40.704,365),('USD day',.92466,1),('JPY day',.636,1)]:
    scenarios.append({'product':name,'vocabShare':vocabshare,'generationsPerVocabularyReview':genratio,'daily':daily,'aiKnownUsd':unit*daily*days,'cashContributionBeforeFixedFreeUnknownUsd':net-unit*daily*days,'fullFreeUserAnnualKnownUsd':365*((1-vocabshare)*15*g+vocabshare*(15*a+5*q))})
output={'runId':result['runId'],'operations':24,'finalStructuredResponses':24,'coreSemanticPasses':24,'diagnosticWordingAdvisories':1,'networkCalls':len(usage),'paidRejectedCandidates':3,'unknownUsageCalls':0,'actualPaidEstimateUsd':actual,'thinkingTokens':sum(u['thinkingTokens'] or 0 for u in usage),'peakColdSumUsd':sum(o['peakColdUsd'] for o in operation_costs),'fixedAnnualBaseUsd':40*12/7.2+5*12,'measurements':measurements,'reviews':reviews,'operationCosts':operation_costs,'scenarios':scenarios,'limitations':['Purpose-specific grammar/vocabulary costs from a small synthetic corpus, not a population forecast.','Peak cold-cache stress differs from observed off-peak cached invoice estimates.','Unknown taxes, refunds, acquisition, overages and future failed/retry operations are not zero.','Historical grammar thinking batch costs were higher and must not be discarded.','The wording advisory remains open; core-semantic pass is not perfect feedback certification.'],'sourceHashes':{name:hashlib.sha256((p/name).read_bytes()).hexdigest() for name in ['cases.json','extra-cases.json','mixed-results.json','mixed-raw.json','mixed-usage.json']}}
historical=[]
source=p.parents[3]/'scripts/ai-cost'
for uf,rf,purpose in [('usage-thinking-low-v1.json','results-thinking-low-v1.json','GRAMMAR_REVIEW'),('usage-bounded-repair-v6.json','results-bounded-repair-v6.json','VOCABULARY_ASSESS'),('usage-bounded-repair-v6.json','results-bounded-repair-v6.json','VOCABULARY_GENERATE')]:
 ledger=[u for u in json.loads((source/uf).read_text()) if u['purpose']==purpose]
 keys={u['taskKey'] for u in ledger};final=json.loads((source/rf).read_text())
 ops=[r for r in final['rows'] if final['runId']+':'+r['model']+':'+r['locale']+':'+r['id'] in keys]
 accepted=sum(bool(r.get('result',{}).get('passed')) for r in ops)
 known=sum((u['inputTokens']*.3+u['outputTokens']*1.2)/1e6 for u in ledger if u['costUsd'] is not None)
 historical.append({'purpose':purpose,'requests':len(ledger),'operations':len(ops),'declaredAcceptedDenominator':accepted,'denominatorCaveat':'D final expected-output result, not a new F semantic certification','unknownCostCalls':sum(u['costUsd'] is None for u in ledger),'peakColdKnownUsd':known,'unitPeakColdUsd':known/accepted,'sourceHashes':{name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in [uf,rf]}})
output['historicalIndependentRecomputation']=historical
print(json.dumps(output,ensure_ascii=False,indent=2))
