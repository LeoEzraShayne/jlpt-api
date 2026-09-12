"""Freeze 12 additional novel vocabulary operations before authorized mixed run."""
import json,hashlib
from pathlib import Path
words=[
('zh','deliver','届ける','とどける','把物品送到收件人处','deliver an item to its recipient','母に忘れ物を届けました。','母[はは]に忘[わす]れ物[もの]を届[とど]けました。','我把遗忘的东西送给母亲了。','この包丁でニンジンを届けました。','切る a carrot with the knife, not deliver it'),
('zh','saving','貯金','ちょきん','储蓄金钱','save money','旅行のために毎月一万円ずつ貯金しています。','旅行[りょこう]のために毎月[まいつき]一万円[いちまんえん]ずつ貯金[ちょきん]しています。','为了旅行，我每月存一万日元。','おなかがすいたので、うどんを貯金しました。','eat noodles due to hunger; savings is not an eating verb'),
('en','entrust','預ける','あずける','把人或物托付给他人保管照顾','entrust someone or something to another person for safekeeping','旅行中、猫を友人に預けました。','旅行中[りょこうちゅう]、猫[ねこ]を友人[ゆうじん]に預[あず]けました。','I left my cat with a friend during my trip.','暑かったので、窓を預けました。','open the window because it is hot, not entrust a window'),
('en','postpone','延期','えんき','把活动等推迟到之后的日期','postpone an event to a later date','台風のため、試合を来週に延期しました。','台風[たいふう]のため、試合[しあい]を来週[らいしゅう]に延期[えんき]しました。','Because of the typhoon, we postponed the match until next week.','静かにするため、テレビの音量を延期しました。','lower the volume to make it quiet; cannot postpone volume'),
]
rows=[]
for locale,id,word,reading,zh,en,sentence,furigana,translation,wrong,wrongMeaning in words:
 vocabulary={'explanationLocale':locale,'word':word,'reading':reading,'chineseGloss':zh,'senseKey':'F-extra-'+id,'glosses':[{'language':'eng','text':en}],'grammars':[],'previousPrompts':[]}
 challenge={'promptZh':'用日语说明发生的事情。' if locale=='zh' else 'Describe what happened in Japanese.','meaningHintZh':zh if locale=='zh' else en,'grammarId':None,'referenceSentence':sentence,'referenceFurigana':furigana,'referenceTranslationZh':translation,'chunks':[sentence[:3],sentence[3:]]}
 rows.append({'caseId':f'{locale}:{id}-generate','kind':'generate','input':{'vocabulary':vocabulary},'expected':{'feedbackLocale':locale,'concealTargetAndReading':True,'JapaneseAnswerRequired':True,'meaning':'Reference must be natural Japanese using the selected target sense, with matching hiragana reading and accurate translation.'}})
 for suffix,answer,correct in [('correct',sentence,True),('wrong',wrong,False)]:
  rows.append({'caseId':f'{locale}:{id}-{suffix}','kind':'vocabulary','input':{'vocabulary':vocabulary,'challenge':challenge,'sentence':answer},'expected':{'usedTarget':True,'targetCorrect':correct,'meaningCorrect':correct,'readingCorrect':None,'unchangedOriginal':correct,'semantic':translation if correct else wrongMeaning,'repairMustGradeOriginal':True}})
p=Path(__file__).parent/'extra-cases.json'
with p.open('x') as f:json.dump({'version':'F-extra-vocab-v1','status':'PREPARED_NOT_RUN','rows':rows},f,ensure_ascii=False,indent=2);f.write('\n')
manifest={'operationCount':24,'networkCallLimit':48,'candidateCommits':['1acb110','0bf99ed','3e71d71','467741a'],'files':{name:hashlib.sha256((p.parent/name).read_bytes()).hexdigest() for name in ['cases.json','extra-cases.json']}}
(p.parent/'mixed-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Frozen 24 total operations before network calls.')
