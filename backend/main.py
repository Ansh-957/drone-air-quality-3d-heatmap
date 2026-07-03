# FastAPI backend for 3D air quality telemetry visualization.
#
# Endpoints:
#   POST /telemetry        — ingest a single sensor reading (for ESP32 / live use)
#   GET  /heatmap          — run 3D RBF interpolation, return voxel grid as JSON
#   POST /load-synthetic   — bulk-load synthetic_flight.json for testing
#   GET  /debug/stats      — quick summary of ingested data (for debugging)

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import TelemetryPoint
from kriging import interpolate_3d

app = FastAPI(title="Air Quality Telemetry API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

telemetry_store: list[dict] = []


@app.post("/telemetry")
async def ingest(point: TelemetryPoint):
    telemetry_store.append(point.dict())
    return {"status": "ok", "total": len(telemetry_store)}


@app.get("/heatmap")
async def get_heatmap(metric: str = "pm25"):
    if len(telemetry_store) < 10:
        return {"error": "not enough data points yet"}
    return {"voxels": interpolate_3d(telemetry_store, metric)}


@app.post("/load-synthetic")
async def load_synthetic():
    """Bulk-load synthetic_flight.json into the telemetry store for testing."""
    global telemetry_store
    path = Path(__file__).parent / "synthetic_flight.json"
    if not path.exists():
        return {"error": "synthetic_flight.json not found — run synthetic_telemetry.py first"}
    with open(path) as f:
        data = json.load(f)
    telemetry_store = data
    pm_vals = [p.get("pm25", 0) for p in data]
    return {
        "status": "loaded",
        "total": len(data),
        "pm25_range": [min(pm_vals), max(pm_vals)],
    }


@app.get("/debug/stats")
async def debug_stats():
    """Quick summary of what's in the telemetry store."""
    if not telemetry_store:
        return {"total": 0}
    pm_vals = [p.get("pm25", 0) for p in telemetry_store]
    lats = [p["lat"] for p in telemetry_store]
    lons = [p["lon"] for p in telemetry_store]
    alts = [p["alt"] for p in telemetry_store]
    return {
        "total": len(telemetry_store),
        "pm25": {"min": min(pm_vals), "max": max(pm_vals)},
        "lat": {"min": min(lats), "max": max(lats)},
        "lon": {"min": min(lons), "max": max(lons)},
        "alt": {"min": min(alts), "max": max(alts)},
    }