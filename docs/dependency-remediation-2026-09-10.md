# API dependency remediation — 2026-09-10

CI run `34491508562` failed the existing high-severity audit gate. This change
removes the reported vulnerabilities without changing application code, schema,
CI policy, or the locked Prisma 7.9.1 / Nest 11.1.28 versions.

| Dependency | Locked change | Resolution |
| --- | --- | --- |
| deepmerge-ts | 7.1.5 → 8.0.2 | Exact override under `@prisma/config@7.9.1` |
| mysql2 | 3.15.3 → 3.24.4 | Exact override under `prisma` |
| multer | 2.2.0 → 2.3.0 | Exact override under `@nestjs/platform-express` |
| fast-uri | 3.1.5 → 3.1.7 | Existing compatible dependency range |
| js-yaml | 3.15.1 → 3.15.2; 4.3.1 → 4.3.2 | Existing compatible dependency ranges |
| qs | 6.15.3 → 6.16.0 | Existing compatible dependency range |

Published package manifests for Prisma 7.10.0 and Nest platform-express 11.2.3
still pin the affected versions, so upgrading those frameworks alone does not
resolve this audit. Overrides are limited to their owning dependency chains;
there is no global replacement or forced framework downgrade. Recheck and remove
each override when its parent incorporates the security fix. In particular,
re-evaluate the version-qualified config override on any Prisma upgrade.

Compatibility evidence:

- [Deepmerge v8 release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
  identify circular-reference fixes and changes to Map merging, `deepmergeInto`,
  and type names. [Prisma's config loader](https://github.com/prisma/prisma/blob/7.9.1/packages/config/src/loadConfigFromFile.ts)
  uses the retained `deepmerge` export with c12. This project's config contains
  plain records and strings, without Maps or custom merge callbacks. The actual
  loader preserved the schema path, migration path and datasource in an explicit
  assertion check; Prisma validation and generation also passed with the override.
- [Multer 2.3.0](https://github.com/expressjs/multer/releases/tag/v2.3.0)
  fixes the multipart denial-of-service advisories within major version 2.
  This application has no Multer interceptor/upload handler; its HTTP integration
  suite still exercises the Nest Express adapter.
- [MySQL2 3.24.0](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.0)
  and [3.24.4](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.4)
  provide the patched major-version-3 line. MySQL2 belongs to Prisma tooling;
  this application uses the unchanged PostgreSQL adapter. MySQL server/Studio
  workflows were not tested or claimed as supported by this verification.

Verification in a separate worktree with its own installed node_modules, using
Node 22.23.2 (CI's Node major) and npm 11.19.0:

- Clean `npm ci`, `npx prisma validate`, `npx prisma generate`, `npm run build`: pass.
- `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high`:
  **0 vulnerabilities**, including moderate/low at verification time.
- `npm test -- --runInBand`: **183 tests / 35 suites pass**.
- `npm run test:integration`: **30 tests / 7 suites pass**, real local PostgreSQL.
- `npm run test:migration`: legacy/history/budget and concurrent uniqueness pass.
- `npm run check:lines`: **143 files pass**.

Database tests create and remove their own random local databases. No production
environment, credentials, persistent database, or remote branch was modified.
Install warnings about pre-existing deprecated glob/inflight packages remain;
the audit gate was neither suppressed nor weakened.
