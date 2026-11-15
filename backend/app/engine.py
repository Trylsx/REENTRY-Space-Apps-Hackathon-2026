import json
from pathlib import Path

import numpy as np
import sklearn
from scipy import ndimage

from .features import FEATURES_V3, build_features_v3, daylight_window
from .hybrid import load_model_bundle

MODEL_FILE = "quantum_echo_predictive_model_v3.pkl"
LAYERS_FILE = "quantum_echo_backend_layers.npz"
CLUSTERS_FILE = "quantum_echo_cluster_names.json"
GRID_DEG = 0.25
KM_PER_DEG = 59.17

ASSUMPTIONS = [
    "AI estimate that imitates the Mars Climate Database (MCD), not a measurement.",
    "Dust scenario fixed to climatology average solar; values are at 1 m above the surface.",
    "Typical error is an average over held-out regions and seasons; single points can be off by more.",
]


class QuantumEcho:
    def __init__(self, data_dir):
        data_dir = Path(data_dir)
        self.bundle = load_model_bundle(data_dir / MODEL_FILE)
        layers = np.load(data_dir / LAYERS_FILE)
        self.elevation = layers["elevation_m"]
        self.slope = layers["slope_deg"]
        self.roughness = layers["roughness_m"]
        self.counts = layers["mola_counts"]
        self.cluster = layers["terrain_cluster"]
        with open(data_dir / CLUSTERS_FILE, encoding="utf-8") as handle:
            self.cluster_names = {int(key): value for key, value in json.load(handle).items()}
        self.n_rows, self.n_cols = self.elevation.shape
        self.coverage_low = int(np.quantile(self.counts, 0.10))
        self.coverage_high = int(np.quantile(self.counts, 0.90))
        if self.bundle["feature_lists"]["v3"] != FEATURES_V3:
            raise RuntimeError("Feature list in the model file does not match app/features.py")

    def _cell(self, latitude, longitude):
        row = int(np.clip(np.floor((90.0 - latitude) / GRID_DEG), 0, self.n_rows - 1))
        col = int(np.clip(np.floor((longitude % 360.0) / GRID_DEG), 0, self.n_cols - 1))
        return row, col

    def terrain(self, latitude, longitude):
        row, col = self._cell(latitude, longitude)
        observations = int(self.counts[row, col])
        if observations == 0:
            coverage = "No direct MOLA observations recorded in this cell"
            caution = "LOW DATA SUPPORT: elevation may be interpolated; terrain metrics are not confirmed."
        elif observations <= self.coverage_low:
            coverage = "Low MOLA coverage (relative to this MOLA product)"
            caution = "CAUTION: limited MOLA sampling; seek independent confirmation."
        elif observations >= self.coverage_high:
            coverage = "High MOLA coverage (relative to this MOLA product)"
            caution = "Better MOLA sampling, but not a guarantee of perfect accuracy."
        else:
            coverage = "Medium MOLA coverage (relative to this MOLA product)"
            caution = "Moderate MOLA sampling; interpret terrain metrics with care."
        cluster_id = int(self.cluster[row, col])
        return {
            "elevation_m": float(self.elevation[row, col]),
            "slope_deg": float(self.slope[row, col]),
            "roughness_m": float(self.roughness[row, col]),
            "mola_count": observations,
            "coverage": coverage,
            "data_quality_note": caution,
            "terrain_cluster": cluster_id,
            "terrain_pattern": self.cluster_names[cluster_id],
        }

    def _predict_frame(self, features):
        names = self.bundle["output_names"]
        values = {}
        for target in self.bundle["targets"]:
            columns = self.bundle["feature_lists"][self.bundle["feature_set"][target]]
            raw = np.asarray(self.bundle["models"][target].predict(features[columns]), dtype=float)
            values[names[target]] = np.power(10.0, raw) if target == "log10_pressure" else raw
        return values

    def typical_error(self):
        names = self.bundle["output_names"]
        return {names[t]: float(self.bundle["typical_error"][t]) for t in self.bundle["targets"]}

    def _range_warnings(self, features, terrain):
        warnings = []
        for column, (low, high) in self.bundle["feature_ranges"].items():
            value = float(features[column].iloc[0])
            if not low <= value <= high:
                warnings.append({
                    "feature": column,
                    "value": value,
                    "training_min": float(low),
                    "training_max": float(high),
                    "message": f"{column} = {value:,.2f} is outside the training range {low:,.2f} to {high:,.2f}",
                })
        if terrain["mola_count"] == 0:
            warnings.append({
                "feature": "mola_count",
                "value": 0.0,
                "training_min": None,
                "training_max": None,
                "message": "No direct MOLA observations in this cell: terrain inputs may be interpolated",
            })
        return warnings

    def predict(self, latitude, longitude, ls, local_time):
        lon360 = longitude % 360.0
        terrain = self.terrain(latitude, lon360)
        features = build_features_v3(
            latitude, lon360, ls, local_time,
            terrain["elevation_m"], terrain["slope_deg"], terrain["roughness_m"],
        )
        values = self._predict_frame(features)
        prediction = {name: float(array[0]) for name, array in values.items()}
        if not all(np.isfinite(v) for v in prediction.values()):
            raise RuntimeError("Model returned a non-finite value")
        warnings = self._range_warnings(features, terrain)
        return {
            "request": {"latitude": latitude, "longitude": lon360, "ls": ls, "local_time": local_time},
            "terrain": terrain,
            "prediction": prediction,
            "typical_error": self.typical_error(),
            "range_warnings": warnings,
            "status": "outside_training_range" if warnings else "inside_training_range",
            "sun": {
                "cos_zenith": float(features["cos_zenith"].iloc[0]),
                "above_horizon": bool(features["cos_zenith"].iloc[0] > 0),
                "daylight": daylight_window(latitude, ls),
            },
            "assumptions": ASSUMPTIONS,
            "model": self.model_info(),
        }

    def day_curve(self, latitude, longitude, ls, step_hours=0.5):
        lon360 = longitude % 360.0
        terrain = self.terrain(latitude, lon360)
        hours = np.arange(0.0, 24.0, step_hours)
        n = len(hours)
        features = build_features_v3(
            np.full(n, latitude), np.full(n, lon360), np.full(n, ls), hours,
            np.full(n, terrain["elevation_m"]), np.full(n, terrain["slope_deg"]), np.full(n, terrain["roughness_m"]),
        )
        values = self._predict_frame(features)
        surface = values["surface_temperature_c"]
        warmest = int(np.argmax(surface))
        coldest = int(np.argmin(surface))
        warnings = self._range_warnings(features.iloc[[0]], terrain)
        return {
            "request": {"latitude": latitude, "longitude": lon360, "ls": ls, "step_hours": step_hours},
            "hours": [round(float(h), 4) for h in hours],
            "surface_temperature_c": np.round(surface, 3).tolist(),
            "air_temperature_c": np.round(values["air_temperature_c"], 3).tolist(),
            "pressure_pa": np.round(values["pressure_pa"], 2).tolist(),
            "sun_above_horizon": (features["cos_zenith"].to_numpy() > 0).tolist(),
            "summary": {
                "warmest_surface_h": float(hours[warmest]),
                "warmest_surface_c": float(surface[warmest]),
                "coldest_surface_h": float(hours[coldest]),
                "coldest_surface_c": float(surface[coldest]),
                "daylight": daylight_window(latitude, ls),
            },
            "typical_error": self.typical_error(),
            "range_warnings": warnings,
            "status": "outside_training_range" if warnings else "inside_training_range",
        }

    def terrain_patch(self, lat_min, lat_max, lon_min, lon_max, size=96):
        mid_lat = (lat_min + lat_max) / 2.0
        km_x = (lon_max - lon_min) * np.cos(np.radians(mid_lat)) * KM_PER_DEG
        km_y = (lat_max - lat_min) * KM_PER_DEG
        if km_x >= km_y:
            cols = size
            rows = max(8, int(round(size * km_y / km_x)))
        else:
            rows = size
            cols = max(8, int(round(size * km_x / km_y)))
        lats = np.linspace(lat_max, lat_min, rows)
        lons = np.linspace(lon_min, lon_max, cols)
        lat_grid, lon_grid = np.meshgrid(lats, lons, indexing="ij")

        row_f = (90.0 - lat_grid) / GRID_DEG - 0.5
        col_f = lon_grid / GRID_DEG - 0.5
        pad = 3
        r0 = max(int(np.floor(row_f.min())) - pad, 0)
        r1 = min(int(np.ceil(row_f.max())) + pad, self.n_rows - 1)
        c0 = int(np.floor(col_f.min())) - pad
        c1 = int(np.ceil(col_f.max())) + pad
        col_index = np.arange(c0, c1 + 1) % self.n_cols
        window = np.take(self.elevation[r0:r1 + 1], col_index, axis=1).astype(float)
        elevation = ndimage.map_coordinates(window, np.array([row_f - r0, col_f - c0]), order=3, mode="nearest")

        row_i = np.clip(np.floor((90.0 - lat_grid) / GRID_DEG).astype(int), 0, self.n_rows - 1)
        col_i = np.clip(np.floor((lon_grid % 360.0) / GRID_DEG).astype(int), 0, self.n_cols - 1)
        cluster = self.cluster[row_i, col_i]

        total = rows * cols
        found = []
        for cluster_id in np.unique(cluster):
            labeled, count = ndimage.label(cluster == cluster_id)
            areas = ndimage.sum(np.ones(labeled.shape), labeled, index=np.arange(1, count + 1))
            order = np.argsort(areas)[::-1]
            for rank, k in enumerate(order):
                area = int(areas[k])
                threshold = 0.05 if rank == 0 else 0.15
                if area < threshold * total:
                    continue
                mask = labeled == k + 1
                depth = ndimage.distance_transform_edt(mask)
                row, col = np.unravel_index(int(np.argmax(depth)), depth.shape)
                found.append({"cluster": int(cluster_id), "row": int(row), "col": int(col), "cells": area})
        if not found:
            top = np.bincount(cluster.ravel()).argmax()
            mask = cluster == top
            depth = ndimage.distance_transform_edt(mask)
            row, col = np.unravel_index(int(np.argmax(depth)), depth.shape)
            found.append({"cluster": int(top), "row": int(row), "col": int(col), "cells": int(mask.sum())})
        found.sort(key=lambda item: item["cells"], reverse=True)

        return {
            "rows": int(rows),
            "cols": int(cols),
            "lat_min": float(lat_min),
            "lat_max": float(lat_max),
            "lon_min": float(lon_min),
            "lon_max": float(lon_max),
            "elevation_m": np.round(elevation, 1).tolist(),
            "cluster": cluster.tolist(),
            "cluster_names": {str(key): value for key, value in self.cluster_names.items()},
            "regions": found[:6],
            "source": "MOLA elevation grid at 0.25 degrees, cubic interpolation; zones are AI terrain clusters",
        }

    def model_info(self):
        bundle = self.bundle
        return {
            "name": "quantum-echo-v3",
            "training_samples": int(bundle["training_samples"]),
            "high_res_topography": bool(bundle["high_res"]),
            "best_models": dict(bundle["best_models"]),
            "scikit_learn": sklearn.__version__,
        }
