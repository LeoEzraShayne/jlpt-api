# D scene / AI API contract (scenario-v1)

SceneModule imports ContentModule and exports SceneService. StudySessionsModule and SentenceReviewsModule import SceneModule; AppModule needs no extra registration if it already imports those.

Create/get/complete session includes `scenarioId`, `trainingMode` (`UNDERSTAND|SUBSTITUTE|COMBINE|TRANSFER`) and `trainingContext`:

```
{
  version: 'training-v1',
  instructionZh: string,
  scenario: { version:'scenario-v1', id, scenarioId, taskId, objectiveId,
              domain, objective, register, promptZh },
  words: [{id,word,reading,chineseGloss,glosses,sourceName,sourceVersion}], // <=2
  supportingGrammar: {id,title,level}|null, // <=1 learned N2–N4 grammar
  expressions: [{id,hidden:true}], // REVIEW: sentence/furigana/translation/note/provenance removed
  phrases: [{id,hidden:true}], // REVIEW: source text removed
  referenceHidden: boolean
}
```

For initial learning or optional practice, expression/phrase objects contain sentence or word, reading, meaning/provenance. UI may show these in a collapsible reference panel. REVIEW create also hides grammar examples/explanation/connection/usage/common-errors; title/level remain. Generic get/create/complete always redact review reference text, even after an earlier reveal. `POST /study-sessions/:id/reveal` first commits the existing hint count, then returns the normal session with full `trainingContext` and grammar reference content. UI merges this explicit response locally; a refresh can reveal again. Do not fetch /expressions automatically during formal review.

AI result retains all existing correction/alternative/furigana/translation/score fields, plus nullable `contentResponse`, `diversityAdvice`, `nextPractice`, and `scenarioTaskCompleted`. Four parts: contentResponse (short Chinese response), corrected sentence, alternative sentence, nextPractice. Diversity advice never subtracts correctness for simple sentences. Missing/invalid optional generation degrades to baseline correction and no scenario proof.

Server assigns and persists scenario objective/task/register at create; input scene is only free-practice prose, never evidence. Only AI assessment of that server task can set scenarioTaskCompleted. Transfer uses a different communication objective from completed history. No claims are inferred from legacy history. Supporting grammar/words only get idempotent exposure/use records, no review events or scores.
