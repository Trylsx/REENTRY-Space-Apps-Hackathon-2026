import numpy as np
import pandas as pd

MARS_OBLIQUITY_DEG = 25.19
MARS_ECCENTRICITY = 0.0934
PERIHELION_LS_DEG = 251.0

BASE_FEATURES = [
    "latitude", "longitude_sin", "longitude_cos", "ls_sin", "ls_cos",
    "local_time_sin", "local_time_cos", "elevation_m", "slope_deg", "roughness_m",
]
EXTRA_FEATURES = [
    "cos_zenith", "insolation_now", "insolation_lag2", "insolation_lag4",
    "daily_mean_insolation", "ls_sin2", "ls_cos2",
]
FEATURES_V3 = BASE_FEATURES + EXTRA_FEATURES


def solar_declination_rad(ls_deg):
    return np.arcsin(np.sin(np.radians(MARS_OBLIQUITY_DEG)) * np.sin(np.radians(ls_deg)))


def solar_geometry(latitude, ls_deg, local_time):
    lat = np.radians(latitude)
    declination = solar_declination_rad(ls_deg)
    hour_angle = np.radians((local_time - 12.0) * 15.0)
    cos_zenith = np.sin(lat) * np.sin(declination) + np.cos(lat) * np.cos(declination) * np.cos(hour_angle)
    true_anomaly = np.radians(ls_deg - PERIHELION_LS_DEG)
    distance_factor = ((1.0 + MARS_ECCENTRICITY * np.cos(true_anomaly)) / (1.0 - MARS_ECCENTRICITY ** 2)) ** 2
    return cos_zenith, distance_factor


def build_base_features(latitude, longitude, ls_deg, local_time, elevation_m, slope_deg, roughness_m):
    lat, lon, season, hour, elev, slope, rough = [
        np.atleast_1d(np.asarray(v, dtype=float))
        for v in (latitude, longitude, ls_deg, local_time, elevation_m, slope_deg, roughness_m)
    ]
    return pd.DataFrame({
        "latitude": lat,
        "longitude_sin": np.sin(np.radians(lon)),
        "longitude_cos": np.cos(np.radians(lon)),
        "ls_sin": np.sin(np.radians(season)),
        "ls_cos": np.cos(np.radians(season)),
        "local_time_sin": np.sin(2 * np.pi * hour / 24.0),
        "local_time_cos": np.cos(2 * np.pi * hour / 24.0),
        "elevation_m": elev,
        "slope_deg": slope,
        "roughness_m": rough,
    })[BASE_FEATURES]


def build_features_v3(latitude, longitude, ls_deg, local_time, elevation_m, slope_deg, roughness_m):
    features = build_base_features(latitude, longitude, ls_deg, local_time, elevation_m, slope_deg, roughness_m)
    lat = np.atleast_1d(np.asarray(latitude, dtype=float))
    season = np.atleast_1d(np.asarray(ls_deg, dtype=float))
    hour = np.atleast_1d(np.asarray(local_time, dtype=float))
    cos_now, factor = solar_geometry(lat, season, hour)
    cos_lag2, _ = solar_geometry(lat, season, (hour - 2.0) % 24.0)
    cos_lag4, _ = solar_geometry(lat, season, (hour - 4.0) % 24.0)
    daily = np.mean(
        [np.maximum(solar_geometry(lat, season, np.full(lat.shape, h))[0], 0.0) for h in np.arange(0.0, 24.0, 1.0)],
        axis=0,
    )
    features["cos_zenith"] = cos_now
    features["insolation_now"] = np.maximum(cos_now, 0.0) * factor
    features["insolation_lag2"] = np.maximum(cos_lag2, 0.0) * factor
    features["insolation_lag4"] = np.maximum(cos_lag4, 0.0) * factor
    features["daily_mean_insolation"] = daily * factor
    features["ls_sin2"] = np.sin(2.0 * np.radians(season))
    features["ls_cos2"] = np.cos(2.0 * np.radians(season))
    return features[FEATURES_V3]


def daylight_window(latitude, ls_deg):
    lat = np.radians(np.clip(float(latitude), -89.999, 89.999))
    declination = float(solar_declination_rad(float(ls_deg)))
    x = -np.tan(lat) * np.tan(declination)
    if x >= 1.0:
        return {"kind": "polar_night", "sunrise_h": None, "sunset_h": None, "daylight_h": 0.0}
    if x <= -1.0:
        return {"kind": "polar_day", "sunrise_h": None, "sunset_h": None, "daylight_h": 24.0}
    half_day_h = float(np.degrees(np.arccos(x))) / 15.0
    return {
        "kind": "normal",
        "sunrise_h": 12.0 - half_day_h,
        "sunset_h": 12.0 + half_day_h,
        "daylight_h": 2.0 * half_day_h,
    }
