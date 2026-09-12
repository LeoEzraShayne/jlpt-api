"""F mechanical/receipt audit. Outputs do not claim semantic approval; review raw text separately."""
import hashlib
import json
import sys
from pathlib import Path

base = Path(__file__).parent
output = Path(sys.argv[1])
manifest = json.loads((base / 'manifest.json').read_text())
assert hashlib.sha256((base / 'cases.json').read_bytes()).hexdigest() == manifest['fixtureSha256']
fixtures = json.loads((base / 'cases.json').read_text())['rows']
results = json.loads((output / 'results.json').read_text())
raw = json.loads((output / 'raw.json').read_text())
usage = json.loads((output / 'usage.json').read_text())
assert results['fixtureSha256'] == manifest['fixtureSha256']
assert raw['runId'] == results['runId']
assert len(raw['raw']) <= 24
assert len({u['requestId'] for u in usage}) == len(usage)
checks, failures, money, unknown = [], [], 0, 0
for fixture in fixtures:
    case_id = fixture['caseId']
    row = next((r for r in results['rows'] if r['caseId'] == case_id), None)
    receipts = sorted([u for u in usage if u['taskKey'] == results['runId'] + ':' + case_id], key=lambda u: u['attempt'])
    calls = [r for r in raw['raw'] if r['caseId'] == case_id]
    problems = []
    def verify(condition, reason):
        if not condition: problems.append(reason)
    verify(row is not None, 'operation_missing')
    verify(len(receipts) == len(calls) and 1 <= len(calls) <= 2, 'receipt_network_count')
    verify(len([c for c in calls if c['provider'] == 'GEMINI']) <= 1, 'more_than_one_gemini_candidate')
    for u in receipts:
        call = next((c for c in calls if c['ordinal'] == u['attempt']), None)
        verify(call is not None, 'receipt_attempt_missing')
        if not call: continue
        verify(call['provider'] == u['provider'], 'receipt_provider_mismatch')
        verify(u['errorCode'] != 'AI_IN_FLIGHT', 'unfinalized_receipt')
        if fixture['kind'] != 'generate': verify(call['originalSentenceRetained'], 'original_not_retained')
        raw_usage = call.get('usage')
        if not raw_usage:
            unknown += 1
            verify(u['costUsd'] is None and not u['usageComplete'], 'unknown_usage_fabricated')
            continue
        gemini = u['provider'] == 'GEMINI'
        input_tokens = raw_usage.get('promptTokenCount' if gemini else 'prompt_tokens')
        output_tokens = raw_usage.get('candidatesTokenCount' if gemini else 'completion_tokens')
        total = raw_usage.get('totalTokenCount' if gemini else 'total_tokens')
        thoughts = raw_usage.get('thoughtsTokenCount') if gemini else raw_usage.get('completion_tokens_details', {}).get('reasoning_tokens')
        verify((u['inputTokens'], u['outputTokens'], u['totalTokens'], u['thinkingTokens']) == (input_tokens, output_tokens, total, thoughts), 'raw_normalization_mismatch')
        if u['usageComplete']:
            verify(total == input_tokens + output_tokens + ((thoughts or 0) if gemini else 0), 'token_total_mismatch')
            # Approved conservative DeepSeek Flash peak/cold basis; Gemini thoughts are billed once.
            money += (input_tokens * 0.3 + (total - input_tokens) * 1.2) / 1_000_000
        else: unknown += 1
    if row and 'result' in row:
        verify(receipts and receipts[-1]['success'], 'final_without_success_receipt')
        expected, result = fixture['expected'], row['result']
        if fixture['kind'] == 'grammar':
            result = result['response']['result']
            for key, expected_key in [('used_target_grammar', 'usedTargetGrammar'), ('target_grammar_correct', 'targetGrammarCorrect'), ('is_correct', 'isCorrect')]:
                verify(result[key] == expected[expected_key], key)
            verify(expected['scoreMin'] <= result['total_score'] <= expected['scoreMax'], 'score_range')
            verify(result['total_score'] == sum(result[k] for k in ['grammar_score','connection_score','completeness_score','naturalness_score','vocabulary_score']), 'score_sum')
            verify(result['scenario_task_completed'] is False, 'invented_scenario_evidence')
            if expected['unchangedOriginal']: verify(result['corrected_sentence'] == fixture['input']['sentence'], 'natural_original_changed')
            if expected['errorMustReferToOriginal']:
                verify(bool(result['error_spans']), 'missing_error_spans')
                for span in result['error_spans']: verify(fixture['input']['sentence'][span['start']:span['end']] == span['text'], 'wrong_original_error_span')
        elif fixture['kind'] == 'vocabulary':
            for key in ['usedTarget','targetCorrect','meaningCorrect','readingCorrect']: verify(result[key] == expected[key], key)
            if expected['unchangedOriginal']:
                verify(result['correctedSentence'] == fixture['input']['sentence'] and not result['corrections'], 'natural_synonym_changed')
        else:
            vocab = fixture['input']['vocabulary']
            for key in ['promptZh','meaningHintZh']:
                verify(vocab['word'] not in result[key] and vocab['reading'] not in result[key], 'target_leaked')
    else: problems.append('no_final_result')
    checks.append({'caseId': case_id, 'finalProvider': receipts[-1]['provider'] if receipts and receipts[-1]['success'] else None, 'geminiRequests': len([c for c in calls if c['provider'] == 'GEMINI']), 'requests': len(calls), 'mechanicalProblems': problems, 'independentSemanticReview': 'REQUIRED'})
    failures.extend({'caseId': case_id, 'problem': p} for p in problems)
print(json.dumps({'candidateCommit': results['candidateCommit'], 'runId': results['runId'], 'operations': len(results['rows']), 'requests': len(raw['raw']), 'receipts': len(usage), 'knownTokensAtDeepSeekPeakColdUsd': money, 'unknownUsageCalls': unknown, 'checks': checks, 'failures': failures, 'qualityVerdict': 'PENDING_INDEPENDENT_READING'}, indent=2, ensure_ascii=False))
if failures: sys.exit(1)
