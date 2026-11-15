import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import LiveConditions from './components/LiveConditions'
import AiForecast from './components/AiForecast'
import RouteView3D from './components/RouteView3D'
import MarsGlobe from './components/MarsGlobe'
import { Intro, CoordinateModal, HistoryModal } from './components/Hud'
import { HISTORY, LANDMARKS } from './data/history'

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ'
const trekUrl = (layer, ext = 'jpg') =>
  `${TREK}/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`

// Gale Crater / Mount Sharp (Curiosity's exploration zone)
const GALE = [-5.4, 137.8]
const BRADBURY = [-4.5895, 137.4417]

// Mission assumptions
const R_MARS = 3389.5 // km
const SPEEDS = { foot: 2.5, rover: 10 } // km/h
const STOP_MIN = 20 // minutes of science work per waypoint
const EVA_LIMIT_H = 8 // maximum EVA length, hours
const DOSE_MSV_PER_DAY = 0.64 // approx. surface dose rate measured by Curiosity RAD

const LAYER_DEFS = [
  {
    id: 'optical',
    label: 'Optical Viking Mosaic',
    source: 'Viking MDIM 2.1 Color (232m/px)',
    desc: 'True-color natural surface photography',
    badge: 'TRUE COLOR',
    badgeClass: 'truecolor',
    file: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
    ext: 'jpg',
    native: 7,
    on: true,
    opacity: 1,
  },
  {
    id: 'topo',
    label: 'Topography (MOLA Relief)',
    source: 'MGS MOLA Altimetry (463m/px)',
    desc: 'Color elevation: deep blue (-8 km) to white peak (+21 km)',
    badge: 'ALTIMETRY',
    badgeClass: 'altimetry',
    file: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
    ext: 'jpg',
    native: 7,
    on: false,
    opacity: 0.75,
  },
  {
    id: 'thermal',
    label: 'Thermal Infrared (THEMIS)',
    source: 'THEMIS IR Daytime (100m/px)',
    desc: 'Thermal inertia: bright bedrock vs dark surface dust',
    badge: 'THERMAL IR',
    badgeClass: 'thermal',
    file: 'Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly',
    ext: 'png',
    native: 8,
    on: false,
    opacity: 0.75,
  },
]

// Geometry helpers (flat km coordinates)
const KM_PER_DEG = (Math.PI / 180) * R_MARS
const KX = KM_PER_DEG * Math.cos((GALE[0] * Math.PI) / 180)
const KY = KM_PER_DEG
const toXY = (p) => ({ x: p.lng * KX, y: p.lat * KY })
const toLL = (p) => [p.y / KY, p.x / KX]

const LEAFLET_EARTH_R = 6371000
const circleMeters = (km) => km * 1000 * (LEAFLET_EARTH_R / (R_MARS * 1000))

function segInfo(a, b, c) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return { t, d: Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy)) }
}

const pathLen = (pts) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)

// Route planning around circular hazard zones
function planLeg(a, b, hz, depth) {
  const hits = hz
    .map((h) => ({ h, ...segInfo(a, b, h.c) }))
    .filter((o) => o.d < o.h.r * 0.999)
    .sort((p, q) => p.t - q.t)
  if (!hits.length || depth === 0) return [a, b]

  const { h } = hits[0]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const off = h.r * 1.15

  const options = [1, -1].map((s) => {
    const p = { x: h.c.x + nx * off * s, y: h.c.y + ny * off * s }
    const first = planLeg(a, p, hz, depth - 1)
    const second = planLeg(p, b, hz, depth - 1)
    return first.concat(second.slice(1))
  })
  return pathLen(options[0]) <= pathLen(options[1]) ? options[0] : options[1]
}

export default function App() {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const tileRefs = useRef({})
  const wpGroup = useRef(null)
  const hazGroup = useRef(null)
  const histGroup = useRef(null)
  const aiGroup = useRef(null)

  const [state, setState] = useState(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.id, { on: d.on, opacity: d.opacity }]))
  )
  const [waypoints, setWaypoints] = useState([])
  const [hazards, setHazards] = useState([])
  const [mode, setMode] = useState('waypoint') // 'waypoint' | 'hazard' | 'analyse'
  const [hazardR, setHazardR] = useState(8)
  const [travel, setTravel] = useState('rover')
  const [returnHome, setReturnHome] = useState(true)
  const [weather, setWeather] = useState('nominal')
  const [phase, setPhase] = useState('intro') // 'intro' | 'active'
  const [globeOn, setGlobeOn] = useState(false)
  const [activeTab, setActiveTab] = useState('traverse') // 'traverse' | 'layers' | 'landmarks'
  const [centerCoords, setCenterCoords] = useState(GALE)
  const [coordModalOpen, setCoordModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [weatherPanelOpen, setWeatherPanelOpen] = useState(true)
  const [aiPanelOpen, setAiPanelOpen] = useState(true)
  const [aiPin, setAiPin] = useState(null)
  const [routeViewOpen, setRouteViewOpen] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [focus, setFocus] = useState(null)

  const modeRef = useRef(mode)
  const radiusRef = useRef(hazardR)
  modeRef.current = mode
  radiusRef.current = hazardR

  const fly = (lat, lng, z = 7) => {
    setGlobeOn(false)
    mapRef.current?.flyTo([lat, lng], z, { duration: 1.8 })
  }

  const randomLocation = () => {
    const lat = (Math.asin(Math.random() * 1.6 - 0.8) * 180) / Math.PI
    const lng = Math.random() * 360 - 180
    fly(lat, lng, 6)
  }

  const toggleGlobe = () => {
    if (!globeOn && mapRef.current) {
      const c = mapRef.current.getCenter()
      setFocus([c.lat, c.lng])
    }
    setGlobeOn(!globeOn)
  }

  // Load a realistic, pre-configured Gale Crater Traverse with science stops and hazard avoidance
  const loadGalePreset = () => {
    setGlobeOn(false)
    mapRef.current?.flyTo(GALE, 8, { duration: 1.5 })
    setWaypoints([
      { id: 'wp-1', lat: -4.5895, lng: 137.4417, label: 'Bradbury Landing (Habitat)' },
      { id: 'wp-2', lat: -4.625, lng: 137.495, label: 'Yellowknife Bay Outcrop' },
      { id: 'wp-3', lat: -4.85, lng: 137.62, label: 'Kimberley Sandstone Bed' },
      { id: 'wp-4', lat: -5.38, lng: 137.79, label: 'Mount Sharp Boxwork Target' },
    ])
    setHazards([
      { id: 'hz-1', lat: -4.75, lng: 137.54, rKm: 7 },
    ])
    setReturnHome(true)
    setTravel('rover')
    setActiveTab('traverse')
    setLeftOpen(true)
    setRightOpen(true)
  }

  // Auto-frame route within the viewport
  const fitRouteBounds = () => {
    if (!mapRef.current || waypoints.length === 0) return
    const pts = waypoints.map((w) => [w.lat, w.lng])
    hazards.forEach((h) => pts.push([h.lat, h.lng]))
    const bounds = L.latLngBounds(pts)
    mapRef.current.fitBounds(bounds, {
      padding: [80, 80],
      maxZoom: 9,
      duration: 1.2,
    })
  }

  // 1) Initialize Map
  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(mapEl.current, {
      crs: L.CRS.EPSG4326,
      center: GALE,
      zoom: 8,
      minZoom: 1,
      maxZoom: 10,
      zoomControl: true,
      attributionControl: false,
    })
    mapRef.current = map

    // NASA Trek tile layers
    LAYER_DEFS.forEach((d, i) => {
      const layer = L.tileLayer(trekUrl(d.file, d.ext), {
        tileSize: 256,
        zoomOffset: 0,
        noWrap: true,
        maxNativeZoom: d.native,
        maxZoom: 10,
        zIndex: i + 1,
      })
      layer.on('tileerror', (e) => console.warn(`${d.id} tile error:`, e.tile.src))
      tileRefs.current[d.id] = layer
    })

    // Ground landmark markers
    L.circleMarker(GALE, {
      radius: 6,
      color: '#38bdf8',
      weight: 2,
      fillColor: '#38bdf8',
      fillOpacity: 0.6,
    })
      .addTo(map)
      .bindTooltip('Boxwork Science Target (Mount Sharp, -5.400°, 137.800°)')

    L.circleMarker(BRADBURY, {
      radius: 6,
      color: '#10b981',
      weight: 2,
      fillColor: '#10b981',
      fillOpacity: 0.6,
    })
      .addTo(map)
      .bindTooltip('Bradbury Landing: Curiosity MSL Touchdown (2012)')

    hazGroup.current = L.layerGroup().addTo(map)
    aiGroup.current = L.layerGroup().addTo(map)
    wpGroup.current = L.layerGroup().addTo(map)

    map.on('move', () => {
      const c = map.getCenter()
      setCenterCoords([c.lat, c.lng])
    })

    map.on('click', (e) => {
      const item = { id: Date.now() + Math.random(), lat: e.latlng.lat, lng: e.latlng.lng }
      if (modeRef.current === 'analyse') {
        setAiPin({ lat: item.lat, lng: item.lng })
        setRightOpen(true)
        setAiPanelOpen(true)
      } else if (modeRef.current === 'hazard') {
        setHazards((prev) => [...prev, { ...item, rKm: radiusRef.current }])
      } else {
        setWaypoints((prev) => [...prev, item])
      }
    })
  }, [])

  // 2) Sync Layer State
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    LAYER_DEFS.forEach((d) => {
      const layer = tileRefs.current[d.id]
      const s = state[d.id]
      layer.setOpacity(s.opacity)
      if (s.on && !map.hasLayer(layer)) layer.addTo(map)
      if (!s.on && map.hasLayer(layer)) map.removeLayer(layer)
    })
  }, [state])

  // 3) Historic landing sites map markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (histGroup.current) histGroup.current.remove()

    histGroup.current = L.layerGroup(
      HISTORY.map((h) =>
        L.circleMarker([h.lat, h.lng], {
          radius: 6,
          color: '#f59e0b',
          weight: 2,
          fillColor: '#f59e0b',
          fillOpacity: 0.7,
        }).bindTooltip(`${h.name} (${h.year}) · ${h.type} · ${h.note}`)
      )
    ).addTo(map)
  }, [])

  // 4) Compute Traverse Plan
  const plan = useMemo(() => {
    if (waypoints.length < 2) return null

    const hz = hazards.map((h) => ({ c: toXY(h), r: h.rKm }))
    const pts = waypoints.map(toXY)
    const insideIdx = pts
      .map((p, i) => (hz.some((h) => Math.hypot(p.x - h.c.x, p.y - h.c.y) < h.r) ? i + 1 : 0))
      .filter(Boolean)

    const stops = returnHome ? [...pts, pts[0]] : pts
    let route = [stops[0]]
    for (let i = 1; i < stops.length; i++) {
      route = route.concat(planLeg(stops[i - 1], stops[i], hz, 4).slice(1))
    }

    const distKm = pathLen(route)
    const directKm = pathLen(stops)
    const travelH = distKm / SPEEDS[travel]
    const stopsH = ((waypoints.length - 1) * STOP_MIN) / 60
    const evaH = travelH + stopsH
    const doseMsv = (evaH * DOSE_MSV_PER_DAY) / 24

    const reasons = []
    let level = 'GO'
    if (insideIdx.length) {
      level = 'NO-GO'
      reasons.push(`Waypoint ${insideIdx.join(', ')} intersects a marked hazard perimeter`)
    }
    if (weather === 'alert') {
      level = 'NO-GO'
      reasons.push('Solar Particle Event (SPE) alert: surface radiation threshold exceeded')
    }
    if (evaH > EVA_LIMIT_H) {
      level = 'NO-GO'
      reasons.push(`Projected traverse of ${evaH.toFixed(1)} h exceeds the strict ${EVA_LIMIT_H} h EVA limit`)
    } else if (evaH > EVA_LIMIT_H * 0.8 && level === 'GO') {
      level = 'CAUTION'
      reasons.push(`Traverse consumes ${((evaH / EVA_LIMIT_H) * 100).toFixed(0)}% of primary life-support limit`)
    }
    if (!reasons.length) {
      reasons.push('All life-support and obstacle clearances confirmed nominal')
    }

    return {
      routeLL: route.map(toLL),
      directLL: stops.map(toLL),
      distKm,
      directKm,
      evaH,
      doseMsv,
      level,
      reasons,
    }
  }, [waypoints, hazards, travel, returnHome, weather])

  useEffect(() => {
    const g = aiGroup.current
    if (!g) return
    g.clearLayers()
    if (!aiPin) return
    const icon = L.divIcon({
      className: '',
      html: '<div class="ai-pin-marker"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
    L.marker([aiPin.lat, aiPin.lng], { icon, interactive: false }).addTo(g)
  }, [aiPin])

  // 5) Render Hazards
  useEffect(() => {
    const g = hazGroup.current
    if (!g) return
    g.clearLayers()
    hazards.forEach((h) =>
      L.circle([h.lat, h.lng], {
        radius: circleMeters(h.rKm),
        color: '#ef4444',
        weight: 1.5,
        fillColor: '#ef4444',
        fillOpacity: 0.22,
        interactive: false,
      }).addTo(g)
    )
  }, [hazards])

  // 6) Render Waypoints & Route Lines
  useEffect(() => {
    const g = wpGroup.current
    if (!g) return
    g.clearLayers()

    if (plan) {
      // Direct baseline trajectory
      L.polyline(plan.directLL, {
        color: '#94a3b8',
        weight: 1.5,
        dashArray: '4 8',
        opacity: 0.6,
        interactive: false,
      }).addTo(g)

      // Active traversed route (avoiding obstacles)
      L.polyline(plan.routeLL, {
        color: '#e05a34',
        weight: 3.5,
        opacity: 0.95,
        interactive: false,
      }).addTo(g)
    }

    waypoints.forEach((w, i) => {
      const icon = L.divIcon({
        className: 'custom-wp-marker',
        html: String(i + 1),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
      const marker = L.marker([w.lat, w.lng], { icon, draggable: true }).addTo(g)
      marker.bindTooltip(
        i === 0
          ? `Stop 1: Habitat Base [${w.lat.toFixed(3)}°, ${w.lng.toFixed(3)}°]`
          : `Stop ${i + 1}: Science Target [${w.lat.toFixed(3)}°, ${w.lng.toFixed(3)}°]`
      )
      marker.on('dragend', (e) => {
        const p = e.target.getLatLng()
        setWaypoints((prev) =>
          prev.map((x) => (x.id === w.id ? { ...x, lat: p.lat, lng: p.lng } : x))
        )
      })
    })
  }, [waypoints, plan])

  const updateLayer = (id, patch) =>
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const soloLayer = (targetId) => {
    setState((prev) => {
      const next = {}
      LAYER_DEFS.forEach((d) => {
        next[d.id] = {
          on: d.id === targetId,
          opacity: d.id === targetId ? 1 : prev[d.id].opacity,
        }
      })
      return next
    })
  }

  return (
    <div className="app-shell">
      {/* ====================================================================
          TOP COMMAND BAR / MISSION HEADER
          ==================================================================== */}
      <header className="command-bar">
        <div className="brand-section">
          <div className="brand-badge">
            <span className="brand-logo-icon">M</span>
            <span className="brand-title">
              MARSWALK <span className="brand-title-dim">3D</span>
            </span>
          </div>
          <div className="brand-divider" />
          <span className="brand-tag">TEAM REENTRY</span>
        </div>

        {/* Real-time map center coordinates */}
        <div className="telemetry-breadcrumb">
          <span className="breadcrumb-label">VIEW CENTER:</span>
          <span className="breadcrumb-val">
            {centerCoords[0] >= 0 ? `${centerCoords[0].toFixed(3)}°N` : `${Math.abs(centerCoords[0]).toFixed(3)}°S`}
            {', '}
            {centerCoords[1] >= 0 ? `${centerCoords[1].toFixed(3)}°E` : `${Math.abs(centerCoords[1]).toFixed(3)}°W`}
          </span>
          <span className="breadcrumb-sep">|</span>
          <span className="breadcrumb-label">DATUM:</span>
          <span className="breadcrumb-val">IAU 2000 MARS</span>
        </div>

        {/* Global View Modes Switcher */}
        <div className="view-mode-bar">
          <button
            type="button"
            className={`mode-btn ${!globeOn ? 'active' : ''}`}
            onClick={() => setGlobeOn(false)}
          >
            <span className="mode-btn-indicator" />
            2D Surface Map
          </button>
          <button
            type="button"
            className={`mode-btn ${globeOn ? 'active' : ''}`}
            onClick={toggleGlobe}
          >
            3D Globe
          </button>
          <button
            type="button"
            className="mode-btn"
            onClick={() => setHistoryModalOpen(true)}
          >
            Historic Missions
          </button>
        </div>

        {/* Header Actions */}
        <div className="header-actions">
          {/* Console Dock Toggles */}
          <button
            type="button"
            className={`action-btn ${leftOpen ? 'active-toggle' : ''}`}
            onClick={() => setLeftOpen(!leftOpen)}
            title="Toggle Mission Director Console"
          >
            Planner
          </button>

          <button
            type="button"
            className={`action-btn ${rightOpen ? 'active-toggle' : ''}`}
            onClick={() => setRightOpen(!rightOpen)}
            title="Toggle Quantum Echo AI Forecast"
          >
            AI Forecast
          </button>

          {plan && (
            <button
              type="button"
              className="action-btn"
              onClick={fitRouteBounds}
              title="Fit entire planned traverse within view"
            >
              Fit Route
            </button>
          )}

          <button
            type="button"
            className="action-btn"
            disabled={waypoints.length === 0}
            onClick={() => setRouteViewOpen(true)}
            title="View the planned route on 3D terrain"
          >
            3D Route View
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={() => setCoordModalOpen(true)}
            title="Teleport to Martian coordinates"
          >
            Teleport
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={randomLocation}
            title="Jump to a random Martian coordinate"
          >
            Random
          </button>

          <button
            type="button"
            className="action-btn primary"
            onClick={loadGalePreset}
            title="Load Gale Crater science loop traverse"
          >
            Sample Traverse
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN VIEWPORT STAGE
          ==================================================================== */}
      <div className="viewport-stage">
        {/* Leaflet 2D Surface Map Canvas */}
        <div ref={mapEl} className="leaflet-map-canvas" />

        {/* Floating edge opener buttons when consoles are collapsed */}
        {!leftOpen && (
          <button
            type="button"
            className="floating-edge-btn left"
            onClick={() => setLeftOpen(true)}
            title="Open Mission Director"
          >
            <span>▶</span> Planner
          </button>
        )}

        {!rightOpen && (
          <button
            type="button"
            className="floating-edge-btn right"
            onClick={() => setRightOpen(true)}
            title="Open Quantum Echo AI Forecast"
          >
            AI Forecast <span>◀</span>
          </button>
        )}

        {/* ==================================================================
            LEFT MISSION PLANNING AND CLEARANCE STACK
            ================================================================== */}
        <div className={`left-console-stack ${leftOpen ? '' : 'collapsed'}`}>
          <aside className="console-left">
          <div className="console-header">
            <div className="console-title-wrap">
              <span className="console-title">Mission Director</span>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              onClick={() => setLeftOpen(false)}
              aria-label="Collapse panel"
              title="Collapse Planner"
            >
              ◀
            </button>
          </div>

          <div className="console-nav-tabs">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'traverse' ? 'active' : ''}`}
              onClick={() => setActiveTab('traverse')}
            >
              Traverse Plan
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'layers' ? 'active' : ''}`}
              onClick={() => setActiveTab('layers')}
            >
              GIS Layers
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'landmarks' ? 'active' : ''}`}
              onClick={() => setActiveTab('landmarks')}
            >
              Landmarks
            </button>
          </div>

          <div className="console-body">
            {activeTab === 'traverse' && (
              <>
                <div className="tool-modes-grid three">
                  <button
                    type="button"
                    className={`tool-btn ${mode === 'waypoint' ? 'active-wp' : ''}`}
                    onClick={() => setMode('waypoint')}
                  >
                    + Waypoint
                  </button>
                  <button
                    type="button"
                    className={`tool-btn ${mode === 'hazard' ? 'active-hz' : ''}`}
                    onClick={() => setMode('hazard')}
                  >
                    ⚠ Hazard Area
                  </button>
                  <button
                    type="button"
                    className={`tool-btn ${mode === 'analyse' ? 'active-ai' : ''}`}
                    onClick={() => setMode('analyse')}
                  >
                    ◎ Analyse
                  </button>
                </div>

                {mode === 'hazard' && (
                  <div className="control-field">
                    <div className="field-header">
                      <span>Hazard Buffer Radius</span>
                      <span className="field-badge">{hazardR} km</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="40"
                      step="1"
                      value={hazardR}
                      onChange={(e) => setHazardR(Number(e.target.value))}
                      className="range-slider"
                    />
                  </div>
                )}

                <div className="control-field">
                  <div className="field-header">
                    <span>Transit Profile</span>
                    <span className="field-badge">{SPEEDS[travel]} km/h</span>
                  </div>
                  <select
                    className="select-input"
                    value={travel}
                    onChange={(e) => setTravel(e.target.value)}
                  >
                    <option value="rover">Rover Vehicle Traverse (10.0 km/h)</option>
                    <option value="foot">Pressurized Spacesuit EVA (2.5 km/h)</option>
                  </select>
                </div>

                <div className="control-field">
                  <div className="field-header">
                    <span>Space Weather State</span>
                    <span className="field-badge">{weather === 'nominal' ? 'Nominal' : 'SPE Alert'}</span>
                  </div>
                  <select
                    className="select-input"
                    value={weather}
                    onChange={(e) => setWeather(e.target.value)}
                  >
                    <option value="nominal">Nominal Low-Flux Solar Environment</option>
                    <option value="alert">Solar Particle Event (SPE Storm Warning)</option>
                  </select>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={returnHome}
                    onChange={(e) => setReturnHome(e.target.checked)}
                  />
                  <span>Close traverse loop to Habitat (Stop 1)</span>
                </label>

                <div className="section-subhead">
                  <span>Waypoints Manifest</span>
                  <span>{waypoints.length} stops</span>
                </div>

                {waypoints.length === 0 ? (
                  <div className="manifest-empty">
                    Click anywhere on the map to place Habitat Base (Stop 1), followed by science targets.
                  </div>
                ) : (
                  <div className="manifest-list">
                    {waypoints.map((w, i) => (
                      <div className="manifest-item" key={w.id}>
                        <span className="manifest-badge">{i + 1}</span>
                        <span className="manifest-coords">
                          {w.lat > 0 ? `${w.lat.toFixed(3)}°N` : `${Math.abs(w.lat).toFixed(3)}°S`}, {w.lng > 0 ? `${w.lng.toFixed(3)}°E` : `${Math.abs(w.lng).toFixed(3)}°W`}
                        </span>
                        <button
                          type="button"
                          className="manifest-del-btn"
                          onClick={() => setWaypoints((p) => p.filter((x) => x.id !== w.id))}
                          title="Remove stop"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="console-actions-row">
                  {waypoints.length > 0 && (
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => setWaypoints([])}
                    >
                      Clear Stops
                    </button>
                  )}
                  {hazards.length > 0 && (
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => setHazards([])}
                    >
                      Clear {hazards.length} Hazard{hazards.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              </>
            )}

            {activeTab === 'layers' && (
              <div className="layers-tab-content">
                <div className="layers-intro-note">
                  Global planetary basemaps from NASA Mars Trek. Click <strong>Solo View</strong> to isolate a layer at 100%, or blend multiple layers using the opacity sliders.
                </div>
                {LAYER_DEFS.map((d) => (
                  <div className={`layer-card ${state[d.id].on ? 'layer-active' : ''}`} key={d.id}>
                    <div className="layer-top-row">
                      <div className="layer-info">
                        <input
                          type="checkbox"
                          checked={state[d.id].on}
                          onChange={(e) => updateLayer(d.id, { on: e.target.checked })}
                          id={`layer-${d.id}`}
                        />
                        <label htmlFor={`layer-${d.id}`} className="layer-name">
                          {d.label}
                        </label>
                      </div>
                      <div className="layer-badges-group">
                        <span className={`layer-badge ${d.badgeClass}`}>{d.badge}</span>
                        <button
                          type="button"
                          className="layer-solo-btn"
                          onClick={() => soloLayer(d.id)}
                          title={`Isolate ${d.label} as active basemap`}
                        >
                          Solo View
                        </button>
                      </div>
                    </div>

                    <div className="layer-source-row">
                      <span className="layer-source">{d.source}</span>
                      <span className="field-badge">
                        {state[d.id].on ? `${Math.round(state[d.id].opacity * 100)}%` : 'OFF'}
                      </span>
                    </div>

                    <p className="layer-description">{d.desc}</p>

                    {/* Altimetry & Thermal Elevation Legends */}
                    {d.id === 'topo' && (
                      <div className="layer-legend-bar">
                        <div className="legend-gradient mola" />
                        <div className="legend-labels">
                          <span>-8.2 km (Basin)</span>
                          <span>0 km (Datum)</span>
                          <span>+21.2 km (Peak)</span>
                        </div>
                      </div>
                    )}

                    {d.id === 'thermal' && (
                      <div className="layer-legend-bar">
                        <div className="legend-gradient themis" />
                        <div className="legend-labels">
                          <span>Low Inertia (Dust)</span>
                          <span>Moderate</span>
                          <span>High (Rock / Bedrock)</span>
                        </div>
                      </div>
                    )}

                    <div className="layer-slider-row">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={state[d.id].opacity}
                        disabled={!state[d.id].on}
                        onChange={(e) => updateLayer(d.id, { opacity: Number(e.target.value) })}
                        className="range-slider"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'landmarks' && (
              <div className="landmarks-tab-content">
                <div className="preset-chips">
                  {LANDMARKS.map((lm) => (
                    <button
                      key={lm.name}
                      type="button"
                      className="preset-chip"
                      onClick={() => fly(lm.lat, lm.lng, 7)}
                    >
                      <span className="preset-name">{lm.name}</span>
                      <span className="preset-coords">{lm.lat > 0 ? `${lm.lat}°N` : `${Math.abs(lm.lat)}°S`}, {lm.lng > 0 ? `${lm.lng}°E` : `${Math.abs(lm.lng)}°W`} ({lm.elev})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          </aside>

          <div className="clearance-card">
            <div className="clearance-header">
              <span className="clearance-title">Traverse Clearance Assessment</span>
            </div>

            {!plan ? (
              <div className="empty-state-notice">
                Awaiting waypoint input. Click map to place Habitat (Stop 1) followed by science waypoints, or select <strong>Sample Traverse</strong> above.
              </div>
            ) : (
              <>
                <div className={`clearance-banner ${plan.level.toLowerCase().replace('-', '')}`}>
                  {plan.level === 'GO' && '✓ FLIGHT CLEARANCE: GO'}
                  {plan.level === 'CAUTION' && '⚠ CAUTION: SAFETY MARGIN'}
                  {plan.level === 'NO-GO' && '✕ ABORT: NO-GO CONDITION'}
                </div>

                <ul className="diagnostic-checklist">
                  {plan.reasons.map((r, i) => (
                    <li className="diagnostic-item" key={i}>
                      <span className={`diagnostic-bullet ${plan.level === 'NO-GO' ? 'fail' : plan.level === 'CAUTION' ? 'warn' : ''}`}>
                        {plan.level === 'NO-GO' ? '✕' : plan.level === 'CAUTION' ? '!' : '✓'}
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>

                <div className="telemetry-grid">
                  <div className="telemetry-cell">
                    <span className="cell-label">Traverse Distance</span>
                    <span className="cell-value">
                      {plan.distKm.toFixed(1)} km
                      {plan.distKm > plan.directKm && (
                        <span className="cell-detour">
                          +{(((plan.distKm / plan.directKm) - 1) * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="telemetry-cell">
                    <span className="cell-label">Estimated EVA Time</span>
                    <span className="cell-value">{plan.evaH.toFixed(1)} h</span>
                  </div>

                  <div className="telemetry-cell">
                    <span className="cell-label">Surface Radiation</span>
                    <span className="cell-value">{plan.doseMsv.toFixed(3)} mSv</span>
                  </div>

                  <div className="telemetry-cell">
                    <span className="cell-label">Science Manifest</span>
                    <span className="cell-value">{waypoints.length} Stops</span>
                  </div>
                </div>

                <p className="clearance-assumptions">
                  Velocity baseline: {SPEEDS[travel]} km/h ({travel === 'rover' ? 'Rover' : 'Spacesuit EVA'}). Science stop budget: {STOP_MIN} min/stop. Maximum allowable EVA duration: {EVA_LIMIT_H}.0 h.
                </p>
              </>
            )}
          </div>

          <LiveConditions
            isOpen={weatherPanelOpen}
            onToggle={() => setWeatherPanelOpen(!weatherPanelOpen)}
          />
        </div>

        {/* ==================================================================
            QUANTUM ECHO AI SIDEBAR
            ================================================================== */}
        <aside className={`console-right ${rightOpen ? '' : 'collapsed'}`}>
          <AiForecast
            pin={aiPin}
            onClear={() => setAiPin(null)}
            isOpen={aiPanelOpen}
            onToggle={() => setAiPanelOpen(!aiPanelOpen)}
          />
        </aside>

        {/* ==================================================================
            BOTTOM TACTICAL ROUTE SUMMARY HUD (When route is active)
            ================================================================== */}
        {plan && (
          <div className="route-summary-hud">
            <div className={`status-badge ${plan.level.toLowerCase().replace('-', '')}`}>
              <span className="status-badge-dot" />
              {plan.level}
            </div>

            <div className="hud-pill-group">
              <div className="hud-stat-item">
                <span className="hud-stat-label">Traverse</span>
                <span className="hud-stat-val">{plan.distKm.toFixed(1)} km</span>
              </div>

              <div className="hud-stat-item">
                <span className="hud-stat-label">EVA Time</span>
                <span className="hud-stat-val">{plan.evaH.toFixed(1)} h</span>
              </div>

              <div className="hud-stat-item">
                <span className="hud-stat-label">Radiation</span>
                <span className="hud-stat-val">{plan.doseMsv.toFixed(3)} mSv</span>
              </div>

              <div className="hud-stat-item">
                <span className="hud-stat-label">Stops</span>
                <span className="hud-stat-val">{waypoints.length}</span>
              </div>
            </div>

            <div className="hud-divider" />

            <button
              type="button"
              className="hud-action-btn"
              onClick={fitRouteBounds}
              title="Center and zoom map to display entire route"
            >
              Fit View
            </button>
          </div>
        )}

        {/* ==================================================================
            3D PLANETARY GLOBE LAYER
            ================================================================== */}
        <div className={`globe-layer ${globeOn ? 'in' : ''}`}>
          <MarsGlobe
            interactive
            spin={0.0008}
            focus={focus}
            markers={HISTORY}
            onPick={(lat, lng) => fly(lat, lng, 6)}
          />
          <div className="globe-overlay-hint">
            Interactive Martian Globe // Drag to rotate. Click any surface feature to descend.
          </div>
        </div>
      </div>

      {/* ====================================================================
          MODALS & CINEMATIC INTRO
          ==================================================================== */}
      <CoordinateModal
        isOpen={coordModalOpen}
        onClose={() => setCoordModalOpen(false)}
        onTeleport={fly}
      />

      <HistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        onFlyTo={fly}
      />

      {routeViewOpen && (
        <RouteView3D
          waypoints={waypoints}
          hazards={hazards}
          routeLL={plan ? plan.routeLL : null}
          summary={plan}
          onClose={() => setRouteViewOpen(false)}
        />
      )}

      {phase === 'intro' && (
        <Intro
          onStart={() => setPhase('active')}
          onPreset={(p) => {
            if (p === 'gale') {
              loadGalePreset()
            }
          }}
        />
      )}
    </div>
  )
}
