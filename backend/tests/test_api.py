from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.season import mars_ls

COLAB_SITES = [
    ("Gale", -4.5895, 137.4417, 90.0, 14.0, -16.40, 0.82, -36.89, 4.74, 826.01, 4.39),
    ("Jezero", 18.4446, 77.4509, 270.0, 10.0, -37.16, 7.37, -59.02, 4.68, 814.09, 2.14),
    ("Olympus", 18.65, 226.2, 180.0, 12.0, 15.63, 2.88, -48.14, 23.58, 86.31, 1.04),
    ("Hellas", -42.4, 70.5, 0.0, 15.0, -28.49, 1.75, -42.54, 6.99, 1009.32, 0.09),
    ("Elysium", 4.50, 135.62, 135.0, 6.0, -81.79, 4.91, -81.36, 1.23, 640.66, 0.06),
    ("Utopia", 47.6, 134.3, 225.0, 22.0, -105.28, 1.76, -103.94, 0.69, 937.76, 1.77),
]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def analyse(client, lat, lon, ls, local_time):
    response = client.get("/api/analyse", params={"lat": lat, "lon": lon, "ls": ls, "local_time": local_time})
    assert response.status_code == 200, response.text
    return response.json()


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["model"]["training_samples"] == 360
    assert body["terrain_grid"] == {"rows": 720, "cols": 1440, "resolution_deg": 0.25}
    assert body["typical_error"]["surface_temperature_c"] == pytest.approx(8.7426, abs=1e-3)


def test_olympus_matches_colab(client):
    body = analyse(client, 18.65, 226.2, 180, 12)
    assert body["terrain"]["elevation_m"] == 20009.0
    assert body["terrain"]["mola_count"] == 732
    assert body["terrain"]["terrain_pattern"] == "Highly rugged terrain pattern"
    prediction = body["prediction"]
    assert prediction["surface_temperature_c"] == pytest.approx(12.752520958333356, abs=1e-6)
    assert prediction["air_temperature_c"] == pytest.approx(-24.5566519083333, abs=1e-6)
    assert prediction["pressure_pa"] == pytest.approx(85.41663316797849, abs=1e-6)
    assert body["status"] == "outside_training_range"
    assert body["range_warnings"][0]["feature"] == "elevation_m"


@pytest.mark.parametrize("name,lat,lon,ls,lt,mcd_s,err_s,mcd_a,err_a,mcd_p,err_p", COLAB_SITES)
def test_reproduces_colab_verification(client, name, lat, lon, ls, lt, mcd_s, err_s, mcd_a, err_a, mcd_p, err_p):
    prediction = analyse(client, lat, lon, ls, lt)["prediction"]
    assert abs(prediction["surface_temperature_c"] - mcd_s) == pytest.approx(err_s, abs=0.03)
    assert abs(prediction["air_temperature_c"] - mcd_a) == pytest.approx(err_a, abs=0.03)
    assert abs(prediction["pressure_pa"] - mcd_p) / mcd_p * 100 == pytest.approx(err_p, abs=0.05)


def test_in_range_site_is_flagged_inside(client):
    body = analyse(client, -4.5895, 137.4417, 90, 14)
    assert body["status"] == "inside_training_range"
    assert body["range_warnings"] == []


def test_longitude_wrapping_is_equivalent(client):
    east = analyse(client, 10.0, 200.0, 100, 9)["prediction"]
    west = analyse(client, 10.0, -160.0, 100, 9)["prediction"]
    assert east == west


@pytest.mark.parametrize("params", [
    {"lat": 91, "lon": 10},
    {"lat": 10, "lon": 361},
    {"lat": 10, "lon": -181},
    {"lat": 10, "lon": 10, "ls": 361},
    {"lat": 10, "lon": 10, "local_time": 24},
    {"lat": 10, "lon": 10, "local_time": -1},
    {"lat": "abc", "lon": 10},
])
def test_invalid_input_is_rejected(client, params):
    assert client.get("/api/analyse", params=params).status_code == 422


def test_missing_ls_uses_current_season(client):
    body = client.get("/api/analyse", params={"lat": 10, "lon": 20}).json()
    assert body["request"]["ls_source"] == "current_date"
    assert 0 <= body["request"]["ls"] < 360


def test_day_curve_consistent_with_point(client):
    curve = client.get("/api/day-curve", params={"lat": -4.5895, "lon": 137.4417, "ls": 90}).json()
    assert len(curve["hours"]) == 48
    point = analyse(client, -4.5895, 137.4417, 90, 14.0)["prediction"]
    index = curve["hours"].index(14.0)
    assert curve["surface_temperature_c"][index] == pytest.approx(point["surface_temperature_c"], abs=1e-2)
    assert curve["summary"]["warmest_surface_c"] == pytest.approx(max(curve["surface_temperature_c"]), abs=1e-3)
    daylight = curve["summary"]["daylight"]
    assert daylight["kind"] == "normal"
    assert 5 < daylight["sunrise_h"] < 7 and 17 < daylight["sunset_h"] < 19


def test_day_curve_polar_conditions(client):
    night = client.get("/api/day-curve", params={"lat": 80, "lon": 0, "ls": 270}).json()
    day = client.get("/api/day-curve", params={"lat": 80, "lon": 0, "ls": 90}).json()
    assert night["summary"]["daylight"]["kind"] == "polar_night"
    assert not any(night["sun_above_horizon"])
    assert day["summary"]["daylight"]["kind"] == "polar_day"
    assert all(day["sun_above_horizon"])


@pytest.mark.parametrize("step", [0.1, 3])
def test_day_curve_rejects_bad_step(client, step):
    assert client.get("/api/day-curve", params={"lat": 0, "lon": 0, "ls": 0, "step_hours": step}).status_code == 422


@pytest.mark.parametrize("moment,expected", [
    (datetime(2021, 2, 18, 20, 55, tzinfo=timezone.utc), 5.2),
    (datetime(2012, 8, 6, 5, 17, tzinfo=timezone.utc), 150.7),
    (datetime(2018, 11, 26, 19, 52, tzinfo=timezone.utc), 295.0),
    (datetime(2008, 5, 25, 23, 38, tzinfo=timezone.utc), 76.5),
])
def test_mars_ls_matches_known_landings(moment, expected):
    assert mars_ls(moment) == pytest.approx(expected, abs=1.0)


def test_cors_allows_vite_dev_origin(client):
    response = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_terrain_patch_shape_and_consistency(client):
    params = {"lat_min": -6.5, "lat_max": -3.5, "lon_min": 136.0, "lon_max": 139.0, "size": 60}
    body = client.get("/api/terrain-patch", params=params).json()
    rows, cols = body["rows"], body["cols"]
    assert max(rows, cols) == 60
    assert len(body["elevation_m"]) == rows and len(body["elevation_m"][0]) == cols
    assert len(body["cluster"]) == rows and len(body["cluster"][0]) == cols
    assert body["regions"] and all(0 <= r["row"] < rows and 0 <= r["col"] < cols for r in body["regions"])
    row, col = rows // 2, cols // 2
    lat = body["lat_max"] - (body["lat_max"] - body["lat_min"]) * row / (rows - 1)
    lon = body["lon_min"] + (body["lon_max"] - body["lon_min"]) * col / (cols - 1)
    point = client.get("/api/analyse", params={"lat": lat, "lon": lon, "ls": 90, "local_time": 12}).json()["terrain"]
    assert body["cluster"][row][col] == point["terrain_cluster"]
    assert abs(body["elevation_m"][row][col] - point["elevation_m"]) < 800


def test_terrain_patch_wraps_longitude_seam(client):
    body = client.get("/api/terrain-patch", params={"lat_min": -5, "lat_max": 5, "lon_min": -3, "lon_max": 3}).json()
    assert body["rows"] > 0 and all(abs(v) < 30000 for v in body["elevation_m"][0])


@pytest.mark.parametrize("params", [
    {"lat_min": 5, "lat_max": 0, "lon_min": 0, "lon_max": 3},
    {"lat_min": 0, "lat_max": 3, "lon_min": 3, "lon_max": 0},
    {"lat_min": -90, "lat_max": 90, "lon_min": 0, "lon_max": 3},
    {"lat_min": 0, "lat_max": 3, "lon_min": 0, "lon_max": 3, "size": 500},
])
def test_terrain_patch_rejects_bad_input(client, params):
    assert client.get("/api/terrain-patch", params=params).status_code == 422
