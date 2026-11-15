from html.parser import HTMLParser
import math
import re
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

MCD_CGI = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
MCD_TIMEOUT_SECONDS = 45
NUMBER_PATTERN = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")


class MCDServiceError(RuntimeError):
    pass


class _ListItemParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self._parts = []
        self._in_item = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "li":
            self._parts = []
            self._in_item = True

    def handle_data(self, data):
        if self._in_item:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "li" and self._in_item:
            self.items.append(" ".join(self._parts).strip())
            self._in_item = False


def _query_items(variables, latitude, longitude, ls, local_time):
    params = {
        f"var{index}": variable
        for index, variable in enumerate(variables, start=1)
    }
    params.update({
        "datekeyhtml": "1",
        "ls": str(ls),
        "localtime": str(local_time),
        "latitude": str(latitude),
        "longitude": str(longitude),
        "altitude": "1",
        "zkey": "3",
        "dust": "1",
        "hrkey": "0",
        "isfixedlt": "off",
        "averaging": "off",
        "animation": "off",
    })
    request = Request(
        f"{MCD_CGI}?{urlencode(params)}",
        headers={"User-Agent": "Marswalk Quantum Echo"},
    )
    try:
        with urlopen(request, timeout=MCD_TIMEOUT_SECONDS) as response:
            html = response.read().decode("utf-8", errors="replace")
    except (URLError, TimeoutError, OSError) as error:
        raise MCDServiceError(f"Could not reach the Mars Climate Database: {error}") from error

    parser = _ListItemParser()
    parser.feed(html)
    return parser.items


def _value(items, prefix, label):
    for item in items:
        parts = re.split(r"\s*\.{3,}\s*", item)
        if len(parts) < 2 or not parts[0].strip().lower().startswith(prefix.lower()):
            continue
        match = NUMBER_PATTERN.search(parts[-1])
        if match is None:
            raise MCDServiceError(f"The MCD response contained an invalid {label} value.")
        value = float(match.group())
        if not math.isfinite(value):
            raise MCDServiceError(f"The MCD response contained a non-finite {label} value.")
        return value
    raise MCDServiceError(f"The MCD response did not include {label}.")


def fetch_mcd_environment(latitude, longitude, ls, local_time):
    longitude_360 = longitude % 360.0
    atmosphere_items = _query_items(
        ("p", "rho", "u", "v"),
        latitude,
        longitude_360,
        ls,
        local_time,
    )
    dust_items = _query_items(
        ("dod", "tauref", "dust_mmr", "dust_reff"),
        latitude,
        longitude_360,
        ls,
        local_time,
    )

    pressure = _value(atmosphere_items, "Pressure (Pa)", "pressure")
    density = _value(atmosphere_items, "Density (kg/m3)", "density")
    east_west_wind = _value(atmosphere_items, "W-E wind component", "east-west wind")
    north_south_wind = _value(atmosphere_items, "S-N wind component", "north-south wind")
    wind_speed = math.hypot(east_west_wind, north_south_wind)
    wind_direction = (
        math.degrees(math.atan2(east_west_wind, north_south_wind)) % 360.0
        if wind_speed > 0
        else None
    )

    return {
        "source": "Mars Climate Database model output, not live measurements.",
        "dust_scenario": "dust=1 (climatology average solar)",
        "request": {
            "latitude": latitude,
            "longitude": longitude_360,
            "solar_longitude": ls,
            "local_time": local_time,
            "altitude_m": 1,
        },
        "atmosphere": {
            "pressure_pa": pressure,
            "density_kg_m3": density,
            "east_west_wind_ms": east_west_wind,
            "north_south_wind_ms": north_south_wind,
            "wind_speed_ms": round(wind_speed, 3),
            "wind_direction_deg": round(wind_direction, 2) if wind_direction is not None else None,
        },
        "dust": {
            "monthly_optical_depth": _value(
                dust_items, "Monthly mean dust column", "monthly dust optical depth"
            ),
            "daily_optical_depth": _value(
                dust_items, "Daily mean dust column", "daily dust optical depth"
            ),
            "dust_mass_mixing_ratio": _value(
                dust_items, "Dust mass mixing ratio", "dust mass mixing ratio"
            ),
            "dust_effective_radius_m": _value(
                dust_items, "Dust effective radius", "dust effective radius"
            ),
        },
    }
