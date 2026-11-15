from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app import mcd
from app.main import app

ATMOSPHERE_HTML = """
<ul>
  <li>Pressure (Pa) ... 179.68806</li>
  <li>Density (kg/m3) ... 0.004191033</li>
  <li>W-E wind component (m/s) ... 7.8842306</li>
  <li>S-N wind component (m/s) ... -0.9118084</li>
</ul>
"""

DUST_HTML = """
<ul>
  <li>Monthly mean dust column ... 0.0932237</li>
  <li>Daily mean dust column ... 0.12666485</li>
  <li>Dust mass mixing ratio (kg/kg) ... 3.0834944e-06</li>
  <li>Dust effective radius (m) ... 1.6018012e-06</li>
</ul>
"""


class FakeResponse:
    def __init__(self, content):
        self.content = content.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return self.content


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_environment_endpoint_returns_notebook_atmosphere_and_dust(client, monkeypatch):
    pages = iter((ATMOSPHERE_HTML, DUST_HTML))
    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse(next(pages))

    monkeypatch.setattr(mcd, "urlopen", fake_urlopen)
    response = client.get(
        "/api/environment",
        params={"lat": 18.65, "lon": -133.8, "ls": 180, "local_time": 12},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "Mars Climate Database model output, not live measurements."
    assert body["dust_scenario"] == "dust=1 (climatology average solar)"
    assert body["request"]["longitude"] == pytest.approx(226.2)
    assert body["atmosphere"]["pressure_pa"] == pytest.approx(179.68806)
    assert body["atmosphere"]["density_kg_m3"] == pytest.approx(0.004191033)
    assert body["atmosphere"]["wind_speed_ms"] == pytest.approx(7.937)
    assert body["atmosphere"]["wind_direction_deg"] == pytest.approx(96.6)
    assert body["dust"]["monthly_optical_depth"] == pytest.approx(0.0932237)
    assert body["dust"]["daily_optical_depth"] == pytest.approx(0.12666485)
    assert body["dust"]["dust_mass_mixing_ratio"] == pytest.approx(3.0834944e-06)
    assert body["dust"]["dust_effective_radius_m"] == pytest.approx(1.6018012e-06)

    atmosphere_params = parse_qs(urlsplit(requests[0][0].full_url).query)
    dust_params = parse_qs(urlsplit(requests[1][0].full_url).query)
    assert [atmosphere_params[f"var{i}"][0] for i in range(1, 5)] == ["p", "rho", "u", "v"]
    assert [dust_params[f"var{i}"][0] for i in range(1, 5)] == [
        "dod", "tauref", "dust_mmr", "dust_reff"
    ]
    assert atmosphere_params["dust"] == dust_params["dust"] == ["1"]
    assert atmosphere_params["altitude"] == dust_params["altitude"] == ["1"]
    assert all(timeout == mcd.MCD_TIMEOUT_SECONDS for _, timeout in requests)


def test_environment_endpoint_surfaces_mcd_response_errors(client, monkeypatch):
    monkeypatch.setattr(mcd, "urlopen", lambda request, timeout: FakeResponse("<ul><li>No data</li></ul>"))

    response = client.get(
        "/api/environment",
        params={"lat": 0, "lon": 0, "ls": 90, "local_time": 12},
    )

    assert response.status_code == 502
    assert "did not include pressure" in response.json()["detail"]


def test_environment_endpoint_validates_inputs(client):
    response = client.get("/api/environment", params={"lat": 91, "lon": 0})

    assert response.status_code == 422
