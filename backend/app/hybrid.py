import __main__

import joblib
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


class HybridLogPressure:
    base_columns = ["elevation_m", "ls_sin", "ls_cos", "ls_sin2", "ls_cos2"]

    def __init__(self):
        self.base = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
        self.residual = ExtraTreesRegressor(n_estimators=200, min_samples_leaf=2, random_state=42, n_jobs=-1)

    def fit(self, features, y):
        self.base.fit(features[self.base_columns], y)
        self.residual.fit(features, y - self.base.predict(features[self.base_columns]))
        return self

    def predict(self, features):
        return self.base.predict(features[self.base_columns]) + self.residual.predict(features)


def load_model_bundle(path):
    had_attribute = hasattr(__main__, "HybridLogPressure")
    previous = getattr(__main__, "HybridLogPressure", None)
    __main__.HybridLogPressure = HybridLogPressure
    try:
        return joblib.load(path)
    finally:
        if had_attribute:
            __main__.HybridLogPressure = previous
        else:
            del __main__.HybridLogPressure
