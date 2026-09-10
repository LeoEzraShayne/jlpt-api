# JLPT API

NestJS + Prisma backend for the JLPT grammar learning application. All routes use the `/api/v1` prefix.

## Local verification

```bash
cp .env.example .env
npm ci
npm run build
npm test -- --runInBand
npm run check:lines
```

## Database and grammar import

```bash
npx prisma migrate deploy
npm run import:grammar -- --dry-run
npm run import:grammar -- --commit
```

The bundled source imports 223 formal grammar points: N1=40, N2=40, N3=100, N4=0, N5=43. N1 confusion notes become relation groups and are not counted as grammar points.

## API groups

- Authentication: `auth/google`, `auth/google/callback`, `auth/logout`
- User: `me`, `me/preferences`
- Content: `grammar-points`, `grammar-points/:id`, `grammar-levels`
- Planning: `study-plans`, `study-plans/current`, `dashboard/today`, `review-queue`
- Learning: `study-sessions`, `study-sessions/:id/reveal`, `study-sessions/:id/complete`
- AI: `sentence-reviews`, `sentence-reviews/:id`, `sentence-reviews/:id/retry`
- History: `sentence-attempts`, `sentence-attempts/:id`, `sentence-attempts/:id/practice-again`
- Admin: `admin/imports/*`, `admin/grammar-points/*`
- Readiness: `health`

Production secrets belong only in `/var/www/jlpt-api/.env`. Never commit `.env`, key files, cookies, or provider tokens.
