# GeoLens

GeoLens is a full-stack Earth observation application. Its Karachi pilot discovers regional NDVI contrasts on Terra, checks the same pair on Aqua, and exposes the sensitivity of the result to date and quality settings.

## Architecture

- `frontend/` contains the React, TypeScript, Vite and Tailwind application. The landing uses a lazy-loaded Three.js Earth with a static-image fallback. The workspace projects selectable administrative districts on a satellite tile basemap and plots matched observations.
- `backend/main.py` serves the UI and API. Read-only comparisons can be explored anonymously. Authenticated accounts can create projects and queue saved comparisons.
- `backend/worker.py` takes jobs from PostgreSQL with row locking and writes completed evidence back. `backend/schema.sql` defines accounts, sessions, projects, regions and jobs.
- `backend/extract.py` submits Terra/Aqua exports to Earth Engine. `backend/prepare.py` validates the exports and creates the CSV, coverage audit and source manifest. `backend/analysis.py` runs the statistical comparisons.
- The full-stack entry point is Docker Compose. The legacy HTML entry points now link to the full-stack application.

## Run locally

Prerequisites are Docker with Compose and internet access to pull the images and install dependencies.

1. Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD` to a strong random alphanumeric value.
2. Run `docker compose up --build` from this directory.
3. Open http://localhost:8000. The API description is at http://localhost:8000/docs.
4. Open **Lenses → Land Cover & Forest Change**. Choose two districts or scan for contrasts. See the data setup below if analysis is unavailable. **Projects** supports saved projects and enables queueing when observations are available.

If `OBSERVATIONS_CSV` is unset, `GET /api/study` reports `manifest.mode: unavailable`. Scan and comparison requests return HTTP 503. With a configured extract, startup checks that the CSV matches the manifest hash, row count, product IDs, and boundary source. Browser basemap imagery requires internet access.

For local frontend development with the backend running on port 8000, run `npm install` and `npm run dev` in `frontend/`.

## Prepare real satellite observations

The packaged pilot includes the 2003–2024 Terra and Aqua observation bundle. Set `OBSERVATIONS_CSV=/data/observations.csv` in `.env` for Docker Compose and run `docker compose up --build`. For a native backend, set `OBSERVATIONS_CSV` to the absolute local CSV path. An explicitly empty setting keeps analysis unavailable. A malformed extract fails startup.

To rebuild it, install the backend Python requirements and authenticate with Earth Engine on your machine. From `backend/`, fetch source rows and run the completeness check:

```powershell
$years = 2003..2024
python extract.py --project YOUR_PROJECT_ID --output ../modis-download --year $years
python prepare.py ../modis-download ../data/observations.csv --require-complete
```

Observation files include accepted NDVI values, a coverage audit with original image IDs and land area denominators, and a manifest. The archive also contains `data/earth-engine-source.zip` with the district aggregates returned by Earth Engine for independent reproduction. Seasons and differences are evaluated over a fixed six-district historical boundary release. The bundled map has no separate Keamari district. The current official district geography needs a verified boundary release before operational use.

Monthly NDVI uses area-weighted native-grid pixels. The contrast is fitted on months valid in both cells, with month-of-year effects and calendar-lag HAC uncertainty. Short or sparse series are flagged. Scans and their pointwise confidence intervals are exploratory. Terra and Aqua share MODIS processing assumptions.

## Verify and deploy

From `backend/`, run `python -m unittest -v`. From `frontend/`, run `npm run build` to type-check and bundle the app. With an empty `OBSERVATIONS_CSV`, confirm Explore displays **Analysis unavailable**, the map still works, and **Compare selected** and **Find contrasting districts** are disabled. In `/docs`, send a valid request to `POST /api/scan` with start 2003, end 2024, and quality standard. Expect HTTP 503. After loading verified observations, smoke-test by scanning, revealing Aqua, downloading evidence, and completing a queued job. Verify project ownership with a second account before public release.

For deployment, build the Docker image, place the API behind a TLS reverse proxy, run the worker as a separate service, and provision PostgreSQL/PostGIS with a persistent volume and backups. Apply `backend/schema.sql` to an empty database. Keep secrets in the deployment platform and use a database URL appropriate to its network. Use ingress rate limits for auth and compute routes and review the session lifecycle before public registration.

The analysis coverage of this release is the six Karachi districts in the OCHA COD-AB release. Worldwide city search uses Open-Meteo geocoding. Analysis in new study areas requires additional region configuration and satellite preparation. The landing Earth visual and basemap are contextual imagery. Analytic results depend on the observation bundle. Historical imagery playback, an independent real-data extraction check, and production-scale security and load testing are release work.

District boundaries: [OCHA Pakistan COD-AB](https://data.humdata.org/dataset/cod-ab-pak), CC BY 3.0 IGO. The source represents Keamari within the older district geography rather than as a separate feature. Existing grid observations must be re-extracted with the district geometry. For an existing database, apply backend/schema.sql to migrate project geometry to MultiPolygon.


## Municipal inspections

For a fresh Compose database the inspection tables are created automatically. With an existing GeoLens database, apply the additive migration before opening Inspections:

```powershell
Get-Content -Raw .\backend\inspections.sql | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U geolens -d geolens
```

Register individual accounts in Projects. A database administrator grants inspection access with the following SQL in the GeoLens database. Replace the two usernames with the accounts you registered.

```sql
INSERT INTO inspection_members (account_id, role)
SELECT id, 'reviewer' FROM accounts WHERE username = 'municipal-reviewer';
INSERT INTO inspection_members (account_id, role)
SELECT id, 'inspector' FROM accounts WHERE username = 'field-inspector';
```

1. Compare Karachi Central and Malir in Explore for 2003–2024 at Standard quality. Select **Open inspection case** and sign in as the reviewer. Enter a title and field question, then open the case. Verify the case's original comparison includes the source manifest and matched-month runs.
2. Assign the visit to the inspector. Enter a specific field site and instructions. Sign out.
3. Sign in as the inspector. Open the assigned case and submit the visit date, observations, and references to supporting evidence.
4. Sign in as the reviewer and close the case with an outcome, or return it with follow-up instructions. Verify the activity history shows each actor and timestamp. A closed case can still be viewed and its original comparison exported.
5. Sign in with an ordinary account without an inspection role. The inspection queue should be denied. An inspector should see only cases assigned to their account.

Reviewers can access the full inspection queue in this single-team pilot. Field evidence consists of notes and document or photo references entered by staff. District trends are screening evidence. The reviewer selects and verifies a specific site before assigning a visit.

## Investigation lenses

The Lenses section lists the three original investigation areas and their core datasets. Earth Engine catalog access and one pilot-area sample per lens have been verified. Water & Drought includes paired 2003–2024 GPM IMERG precipitation comparisons and JSON export. The Water & Drought workflow also includes July–September precipitation anomalies against 2003–2020, a sensitivity run excluding 2010 and 2022, and a 2024 SMAP coverage check. It also compares published GLDAS Noah v2.1 top-10-cm soil moisture and evapotranspiration, and screens matching IMERG, GLDAS and Terra NDVI months. Land Cover & Forest Change reuses the Terra and Aqua greenness analysis. Land Cover & Forest Change compares Terra and Aqua vegetation greenness and annual MOD44B canopy.

Regenerate precipitation with `python extract_rain.py --project YOUR_PROJECT_ID --output ../data/rainfall.json` from the backend directory. For Compose, the dataset is mounted under `/data`.

Regenerate the 2024 SMAP AM archive with `python extract_smap.py --project YOUR_PROJECT_ID --output ../data/smap.json` from the backend directory. It keeps only passing AM retrievals in [0,1] and requires at least five qualifying days per pixel per month. District means are weighted by valid pixel area. Missing records are left absent. The IMERG baseline requires at least 15 complete July–September seasons, and incomplete selected seasons are unavailable.

Regenerate temporal GLDAS coverage and values with `python extract_gldas.py --project YOUR_PROJECT_ID --output ../data/gldas.json` from the backend. The export records the source collection and bands, UTC query windows, source step requirements, valid area and boundary fingerprint. NASA GLDAS is a land model. Its roughly 28 km native grid can overlap several Karachi districts. The mismatch rule uses approximate pointwise confidence intervals as an exploratory screen, and an inconclusive rainfall result does not imply that rainfall was stable.

## Urban Heat & Growth

Open **Lenses → Urban Heat & Growth**. The lens uses Terra MOD11A2 v6.1 surface temperatures for 2003–2024, MCD12Q1 v6.1 land-cover classifications through 2023, and the existing quality-screened Terra NDVI extract. Surface temperatures represent clear-sky observations. The default nighttime/daytime results have separate coverage checks. Use the district trend map for screening and the paired district table for comparison. The district map and extract use the six historical OCHA districts.

The district-local non-built reference includes natural and agricultural land and requires consistent labels in the 2003, 2013, and 2023 anchor years, as does the urban mask. Composites require 30% area coverage and a month requires at least half of its source composites. Both strata must share the composite dates. Each stratum needs at least 5 km² of reference area. Use the annual built-up classifications for context and confirm land changes with site-scale evidence. Inspect shared months and intervals alongside the estimates.

Regenerate the archive from `backend/` with `python extract_heat.py --project YOUR_PROJECT_ID --output ../data/heat.json`. The included evidence export identifies the source collections, historical boundary fingerprint, MOD11A2 image IDs, paired composite dates, and classification image IDs. The application uses the cached source extract under the existing `LENS_DATA_DIR`.

## Land Cover & Forest Change

The old Explore route redirects to this lens. Use the district map and comparison controls, then review the independent NDVI and canopy panels. The combined evidence JSON contains both analyses and source image IDs. The NDVI result also links to Inspections. Annual MOD44B canopy estimates are based on the same valid pixels across the 2003–2024 archive. The annual table reports MOD44B input quality separately. The optional MCD12Q1 2023 built-up summary provides land-cover context.

Regenerate from the backend with `python extract_canopy.py --project YOUR_PROJECT_ID --output ../data/canopy.json`.
