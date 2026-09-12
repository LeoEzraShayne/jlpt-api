"""Offline fixture preparation only. No provider imports, credentials or requests.
Refuses to overwrite the frozen fixture file. D must not see these before candidate freeze.
"""
import json
from pathlib import Path
rows=[]
for locale in ['zh','en']:
    prefix='这份说明书含很多汉字，难以阅读。' if locale=='zh' else 'The address is long and hard to remember.'
    wrong='この説明書は漢字が多くて、読むにくいです。' if locale=='zh' else 'この住所は長いので、覚えるにくいです。'
    right='この説明書は漢字が多くて、読みにくいです。' if locale=='zh' else 'この住所は長いので、覚えにくいです。'
    span='読むにくい' if locale=='zh' else '覚えるにくい'
    replacement='読みにくい' if locale=='zh' else '覚えにくい'
    grammar=[
      ('connection-error','～にくい','做某事困难','动词ます形去ます＋にくい',wrong,False,{'expectedCorrection':right,'errorText':span,'replacement':replacement,'meaning':prefix}),
      ('natural-control','～にくい','做某事困难','动词ます形去ます＋にくい',right,True,{'meaning':prefix}),
      ('obligation','～なければならない','必须做某事','动词ない形去ない＋なければならない','図書館の本なので、来週までに返さなければならない。' if locale=='zh' else '会社の規則なので、毎月パスワードを変えなければならない。',True,{'meaning':'Must return the library book by next week.' if locale=='zh' else 'Company rules require changing the password every month.','forbiddenMeaning':'No need to do it / must not do it.'}),
      ('no-obligation','～なくてもいい','不做也可以，无需做，并非禁止做','动词ない形去ない＋なくてもいい','その本はプレゼントなので、返さなくてもいいです。' if locale=='zh' else '今日は休みなので、早く起きなくてもいいです。',True,{'meaning':'The book is a gift, so there is no need to return it.' if locale=='zh' else 'Today is a day off, so there is no need to get up early.','forbiddenMeaning':'Must do it / must not do it / cannot do it.'}),
    ]
    for id,title,meaning,connection,sentence,correct,semantic in grammar:
      rows.append({'caseId':f'{locale}:{id}','kind':'grammar','input':{'stage':'CORE','explanationLocale':locale,'grammarTitle':title,'explanation':meaning,'connectionRule':connection,'sentence':sentence},'expected':{'usedTargetGrammar':True,'targetGrammarCorrect':correct,'isCorrect':correct,'scoreMin':90 if correct else 0,'scoreMax':100 if correct else 59,'unchangedOriginal':correct,'errorMustReferToOriginal':not correct,'scenarioAward':None,'semantic':semantic}})
    if locale=='zh':
      word,reading,gloss,english='謝る','あやまる','为过失向他人道歉','to apologize for a mistake'
      prompt,hint='用日语说明你迟到后如何向老师道歉。','为自己的过失向对方道歉。'
      target='遅刻したので、先生に謝りました。';alternate='遅刻したので、先生に「すみません」と言いました。'
      furigana='遅刻[ちこく]したので、先生[せんせい]に謝[あやま]りました。';translation='因为迟到了，我向老师道歉了。'
      chunks=['遅刻したので、','先生に謝りました。']
    else:
      word,reading,gloss,english='感謝','かんしゃ','对帮助自己的人表示感谢','gratitude; thanks for help received'
      prompt,hint='Express gratitude toward a friend who helped you, in Japanese.','A feeling of thanks toward someone who helped you.'
      target='手伝ってくれた友達に感謝しています。';alternate='手伝ってくれた友達に「ありがとう」と言いました。'
      furigana='手伝[てつだ]ってくれた友達[ともだち]に感謝[かんしゃ]しています。';translation='I am grateful to the friend who helped me.'
      chunks=['手伝ってくれた友達に','感謝しています。']
    for id,sentence,used in [('word-target',target,True),('natural-synonym',alternate,False)]:
      rows.append({'caseId':f'{locale}:{id}','kind':'vocabulary','input':{'vocabulary':{'explanationLocale':locale,'word':word,'reading':reading,'chineseGloss':gloss,'senseKey':f'F-route-{locale}', 'glosses':[{'language':'eng','text':english}],'grammars':[],'previousPrompts':[]},'challenge':{'promptZh':prompt,'meaningHintZh':hint,'grammarId':None,'referenceSentence':target,'referenceFurigana':furigana,'referenceTranslationZh':translation,'chunks':chunks},'sentence':sentence},'expected':{'usedTarget':used,'targetCorrect':True if used else None,'meaningCorrect':True if used else None,'readingCorrect':None,'unchangedOriginal':True,'corrections':[],'semantic':'Natural sentence remains acceptable even when the tested lexical item is absent. Never infer target knowledge from corrected/reference text, synonymous meaning, or the exercise prompt.'}})
p=Path(__file__).parent/'cases.json'
with p.open('x') as f:json.dump({'version':'F-held-out-route-v2','status':'PREPARED_NOT_RUN','localeCounts':{'zh':6,'en':6},'candidateCommit':None,'rows':rows},f,ensure_ascii=False,indent=2);f.write('\n')
assert len(rows)==12 and len({r['caseId'] for r in rows})==12
for r in rows:
 if r['kind']=='grammar' and not r['expected']['targetGrammarCorrect']:
  assert r['expected']['semantic']['errorText'] in r['input']['sentence']
 if r['kind']=='vocabulary' and not r['expected']['usedTarget']:
  assert r['input']['vocabulary']['word'] not in r['input']['sentence']
print('Prepared 12 cases offline; no credentials loaded, no provider calls.')
