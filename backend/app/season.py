import math
from datetime import timezone

UNIX_EPOCH_JD = 2440587.5
J2000_JD = 2451545.0
TT_MINUS_UTC_DAYS = 69.184 / 86400.0

PERTURBERS = (
    (0.0071, 2.2353, 49.409),
    (0.0057, 2.7543, 168.173),
    (0.0039, 1.1177, 191.837),
    (0.0037, 15.7866, 21.736),
    (0.0021, 2.1354, 15.704),
    (0.0020, 2.4694, 95.528),
    (0.0018, 32.8493, 49.095),
)


def mars_ls(moment):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    jd_utc = moment.timestamp() / 86400.0 + UNIX_EPOCH_JD
    delta = jd_utc + TT_MINUS_UTC_DAYS - J2000_JD

    mean_anomaly = math.radians(19.3871 + 0.52402073 * delta)
    fictitious_sun = 270.3871 + 0.524038496 * delta
    perturbation = sum(
        amplitude * math.cos(math.radians(0.985626 * delta / period + phase))
        for amplitude, period, phase in PERTURBERS
    )
    equation_of_centre = (
        (10.691 + 3.0e-7 * delta) * math.sin(mean_anomaly)
        + 0.623 * math.sin(2 * mean_anomaly)
        + 0.050 * math.sin(3 * mean_anomaly)
        + 0.005 * math.sin(4 * mean_anomaly)
        + 0.0005 * math.sin(5 * mean_anomaly)
        + perturbation
    )
    return (fictitious_sun + equation_of_centre) % 360.0


def season_label(ls):
    names = ("Northern spring", "Northern summer", "Northern autumn", "Northern winter")
    return names[int(ls % 360.0 // 90) % 4]
