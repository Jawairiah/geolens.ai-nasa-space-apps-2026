# GeoLens.ai

**See more. Analyze better.**

GeoLens is an Earth observation platform built for the **NASA Space Apps Challenge 2026**. It helps people investigate how rainfall, surface heat, and vegetation have changed across Karachi’s historical districts. Choose two districts, compare the satellite records, and see how much the evidence supports the result.

**[Live demo](https://geolensai-nasa-space-apps-2026.vercel.app/)** · **[Open the lenses](https://geolensai-nasa-space-apps-2026.vercel.app/lenses)** · **[Inspection demo](https://geolensai-nasa-space-apps-2026.vercel.app/inspections/demo)**

## What you can investigate

| Lens | What it shows |
| --- | --- |
| **Water & Drought Intelligence** | Compare monthly rainfall trends and July–September anomalies. Check modeled soil moisture and evapotranspiration, and review the 2024 SMAP coverage check. |
| **Urban Heat & Growth Intelligence** | Compare daytime and nighttime land-surface temperature. Explore heat contrasts between built-up and non-built land and review annual land-cover context. |
| **Land Cover & Forest Change** | Compare monthly vegetation greenness (NDVI) and annual tree-canopy estimates. Cross-check Terra greenness trends with Aqua and review the 2023 land-cover snapshot. |

Each lens includes an interactive district map, key findings, and separate pages for **Trend estimates**, **Observation records**, and **Sources & methods**. You can filter records by year, download the evidence as JSON, and share a detail-page URL that preserves the comparison settings.

### Try the demo

1. Open **Lenses → Land Cover & Forest Change**.
2. Select **Karachi East** and **Malir**, set **2003–2024** and **Standard** quality, then click **Compare selected**.
3. Under **Ask about this comparison**, choose **Is the change statistically significant?** and read the finding for the difference between districts.
4. Open **Trend estimates** or **Observation records** to see the chart and the values behind it.

The public comparison and [practice inspection](https://geolensai-nasa-space-apps-2026.vercel.app/inspections/demo) are available without signing in. Practice notes stay in the current browser tab and clear when you leave the demo. Persistent staff workflows require PostgreSQL/PostGIS and configured reviewer or inspector roles.

## Data and attribution

GeoLens uses district-level extracts prepared through Google Earth Engine. The deployed backend reads those files and calculates comparisons on request. Earth Engine credentials are required to refresh the extracts. Dataset coverage and quality vary by product and are shown in **Sources & methods**.

| Source | Role in GeoLens |
| --- | --- |
| [NASA GPM IMERG Monthly V07](https://developers.google.com/earth-engine/datasets/catalog/NASA_GPM_L3_IMERG_MONTHLY_V07) | Monthly rainfall and monsoon anomalies |
| [NASA GLDAS Noah v2.1](https://developers.google.com/earth-engine/datasets/catalog/NASA_GLDAS_V021_NOAH_G025_T3H) | Modeled soil moisture and evapotranspiration |
| [NASA SMAP SPL3SMP_E v006](https://developers.google.com/earth-engine/datasets/catalog/NASA_SMAP_SPL3SMP_E_006) | 2024 satellite soil-moisture coverage check |
| [Terra MODIS MOD11A2 v6.1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A2) | Daytime and nighttime land-surface temperature |
| [MODIS MCD12Q1 v6.1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD12Q1) | Built-up and non-built classification and land-cover context |
| [Terra MODIS MOD13A3 v6.1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13A3) | Monthly vegetation greenness (NDVI) |
| [Aqua MODIS MYD13A3 v6.1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MYD13A3) | Cross-check for the Terra greenness comparison |
| [Terra MODIS MOD44B v6.1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD44B) | Annual tree-canopy cover estimates |

District boundaries come from [OCHA Pakistan COD-AB](https://data.humdata.org/dataset/cod-ab-pak) under CC BY 3.0 IGO. The pilot uses six historical Karachi districts, with Keamari represented within the older geography. The globe uses [NASA Blue Marble](https://science.nasa.gov/resource/blue-marble/) imagery. The district map credits Esri and contributors for the optional satellite basemap.

### How to interpret the evidence

- **Greenness and canopy cover measure different quantities.** NDVI captures vegetation greenness, and MOD44B estimates annual tree-canopy cover.
- **Surface temperature measures ground and built surfaces.** Review the separate daytime and nighttime coverage and use field observations to assess site conditions.
- **Compare uncertainty alongside trend estimates.** The monthly paired analysis uses shared months, accounts for seasonal effects, and reports approximate intervals. If the interval for the district difference includes zero, the result is inconclusive.
- **Use district trends for screening.** The 2023 land-cover snapshot provides context. Confirm individual land changes and causes with site-scale evidence.

## Run locally

### Public demo with Docker

From the repo root, with Docker running:

```powershell
docker build -t geolens-demo .
docker run --rm -p 127.0.0.1:8000:8000 geolens-demo
```

Open [http://localhost:8000](http://localhost:8000). See [API docs](http://localhost:8000/docs) or confirm dataset loading at [`/api/study`](http://localhost:8000/api/study), where `manifest.mode` should be `"source extract"`.

### Local staff workflows with Docker Compose

If you want to try saved projects, queued comparisons, or persistent inspections, copy [`.env.example`](.env.example) to `.env` and set a strong `POSTGRES_PASSWORD`. Keep `OBSERVATIONS_CSV=/data/observations.csv` and run:

```powershell
docker compose up --build
```

Compose starts the API, PostgreSQL/PostGIS, and the job worker. Its database initialization applies [`backend/schema.sql`](backend/schema.sql) and [`backend/inspections.sql`](backend/inspections.sql) on a fresh data volume. For an existing database, apply the inspection migration explicitly. A database administrator assigns staff roles through the `inspection_members` table.

### Development checks

Run the backend tests from `backend/` with `python -m unittest -v` after installing its requirements. Use `npm ci` and `npm run build` from `frontend/` to type-check and bundle the UI. With the API running on port 8000, `npm run dev` in `frontend/` starts the Vite development server.

## Deployment and data refresh

The live demo deploys to **Vercel’s Container runtime**. The root [`Dockerfile`](Dockerfile) builds the React frontend, copies the observation extracts into `/data`, and starts FastAPI on port `8000`. [`vercel.json`](vercel.json) selects the Container preset. In Vercel, use the repository root and set **`PORT=8000`** for the target environment. The public demo can run with `DATABASE_URL` unset.

The loader verifies the observation CSV and district geometry against the source manifest. [`.gitattributes`](.gitattributes) preserves the exact bytes of those files across Git checkouts. After deploying a refreshed dataset, check the production [study endpoint](https://geolensai-nasa-space-apps-2026.vercel.app/api/study) and run one comparison in each lens.

To refresh the exports, use a registered Earth Engine project with the API enabled. From `backend/`, install `requirements.txt`, authenticate with `earthengine authenticate`, and run the extraction commands for the datasets you want to update. These PowerShell commands regenerate the pilot’s configured observation periods:

```powershell
$project = "YOUR_GOOGLE_CLOUD_PROJECT_ID"
$years = 2003..2024
python extract.py --project $project --output ../modis-download --year $years
python prepare.py ../modis-download ../data/observations.csv --require-complete

python extract_rain.py --project $project --output ../data/rainfall.json
python extract_gldas.py --project $project --output ../data/gldas.json
python extract_smap.py --project $project --output ../data/smap.json
python extract_heat.py --project $project --output ../data/heat.json
python extract_canopy.py --project $project --output ../data/canopy.json
```

## Tech stack

- **Frontend** · React, TypeScript, Vite, Tailwind CSS, and Three.js
- **Backend** · FastAPI and NumPy
- **Data preparation** · Google Earth Engine and Python
- **Storage and hosting** · PostgreSQL/PostGIS for staff workflows, Docker and Vercel for the public demo

## Team

**Maham Mohsin** · **Jawairia Hammad** · **Huzaila Asif** · **Manha Fatima**
