# Content module integration contract

Main: add `SCHEMA.prisma.txt` models and `ContentModule` to AppModule imports. No runtime package/config changes needed. DatabaseModule must remain global as today. Models intentionally use scalar owner/source IDs to avoid editing existing model relations; add foreign keys in main migration if desired, preserve provenance on source deletion.

Authenticated routes, existing `{data, meta:{nextCursor}}` list envelope:
- GET /vocabulary?query=&level=&cursor=&limit=; GET /vocabulary/:id
- GET /vocabulary/bookmarks; PUT /vocabulary/:id/bookmark `{note?}`; DELETE same
- GET /expressions?grammarId=&query=&cursor=&limit=
- POST /expressions `{reviewId,variant:"ORIGINAL"|"CORRECTION"|"ALTERNATIVE",note?}`
- PATCH /expressions/:id `{note?}`; DELETE /expressions/:id
- GET /content-imports; POST /content-imports/preview (PreviewImportDto)
- GET /content-imports/:id?cursor=&limit= (data.candidates and data.nextCursor)
- PATCH /content-candidates/:id/validation `{status:"VALIDATED"|"PENDING"|"REJECTED",note,checkedAgainstSource:boolean}`
- POST /content-imports/:id/commit

Preview accepts <=1000 normalized rows per request. All private candidates start PENDING, malformed content cannot be validated. Only confirmed vocabulary becomes private VocabularyEntry. Confirmed PHRASE candidates become selectable after commit. Never sets masteries, creates study tasks, or publishes user files. Imports deduplicate normalized content across filenames/formats; overlapping rows link to their original batch. Reimport returns duplicate count and original batch when exactly same payload. Revoking validation excludes previously committed vocabulary from future selection.

D: inject exported ContentSelectionService; selectForPractice(userId,grammarId,level,sessionId?) returns max3 expressions matching grammar, max2 vocabulary, max3 private phrases. Full text SERVER-ONLY. Session response must hide personal source expression in REVIEW and record existing session hint reveal before returning text. recordExposure(userId,sessionId,type,id,EXPOSED|USED) writes idempotent exposure only. Supporting grammar receives no formal grade. Content selection failure should be caught by D and use basic correction.

All levels are reference labels. `glosses` stores original dictionary-language senses; `chineseGloss` and `chineseGlossSource` separate personal/translated glosses. Vocabulary fingerprint includes owner scope, original source entry, reading and sense; private row fingerprint retains spelling+reading+meaning, never merges distinct senses/homophones.
