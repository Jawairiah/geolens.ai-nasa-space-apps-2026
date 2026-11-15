import hashlib
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from psycopg.types.json import Jsonb
from psycopg.rows import dict_row

from analysis import compare, scan
from forest import forest_context
from urban_heat import analyze_heat
from lens_previews import lens_previews
from lenses import LENSES, rainfall_result, water_context
from dataset import CELLS, DATA_UNAVAILABLE, REGIONS, load

logger = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(app):
    app.state.observations = load()
    yield


app = FastAPI(title="GeoLens API", lifespan=lifespan)
bearer = HTTPBearer(auto_error=False)


def db():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise HTTPException(503, "Project storage is unavailable")
    return psycopg.connect(url, connect_timeout=5)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def account(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, "Sign in to access this feature")
    with db() as conn:
        row = conn.execute("SELECT account_id FROM sessions WHERE token_hash=%s AND expires>now()",
                           (digest(credentials.credentials),)).fetchone()
    if not row:
        raise HTTPException(401, "Session expired")
    return row[0]


class Login(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=128)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


@app.post("/api/auth/{action}")
def auth(action: Literal["register", "login"], payload: Login):
    username = payload.username.lower()
    with db() as conn:
        if action == "register":
            salt = secrets.token_hex(16)
            encoded = salt + ":" + password_hash(payload.password, salt)
            row = conn.execute("INSERT INTO accounts(username,password_hash) VALUES(%s,%s) ON CONFLICT DO NOTHING RETURNING id",
                               (username, encoded)).fetchone()
            if not row:
                raise HTTPException(409, "Username unavailable")
        else:
            row = conn.execute("SELECT id,password_hash FROM accounts WHERE username=%s", (username,)).fetchone()
            salt, expected = row[1].split(":") if row else ("0"*32, "0"*128)
            if not secrets.compare_digest(password_hash(payload.password, salt), expected) or not row:
                raise HTTPException(401, "Invalid credentials")
        token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO sessions(token_hash,account_id) VALUES(%s,%s)", (digest(token), row[0]))
    return {"token": token}


class Window(BaseModel):
    start: int = Field(ge=2003, le=2024)
    end: int = Field(ge=2003, le=2024)
    quality: Literal["standard", "strict"] = "standard"

    @model_validator(mode="after")
    def chronological(self):
        if self.end < self.start:
            raise ValueError("End year must follow start year")
        return self

    def args(self):
        return self.quality, (self.start-2003)*12, (self.end-2002)*12


class Pair(Window):
    pair: list[str] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def known_cells(self):
        if self.pair[0] == self.pair[1] or any(cell not in CELLS for cell in self.pair):
            raise ValueError("Choose two different districts")
        return self


def evidence(data, manifest, spec, reveal=True):
    if not data:
        raise HTTPException(503, DATA_UNAVAILABLE)
    quality, start, end = spec.args()
    runs = [("Selected settings", quality, start, end)]
    if quality != "strict":
        runs.append(("Stricter quality", "strict", start, end))
    if end-start >= 84:
        runs.extend([("Trim first two years", quality, start+24, end),
                     ("Trim last two years", quality, start, end-24)])
    output = []
    for label, level, first, last in runs:
        record = {"label":label, "quality":level, "start":2003+first//12, "end":2002+last//12}
        record["terra"] = compare(data, spec.pair, "terra", level, first, last)
        if reveal:
            record["aqua"] = compare(data, spec.pair, "aqua", level, first, last)
            common = {r[0] for r in record["terra"]["series"]} & {r[0] for r in record["aqua"]["series"]}
            matched = {(source,cell,level): {t:y for t,y in data.get((source,cell,level),{}).items() if t in common}
                       for source in ("terra","aqua") for cell in spec.pair}
            record["common"] = {source: compare(matched,spec.pair,source,level,first,last)
                                for source in ("terra","aqua")}
        output.append(record)
    return {"request":spec.model_dump(), "manifest":manifest, "units":"NDVI per decade",
            "exploratory":True, "method":"Month fixed effects and 12-month Bartlett HAC; approximate pointwise intervals",
            "runs":output}


@app.get("/api/lenses")
def lens_catalog():
    return {"lenses": LENSES}


@app.get("/api/lenses/previews")
def investigation_previews():
    data_dir = Path(os.getenv("LENS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    return lens_previews(data_dir, app.state.observations)


@app.post("/api/lenses/water-drought/rainfall")
def precipitation(spec: Pair):
    data_dir = Path(os.getenv("LENS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    result = rainfall_result(data_dir, spec.pair, spec.start, spec.end)
    if result is None:
        raise HTTPException(503, "The IMERG precipitation extract is unavailable")
    return result


class WaterInvestigation(Pair):
    season_year: int = Field(default=2024, ge=2021, le=2024)


@app.post("/api/lenses/water-drought/investigate")
def investigate_water(spec: WaterInvestigation):
    data_dir = Path(os.getenv("LENS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    result = water_context(data_dir, spec.pair, spec.start, spec.end, spec.season_year, app.state.observations)
    if result is None:
        raise HTTPException(503, "The IMERG precipitation extract is unavailable")
    return result


class HeatInvestigation(Pair):
    overpass: Literal["day", "night"] = "day"


@app.post("/api/lenses/urban-heat-growth/investigate")
def investigate_heat(spec: HeatInvestigation):
    data_dir = Path(os.getenv("LENS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    result = analyze_heat(data_dir, spec.pair, spec.start, spec.end, spec.overpass, app.state.observations)
    if result is None:
        raise HTTPException(503, "The verified MODIS Urban Heat archive is unavailable")
    return result


@app.post("/api/lenses/land-cover-forest/investigate")
def investigate_forest(spec: Pair):
    data_dir = Path(os.getenv("LENS_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
    result = forest_context(data_dir, spec.pair, spec.start, spec.end)
    if result is None:
        raise HTTPException(503, "The verified MODIS canopy archive is unavailable")
    return result


@app.get("/api/study")
def study():
    _, manifest = app.state.observations
    return {"manifest":manifest, "regions":REGIONS}


@app.post("/api/scan")
def find(spec: Window):
    data, _ = app.state.observations
    if not data:
        raise HTTPException(503, DATA_UNAVAILABLE)
    return scan(data, CELLS, *spec.args())


@app.post("/api/compare")
def comparison(spec: Pair, reveal: bool = False):
    return evidence(*app.state.observations, spec, reveal)


class Project(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    cell: str


@app.post("/api/projects")
def create_project(project: Project, user=Depends(account)):
    polygon = CELLS.get(project.cell)
    if not polygon:
        raise HTTPException(422, "Unknown district")
    with db() as conn:
        row = conn.execute("""INSERT INTO projects(account_id,title,region)
        VALUES(%s,%s,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s),4326))) RETURNING id""",
        (user,project.title,json.dumps(polygon))).fetchone()
    return {"id":row[0], "title":project.title}


@app.get("/api/projects")
def projects(user=Depends(account)):
    with db() as conn:
        rows = conn.execute("SELECT id,title FROM projects WHERE account_id=%s ORDER BY id DESC", (user,)).fetchall()
    return [{"id":i,"title":title} for i,title in rows]


@app.post("/api/projects/{project}/jobs", status_code=202)
def submit(project: int, spec: Pair, user=Depends(account)):
    data, _ = app.state.observations
    if not data:
        raise HTTPException(503, DATA_UNAVAILABLE)
    with db() as conn:
        row = conn.execute("""INSERT INTO jobs(project_id,request)
        SELECT id,%s FROM projects WHERE id=%s AND account_id=%s RETURNING id""",
        (Jsonb(spec.model_dump()),project,user)).fetchone()
    if not row:
        raise HTTPException(404, "Project unavailable")
    return {"id":row[0]}


@app.get("/api/projects/{project}/jobs")
def jobs(project: int, user=Depends(account)):
    _, manifest = app.state.observations
    with db() as conn:
        rows = conn.execute("""SELECT j.id,j.status,j.request,j.result FROM jobs j JOIN projects p ON p.id=j.project_id
        WHERE p.id=%s AND p.account_id=%s
          AND (j.status <> 'complete' OR (j.result->'manifest'->>'mode'='source extract'
               AND j.result->'manifest'->>'version'=%s))
        ORDER BY j.id DESC LIMIT 20""", (project,user,manifest.get("version"))).fetchall()
    return [{"id":i,"status":status,"request":request,"result":result} for i,status,request,result in rows]


class InspectionDraft(Pair):
    title: str = Field(min_length=1, max_length=120)
    question: str = Field(min_length=1, max_length=2000)
    source_version: str = Field(pattern=r"^[a-f0-9]{64}$")


class InspectionAction(BaseModel):
    action: Literal["assigned", "submitted", "returned", "closed"]
    note: str = Field(min_length=1, max_length=4000)
    site: str | None = Field(default=None, max_length=500)
    inspector: str | None = Field(default=None, max_length=40)
    revision: int = Field(ge=1)


def inspection_member(conn, user):
    member = conn.execute("""
        SELECT m.role, a.username FROM inspection_members m
        JOIN accounts a ON a.id=m.account_id WHERE a.id=%s
    """, (user,)).fetchone()
    if not member:
        raise HTTPException(403, "Ask a GeoLens administrator for inspection access")
    return member


def inspection_note(value):
    value = value.strip()
    if not value:
        raise HTTPException(422, "Enter a note or title")
    return value


def inspection_event(conn, case_id, user, action, note):
    conn.execute("""
        INSERT INTO inspection_events(inspection_id,actor_id,action,note)
        VALUES(%s,%s,%s,%s)
    """, (case_id, user, action, note))


@app.get("/api/inspections")
def list_inspections(user=Depends(account)):
    with db() as conn:
        role, username = inspection_member(conn, user)
        cases = conn.cursor(row_factory=dict_row).execute("""
            SELECT i.id,i.title,i.status,a.username AS inspector,i.created_at
            FROM inspections i LEFT JOIN accounts a ON a.id=i.assigned_to
            WHERE %s='reviewer' OR i.assigned_to=%s ORDER BY i.id DESC
        """, (role, user)).fetchall()
        inspectors = []
        if role == "reviewer":
            inspectors = [row[0] for row in conn.execute("""
                SELECT a.username FROM inspection_members m
                JOIN accounts a ON a.id=m.account_id WHERE m.role='inspector'
                ORDER BY a.username
            """).fetchall()]
        return {"role": role, "username": username, "cases": cases, "inspectors": inspectors}


@app.post("/api/inspections", status_code=201)
def create_inspection(draft: InspectionDraft, user=Depends(account)):
    with db() as conn:
        if inspection_member(conn, user)[0] != "reviewer":
            raise HTTPException(403, "Only reviewers can open inspection cases")
        data, manifest = app.state.observations
        if not data:
            raise HTTPException(503, DATA_UNAVAILABLE)
        if manifest.get("version") != draft.source_version:
            raise HTTPException(409, "The source dataset changed. Run the comparison again")
        spec = Pair.model_validate(draft.model_dump())
        snapshot = evidence(data, manifest, spec)
        if snapshot["runs"][0]["terra"]["delta"]["slope"] is None:
            raise HTTPException(422, "Choose a comparison with enough shared Terra observations")
        case_id = conn.execute("""
            INSERT INTO inspections(created_by,title,evidence) VALUES(%s,%s,%s) RETURNING id
        """, (user, inspection_note(draft.title), Jsonb(snapshot))).fetchone()[0]
        inspection_event(conn, case_id, user, "created", inspection_note(draft.question))
        return {"id": case_id}


@app.get("/api/inspections/{case_id}")
def inspection_detail(case_id: int, user=Depends(account)):
    with db() as conn:
        role, _ = inspection_member(conn, user)
        case = conn.cursor(row_factory=dict_row).execute("""
            SELECT i.id,i.title,i.status,a.username AS inspector,i.created_at,i.site,i.evidence,
              (SELECT max(e.id) FROM inspection_events e WHERE e.inspection_id=i.id) AS revision
            FROM inspections i LEFT JOIN accounts a ON a.id=i.assigned_to
            WHERE i.id=%s AND (%s='reviewer' OR i.assigned_to=%s)
        """, (case_id, role, user)).fetchone()
        if not case:
            raise HTTPException(404, "Inspection case unavailable")
        case["events"] = conn.cursor(row_factory=dict_row).execute("""
            SELECT e.id,e.action,e.note,e.created_at,a.username AS actor FROM inspection_events e
            JOIN accounts a ON a.id=e.actor_id WHERE e.inspection_id=%s AND e.id<=%s ORDER BY e.id
        """, (case_id, case["revision"])).fetchall()
        return case


INSPECTION_TRANSITIONS = {
    "assigned": ("review", "reviewer", "assigned"),
    "submitted": ("assigned", "inspector", "submitted"),
    "returned": ("submitted", "reviewer", "assigned"),
    "closed": ("submitted", "reviewer", "closed"),
}


@app.post("/api/inspections/{case_id}/actions")
def act_on_inspection(case_id: int, payload: InspectionAction, user=Depends(account)):
    current, required_role, next_status = INSPECTION_TRANSITIONS[payload.action]
    with db() as conn:
        role, _ = inspection_member(conn, user)
        case = conn.execute("""
            SELECT status,assigned_to,site FROM inspections
            WHERE id=%s AND (%s='reviewer' OR assigned_to=%s) FOR UPDATE
        """, (case_id, role, user)).fetchone()
        if not case:
            raise HTTPException(404, "Inspection case unavailable")
        if role != required_role:
            raise HTTPException(403, "Your inspection role cannot perform this action")
        revision = conn.execute("SELECT max(id) FROM inspection_events WHERE inspection_id=%s",
                                (case_id,)).fetchone()[0]
        if case[0] != current or revision != payload.revision:
            raise HTTPException(409, "The case has changed. Refresh it before continuing")
        assigned_to, site = case[1:]
        if payload.action == "assigned":
            inspector = conn.execute("""
                SELECT a.id FROM inspection_members m JOIN accounts a ON a.id=m.account_id
                WHERE m.role='inspector' AND a.username=%s
            """, ((payload.inspector or "").strip().lower(),)).fetchone()
            if not inspector:
                raise HTTPException(422, "Select an authorized inspector")
            assigned_to = inspector[0]
            site = inspection_note(payload.site or "")
        conn.execute("UPDATE inspections SET status=%s,assigned_to=%s,site=%s WHERE id=%s",
                     (next_status, assigned_to, site, case_id))
        inspection_event(conn, case_id, user, payload.action, inspection_note(payload.note))
        return {"id": case_id, "status": next_status}


web = Path(os.getenv("WEB_DIST", "/web"))
if (web / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=web/"assets"), name="assets")

    @app.get("/{page:path}", include_in_schema=False)
    def frontend(page: str):
        if page.startswith("api/"):
            raise HTTPException(404, "Unknown API route")
        return FileResponse(web/"index.html")
