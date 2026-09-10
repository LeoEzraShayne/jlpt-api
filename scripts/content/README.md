# Vocabulary and private source ingestion

The reference data is JMdict © Electronic Dictionary Research and Development Group, combined with Jonathan Waller/Tanos reference JLPT classifications mapped to JMdict IDs by Stephen McInerney. Reference classifications are **not official JLPT lists or measured exam frequency**. The data subset and its transformations are CC BY-SA 4.0; see `LICENSE-data.txt`, [EDRDG licensing](https://www.edrdg.org/edrdg/licence.html), [mapping attribution](https://github.com/stephenmk/yomitan-jlpt-vocab), and [Tanos sharing](https://www.tanos.co.uk/jlpt/sharing/). The data license is distinct from application code.

`reference-sample.json` contains 25 mapped words at each of N1–N4 (191 sense/readings records), fetched from the official dictionary on 2026-09-10. Each record stores dictionary source version/checksum, upstream entry ID, mapping commit and URL, reading, restricted senses, and original English glosses. Chinese translations are not fabricated. Transformations: keep exact matching mapped spellings/readings, respect JMdict reading/sense restrictions, retain original glosses, split senses, and attach reference level provenance. Periodically refresh (at least monthly while redistributing an actively maintained dictionary) and retain attribution wherever dictionary content is displayed/exported. Source versions make stale datasets visible.

## Public dictionary

Python standard library is sufficient. Fetching writes only the chosen output/cache directories:

```sh
python3 scripts/content/fetch-reference.py --output /tmp/jlpt-reference-full.json --cache /tmp/jlpt-reference-cache --per-level 0
npx tsx scripts/content/import-reference.ts /tmp/jlpt-reference-full.json
# Against an explicitly selected local/test DATABASE_URL:
npx tsx scripts/content/import-reference.ts /tmp/jlpt-reference-full.json --commit
```

Without `--commit` the CLI validates and prints counts without connecting to the database. Commit is idempotent across repeated versions for unchanged source entry/spelling/reading/sense. It does not deduplicate different readings or meanings. Updated dictionary senses are separate identities; automatic removal of retired senses is intentionally not performed because existing bookmarks/exposures must survive. An administrative quality review can withdraw outdated entries.

## Private user documents

Read the original files without modification. XLS converts to a temporary XLSX using LibreOffice; use bundled Python with `openpyxl` (read only). `textutil` extracts DOC/DOCX and `pdftotext` extracts readable PDF. No OCR, no inference that document titles prove authority. The extractor supports the supplied N1/N2 summary workbook, delimited word tables, and explicit phrase/translation pairs; it reports other layouts for manual review instead of guessing them.

```sh
python3 scripts/content/extract-private.py /path/to/source.xls /path/to/words.doc /path/to/phrases.pdf --output /tmp/jlpt-private-candidates
npx tsx scripts/content/import-private.ts /tmp/jlpt-private-candidates/FILE.preview.json
npx tsx scripts/content/import-private.ts /tmp/jlpt-private-candidates/FILE.preview.json --stage --user-id TEST_USER_ID
```

An explicit existing user ID is required for staging; originals/preview payloads should stay outside the repository. Rows are always PENDING. Normalized format duplicates are suppressed per owner; source filename and asserted level are not identity. Validation requires an explicit source-check acknowledgement and note. Malformed rows need correction and re-preview; no silent repair. After approval, commit adds only confirmed rows to that user's library. Rejection/withdrawal removes committed items from future selection. No automatic publication or additional review queue is created.

## Session integration

Import ContentModule and inject ContentSelectionService. `selectForPractice(userId,grammarId,level,sessionId?)` prioritizes grammar-linked expressions and bookmarks, rotates vocabulary deterministically by session (daily fallback), and avoids the user's recent vocabulary exposures. Pass a session ID for varied successive sessions. Persist returned content IDs/provenance in the session. Personal expression text must remain server-side during REVIEW until the existing hint mechanism records a reveal. ContentExposure tracks EXPOSED/USED only, never formal recall ratings, and cannot change mastery.
