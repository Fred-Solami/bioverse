# Seed data

`facilities.sample.json` is **development sample data only**. Facility names and
locations are plausible Copperbelt entries for demo purposes; coordinates are
approximate and `zhfr_code` values use the `DEV-` prefix so they can never be
mistaken for official ZHFR/MFL codes.

Real facility seeding is the job of the `zhfr` interop adapter (integration #1,
see `docs/INTEROP.md`): ZHFR RESTful API if access terms allow, MOH-Zambia MFL
GitHub data otherwise. The seed script (`npm run seed [file.json]`) accepts any
file in the same shape, and upserts on `zhfr_code`, so swapping in real MFL data
requires no code change.
