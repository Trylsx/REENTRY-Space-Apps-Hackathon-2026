import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from .engine import QuantumEcho
from .mcd import MCDServiceError, fetch_mcd_environment
from .season import mars_ls, season_label

DATA_DIR = Path(os.environ.get("QUANTUM_ECHO_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173"
ORIGINS = [o.strip() for o in os.environ.get("QUANTUM_ECHO_CORS_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app):
    app.state.engine = QuantumEcho(DATA_DIR)
    yield


app = FastAPI(title="Quantum Echo API", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET"], allow_headers=["*"])


def current_season():
    ls = mars_ls(datetime.now(timezone.utc))
    return {"ls": ls, "label": season_label(ls), "source": "current_date"}


def resolve_ls(ls):
    if ls is not None:
        return float(ls), "request"
    return current_season()["ls"], "current_date"


@app.get("/api/health")
def health(request: Request):
    engine = request.app.state.engine
    return {
        "status": "ok",
        "model": engine.model_info(),
        "typical_error": engine.typical_error(),
        "terrain_grid": {"rows": engine.n_rows, "cols": engine.n_cols, "resolution_deg": 0.25},
    }


@app.get("/api/season")
def season(date: datetime | None = Query(default=None)):
    if date is None:
        return current_season()
    ls = mars_ls(date)
    return {"ls": ls, "label": season_label(ls), "source": "request"}


@app.get("/api/analyse")
def analyse(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=360),
    ls: float | None = Query(default=None, ge=0, le=360),
    local_time: float = Query(default=12.0, ge=0, lt=24),
):
    ls_value, ls_source = resolve_ls(ls)
    try:
        result = request.app.state.engine.predict(lat, lon, ls_value, local_time)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    result["request"]["ls_source"] = ls_source
    result["request"]["season_label"] = season_label(ls_value)
    return result


@app.get("/api/day-curve")
def day_curve(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=360),
    ls: float | None = Query(default=None, ge=0, le=360),
    step_hours: float = Query(default=0.5, ge=0.25, le=2.0),
):
    ls_value, ls_source = resolve_ls(ls)
    try:
        result = request.app.state.engine.day_curve(lat, lon, ls_value, step_hours)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    result["request"]["ls_source"] = ls_source
    result["request"]["season_label"] = season_label(ls_value)
    return result


@app.get("/api/environment")
def environment(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=360),
    ls: float | None = Query(default=None, ge=0, le=360),
    local_time: float = Query(default=12.0, ge=0, lt=24),
):
    ls_value, ls_source = resolve_ls(ls)
    try:
        result = fetch_mcd_environment(lat, lon, ls_value, local_time)
    except MCDServiceError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    result["request"]["ls_source"] = ls_source
    result["request"]["season_label"] = season_label(ls_value)
    return result


@app.get("/api/terrain-patch")
def terrain_patch(
    request: Request,
    lat_min: float = Query(..., ge=-90, le=90),
    lat_max: float = Query(..., ge=-90, le=90),
    lon_min: float = Query(..., ge=-540, le=540),
    lon_max: float = Query(..., ge=-540, le=540),
    size: int = Query(default=96, ge=24, le=160),
):
    if lat_max - lat_min < 0.05 or lon_max - lon_min < 0.05:
        raise HTTPException(status_code=422, detail="Patch is too small")
    if lat_max - lat_min > 90 or lon_max - lon_min > 90:
        raise HTTPException(status_code=422, detail="Patch is too large")
    return request.app.state.engine.terrain_patch(lat_min, lat_max, lon_min, lon_max, size)
