import { useEffect, useState } from 'react'
import { fetchAnalysis, fetchDayCurve, fetchMcdEnvironment } from '../api/quantumEcho'

const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—')
const fmtSci = (v) => (Number.isFinite(v) ? v.toExponential(2) : '—')
const clock = (h) => {
  if (!Number.isFinite(h)) return '—'
  const total = Math.round(h * 60) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
const coord = (v, pos, neg) => `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`

function DayChart({ curve, hour }) {
  const W = 320
  const H = 130
  const pad = { l: 34, r: 8, t: 8, b: 20 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const all = [...curve.surface_temperature_c, ...curve.air_temperature_c]
  const lo = Math.floor(Math.min(...all) / 10) * 10
  const hi = Math.ceil(Math.max(...all) / 10) * 10
  const x = (h) => pad.l + (h / 24) * iw
  const y = (t) => pad.t + (1 - (t - lo) / (hi - lo || 1)) * ih
  const line = (series) =>
    series.map((t, i) => `${i ? 'L' : 'M'}${x(curve.hours[i]).toFixed(1)},${y(t).toFixed(1)}`).join(' ')
  const step = curve.hours[1] - curve.hours[0]
  const night = curve.hours
    .map((h, i) => (curve.sun_above_horizon[i] ? null : h))
    .filter((h) => h !== null)
  const ticks = [lo, (lo + hi) / 2, hi]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ai-chart" role="img" aria-label="Predicted temperature over one sol">
      {night.map((h) => (
        <rect key={h} x={x(h)} y={pad.t} width={(step / 24) * iw + 0.5} height={ih} className="ai-chart-night" />
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ai-chart-grid" />
          <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="ai-chart-label">
            {t}°
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={x(h)} y={H - 6} textAnchor="middle" className="ai-chart-label">
          {h}h
        </text>
      ))}
      <path d={line(curve.air_temperature_c)} className="ai-chart-air" fill="none" />
      <path d={line(curve.surface_temperature_c)} className="ai-chart-surface" fill="none" />
      <line x1={x(hour)} x2={x(hour)} y1={pad.t} y2={pad.t + ih} className="ai-chart-now" />
    </svg>
  )
}

export default function AiForecast({ pin, onClear, isOpen, onToggle }) {
  const [seasonMode, setSeasonMode] = useState('now')
  const [lsInput, setLsInput] = useState(90)
  const [hourInput, setHourInput] = useState(12)
  const [ls, setLs] = useState(90)
  const [hour, setHour] = useState(12)
  const [pointRes, setPointRes] = useState({ key: '', data: null, error: '' })
  const [curveRes, setCurveRes] = useState({ key: '', data: null })
  const [environmentRes, setEnvironmentRes] = useState({ key: '', data: null, error: '' })

  useEffect(() => {
    const t = setTimeout(() => setLs(lsInput), 250)
    return () => clearTimeout(t)
  }, [lsInput])

  useEffect(() => {
    const t = setTimeout(() => setHour(hourInput), 250)
    return () => clearTimeout(t)
  }, [hourInput])

  const lsParam = seasonMode === 'now' ? null : ls
  const lat = pin ? pin.lat : null
  const lng = pin ? pin.lng : null

  const pointKey = `${lat}|${lng}|${lsParam}|${hour}`
  const curveKey = `${lat}|${lng}|${lsParam}`
  const environmentKey = `${lat}|${lng}|${lsParam}|${hour}`

  useEffect(() => {
    if (lat === null) return undefined
    const ctrl = new AbortController()
    fetchAnalysis({ lat, lng, ls: lsParam, localTime: Math.min(hour, 23.99) }, ctrl.signal)
      .then((data) => setPointRes({ key: pointKey, data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setPointRes({ key: pointKey, data: null, error: err.message })
      })
    return () => ctrl.abort()
  }, [lat, lng, lsParam, hour, pointKey])

  useEffect(() => {
    if (lat === null) return undefined
    const ctrl = new AbortController()
    fetchDayCurve({ lat, lng, ls: lsParam }, ctrl.signal)
      .then((data) => setCurveRes({ key: curveKey, data }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setCurveRes({ key: curveKey, data: null })
      })
    return () => ctrl.abort()
  }, [lat, lng, lsParam, curveKey])

  useEffect(() => {
    if (lat === null) return undefined
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetchMcdEnvironment({ lat, lng, ls: lsParam, localTime: hour }, ctrl.signal)
        .then((data) => setEnvironmentRes({ key: environmentKey, data, error: '' }))
        .catch((err) => {
          if (err.name === 'AbortError') return
          setEnvironmentRes({ key: environmentKey, data: null, error: err.message })
        })
    }, 600)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [lat, lng, lsParam, hour, environmentKey])

  const pointStale = pointRes.key !== pointKey
  const point = {
    data: pointRes.data,
    error: pointRes.error,
    status: pointStale ? 'loading' : pointRes.error ? 'error' : 'ok',
  }

  const d = pin ? point.data : null
  const c = pin ? curveRes.data : null
  const environmentStale = environmentRes.key !== environmentKey
  const environment = environmentStale ? null : environmentRes.data
  const environmentError = environmentStale ? '' : environmentRes.error
  const err = d ? d.typical_error : null
  const offline = pin && point.status === 'error'

  return (
    <div className="telemetry-panel ai-panel">
      <div className="telemetry-panel-header" onClick={onToggle}>
        <div className="header-status-title">
          <span className={`live-dot ${offline ? 'ai-dot-off' : ''}`} />
          <span className="header-title-text">Quantum Echo AI Forecast</span>
          <span className="source-tag">AI ESTIMATE</span>
        </div>
        <button type="button" className="collapse-toggle" aria-label={isOpen ? 'Collapse AI panel' : 'Expand AI panel'}>
          {isOpen ? '▲' : '▼'}
        </button>
      </div>

      {isOpen && (
        <div className="telemetry-content">
          {!pin ? (
            <div className="empty-state-notice">
              Pick <strong>Analyse</strong> in the Planner, then click anywhere on the map to forecast surface
              temperature, air temperature and pressure at that spot.
            </div>
          ) : (
            <>
              <div className="ai-site-row">
                <div>
                  <span className="field-label">SITE</span>
                  <span className="field-val">
                    {coord(pin.lat, 'N', 'S')}, {coord(pin.lng, 'E', 'W')}
                  </span>
                </div>
                <button type="button" className="btn-quiet" onClick={onClear}>
                  Clear pin
                </button>
              </div>

              <div className="ai-controls">
                <div className="control-field">
                  <div className="field-header">
                    <span>Season (Ls)</span>
                    <span className="field-badge">
                      {seasonMode === 'now'
                        ? d
                          ? `Now · ${fmt(d.request.ls, 0)}°`
                          : 'Now'
                        : `${lsInput}°`}
                    </span>
                  </div>
                  <div className="telemetry-subtabs ai-season-toggle">
                    <button
                      type="button"
                      className={`subtab-btn ${seasonMode === 'now' ? 'active' : ''}`}
                      onClick={() => setSeasonMode('now')}
                    >
                      Current Mars date
                    </button>
                    <button
                      type="button"
                      className={`subtab-btn ${seasonMode === 'custom' ? 'active' : ''}`}
                      onClick={() => setSeasonMode('custom')}
                    >
                      Custom
                    </button>
                  </div>
                  {seasonMode === 'custom' && (
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="5"
                      value={lsInput}
                      onChange={(e) => setLsInput(Number(e.target.value))}
                      className="range-slider"
                    />
                  )}
                </div>

                <div className="control-field">
                  <div className="field-header">
                    <span>Local solar time</span>
                    <span className="field-badge">{clock(hourInput)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="23.5"
                    step="0.5"
                    value={hourInput}
                    onChange={(e) => setHourInput(Number(e.target.value))}
                    className="range-slider"
                  />
                </div>
              </div>

              {offline && (
                <div className="ai-error">
                  AI backend unreachable ({point.error}). Start it with{' '}
                  <code>uvicorn app.main:app --port 8000</code> in <code>backend/</code>.
                </div>
              )}

              {d && (
                <div className={point.status === 'loading' ? 'ai-stale' : ''}>
                  <div className="ai-season-line">
                    {d.request.season_label} · Ls {fmt(d.request.ls, 1)}° ·{' '}
                    {d.sun.above_horizon ? 'Sun above horizon' : 'Sun below horizon'}
                  </div>

                  <div className="telemetry-metrics-grid">
                    <div className="metric-box">
                      <span className="metric-label">Surface Temp</span>
                      <span className="metric-val">{fmt(d.prediction.surface_temperature_c)} °C</span>
                      <span className="ai-err">± {fmt(err.surface_temperature_c)} typical</span>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Air Temp (1 m)</span>
                      <span className="metric-val">{fmt(d.prediction.air_temperature_c)} °C</span>
                      <span className="ai-err">± {fmt(err.air_temperature_c)} typical</span>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Pressure</span>
                      <span className="metric-val">{fmt(d.prediction.pressure_pa, 0)} Pa</span>
                      <span className="ai-err">± {fmt(err.pressure_pa)}% typical</span>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Daylight</span>
                      <span className="metric-val">
                        {d.sun.daylight.kind === 'normal'
                          ? `${fmt(d.sun.daylight.daylight_h)} h`
                          : d.sun.daylight.kind === 'polar_day'
                            ? 'Polar day'
                            : 'Polar night'}
                      </span>
                      <span className="ai-err">
                        {d.sun.daylight.kind === 'normal'
                          ? `${clock(d.sun.daylight.sunrise_h)}–${clock(d.sun.daylight.sunset_h)}`
                          : 'no sunrise / sunset'}
                      </span>
                    </div>
                  </div>

                  <div className="section-subhead">
                    <span>Terrain at site</span>
                    <span>{d.terrain.terrain_pattern.replace(' terrain pattern', '')}</span>
                  </div>
                  <div className="ai-terrain-row">
                    <span>Elev {fmt(d.terrain.elevation_m, 0)} m</span>
                    <span>Slope {fmt(d.terrain.slope_deg)}°</span>
                    <span>Rough {fmt(d.terrain.roughness_m, 0)} m</span>
                  </div>
                  <p className="ai-note">{d.terrain.data_quality_note}</p>

                  {d.range_warnings.length > 0 && (
                    <div className="ai-warning">
                      <strong>Outside training range</strong>
                      <ul>
                        {d.range_warnings.map((w) => (
                          <li key={w.feature}>{w.message}</li>
                        ))}
                      </ul>
                      <span>Treat this forecast as an extrapolation.</span>
                    </div>
                  )}
                </div>
              )}

              {pin && (
                <>
                  <div className="section-subhead">
                    <span>MCD atmosphere &amp; dust</span>
                    <span>MODEL · dust=1</span>
                  </div>
                  {environmentStale && <div className="ai-note">Querying Mars Climate Database…</div>}
                  {environmentError && (
                    <div className="ai-error">
                      Mars Climate Database unavailable ({environmentError}). The AI forecast remains available.
                    </div>
                  )}
                  {environment && (
                    <>
                      <div className="telemetry-metrics-grid">
                        <div className="metric-box">
                          <span className="metric-label">MCD Pressure</span>
                          <span className="metric-val">{fmt(environment.atmosphere.pressure_pa)} Pa</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Atmospheric Density</span>
                          <span className="metric-val">{fmt(environment.atmosphere.density_kg_m3, 5)} kg/m³</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">East–West Wind</span>
                          <span className="metric-val">{fmt(environment.atmosphere.east_west_wind_ms, 2)} m/s</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">North–South Wind</span>
                          <span className="metric-val">{fmt(environment.atmosphere.north_south_wind_ms, 2)} m/s</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Horizontal Wind Speed</span>
                          <span className="metric-val">{fmt(environment.atmosphere.wind_speed_ms, 2)} m/s</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Wind Direction (toward)</span>
                          <span className="metric-val">{fmt(environment.atmosphere.wind_direction_deg, 1)}°</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Monthly Dust Optical Depth</span>
                          <span className="metric-val">{fmt(environment.dust.monthly_optical_depth, 3)}</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Daily Dust Optical Depth</span>
                          <span className="metric-val">{fmt(environment.dust.daily_optical_depth, 3)}</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Dust Mass Mixing Ratio</span>
                          <span className="metric-val">{fmtSci(environment.dust.dust_mass_mixing_ratio)} kg/kg</span>
                        </div>
                        <div className="metric-box">
                          <span className="metric-label">Dust Effective Radius</span>
                          <span className="metric-val">
                            {fmt(environment.dust.dust_effective_radius_m * 1e6, 2)} μm
                          </span>
                        </div>
                      </div>
                      <p className="ai-note">
                        MCD model output at 1 m altitude, using dust=1 (climatology average solar); not live rover measurements.
                      </p>
                    </>
                  )}
                </>
              )}

              {pin && point.status === 'loading' && !d && <div className="ai-note">Running model…</div>}

              {c && (
                <>
                  <div className="section-subhead">
                    <span>Predicted sol temperature</span>
                    <span>
                      {fmt(c.summary.coldest_surface_c, 0)}° → {fmt(c.summary.warmest_surface_c, 0)}° surface
                    </span>
                  </div>
                  <DayChart curve={c} hour={hour} />
                  <div className="ai-legend">
                    <span className="ai-key surface" /> Surface
                    <span className="ai-key air" /> Air
                    <span className="ai-key night" /> Night
                  </div>
                </>
              )}

              {d && (
                <p className="ai-note ai-assump">
                  {d.assumptions[0]} {d.assumptions[2]}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
