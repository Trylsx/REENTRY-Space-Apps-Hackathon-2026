import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { fetchTerrainPatch } from '../api/quantumEcho'

const KM_PER_DEG = 59.17
const SPANS = [150, 300, 600]
const PLAY_MS = 9000
const PALETTE = {
  smooth: ['#22c55e', '#15a34a'],
  moderate: ['#facc15', '#e6a817'],
  rugged: ['#f97316', '#ea580c'],
  highly: ['#ef4444', '#d946a6'],
  other: ['#94a3b8', '#64748b'],
}
const LETTERS = ['A', 'B', 'C', 'D']

const family = (name) => {
  const n = name.toLowerCase()
  if (n.includes('highly')) return 'highly'
  if (n.includes('smooth')) return 'smooth'
  if (n.includes('moderate')) return 'moderate'
  if (n.includes('rugged')) return 'rugged'
  return 'other'
}

function describeClusters(names) {
  const ids = Object.keys(names).map(Number).sort((a, b) => a - b)
  const groups = {}
  ids.forEach((id) => {
    const f = family(names[id])
    groups[f] = groups[f] || []
    groups[f].push(id)
  })
  const info = {}
  ids.forEach((id) => {
    const f = family(names[id])
    const idx = groups[f].indexOf(id)
    const base = names[id].replace(' terrain pattern', '')
    info[id] = {
      color: PALETTE[f][Math.min(idx, 1)],
      label: groups[f].length > 1 ? `${base} ${LETTERS[idx]}` : base,
    }
  })
  return info
}

function computeBounds(points, spanKm) {
  const lats = points.map((p) => p[0])
  const lngs = points.map((p) => p[1])
  const latC = (Math.min(...lats) + Math.max(...lats)) / 2
  const lngC = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const kmLon = KM_PER_DEG * Math.max(Math.cos((latC * Math.PI) / 180), 0.05)
  const hKm = Math.min(Math.max((Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG * 1.5, spanKm), 4000)
  const wKm = Math.min(Math.max((Math.max(...lngs) - Math.min(...lngs)) * kmLon * 1.5, spanKm), 4000)
  let latMin = latC - hKm / KM_PER_DEG / 2
  let latMax = latC + hKm / KM_PER_DEG / 2
  if (latMin < -90) {
    latMax += -90 - latMin
    latMin = -90
  }
  if (latMax > 90) {
    latMin -= latMax - 90
    latMax = 90
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4
  return {
    latMin: r4(Math.max(latMin, -90)),
    latMax: r4(Math.min(latMax, 90)),
    lonMin: r4(lngC - wKm / kmLon / 2),
    lonMax: r4(lngC + wKm / kmLon / 2),
  }
}

function boxBlur(src, rows, cols, radius) {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = [0, 0, 0]
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const jj = Math.min(cols - 1, Math.max(0, j + k))
        const o = (i * cols + jj) * 3
        sum = [sum[0] + src[o], sum[1] + src[o + 1], sum[2] + src[o + 2]]
        n++
      }
      const o = (i * cols + j) * 3
      tmp[o] = sum[0] / n
      tmp[o + 1] = sum[1] / n
      tmp[o + 2] = sum[2] / n
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let sum = [0, 0, 0]
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const ii = Math.min(rows - 1, Math.max(0, i + k))
        const o = (ii * cols + j) * 3
        sum = [sum[0] + tmp[o], sum[1] + tmp[o + 1], sum[2] + tmp[o + 2]]
        n++
      }
      const o = (i * cols + j) * 3
      out[o] = sum[0] / n
      out[o + 1] = sum[1] / n
      out[o + 2] = sum[2] / n
    }
  }
  return out
}

function disposeTree(obj) {
  obj.traverse((c) => {
    if (c.geometry) c.geometry.dispose()
    if (c.material) c.material.dispose()
  })
}

function makeLabel(container, text, className) {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  container.appendChild(el)
  return el
}

export default function RouteView3D({ waypoints, hazards, routeLL, summary, onClose }) {
  const hostRef = useRef(null)
  const labelRef = useRef(null)
  const three = useRef(null)
  const [exag, setExag] = useState(4)
  const [spanKm, setSpanKm] = useState(150)
  const [showLabels, setShowLabels] = useState(true)
  const [result, setResult] = useState({ key: '', data: null, error: '' })

  const routePts = useMemo(
    () => (routeLL && routeLL.length > 1 ? routeLL : waypoints.map((w) => [w.lat, w.lng])),
    [routeLL, waypoints]
  )

  const bounds = useMemo(() => {
    const pts = [...routePts]
    hazards.forEach((h) => {
      const dLat = h.rKm / KM_PER_DEG
      const dLng = h.rKm / (KM_PER_DEG * Math.max(Math.cos((h.lat * Math.PI) / 180), 0.05))
      pts.push([h.lat - dLat, h.lng - dLng], [h.lat + dLat, h.lng + dLng])
    })
    return computeBounds(pts, spanKm)
  }, [routePts, hazards, spanKm])

  const key = `${bounds.latMin}|${bounds.latMax}|${bounds.lonMin}|${bounds.lonMax}`

  useEffect(() => {
    const ctrl = new AbortController()
    fetchTerrainPatch({ ...bounds, size: 96 }, ctrl.signal)
      .then((data) => setResult({ key, data, error: '' }))
      .catch((err) => {
        if (err.name === 'AbortError') return
        setResult({ key, data: null, error: err.message })
      })
    return () => ctrl.abort()
  }, [bounds, key])

  const loading = result.key !== key
  const data = loading ? null : result.data
  const error = loading ? '' : result.error

  const clusterInfo = useMemo(() => (data ? describeClusters(data.cluster_names) : null), [data])
  const presentClusters = useMemo(() => {
    if (!data) return []
    return [...new Set(data.cluster.flat())].sort((a, b) => a - b)
  }, [data])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!data) return undefined
    const host = hostRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#06080d')
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2 - 0.05

    const latC = (data.lat_min + data.lat_max) / 2
    const kmLon = KM_PER_DEG * Math.cos((latC * Math.PI) / 180)
    const W = (data.lon_max - data.lon_min) * kmLon
    const D = (data.lat_max - data.lat_min) * KM_PER_DEG
    const size = Math.max(W, D)

    scene.add(new THREE.AmbientLight('#ffffff', 0.55))
    scene.add(new THREE.HemisphereLight('#ffd9c0', '#2a1a14', 0.45))
    const sun = new THREE.DirectionalLight('#fff0e0', 2.4)
    sun.position.set(-size, size * 0.55, size * 0.5)
    scene.add(sun)

    const world = new THREE.Group()
    scene.add(world)

    camera.position.set(0, size * 0.62, D / 2 + size * 0.75)
    controls.target.set(0, 0, 0)
    controls.minDistance = size * 0.15
    controls.maxDistance = size * 3
    controls.update()

    const state = {
      renderer,
      scene,
      camera,
      controls,
      world,
      labels: [],
      animStart: performance.now(),
      built: false,
      tubeSegments: 0,
      tube: null,
      curve: null,
      rover: null,
      raf: 0,
    }
    three.current = state

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const tmp = new THREE.Vector3()
    const loop = () => {
      state.raf = requestAnimationFrame(loop)
      controls.update()
      const raw = Math.min(1, (performance.now() - state.animStart) / PLAY_MS)
      const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2
      if (state.tube) {
        state.tube.geometry.setDrawRange(0, Math.floor(t * state.tubeSegments) * 36)
        if (state.rover && state.curve) {
          state.curve.getPoint(t, tmp)
          state.rover.position.copy(tmp)
          state.rover.visible = raw < 1
        }
      }
      renderer.render(scene, camera)
      const w = host.clientWidth
      const h = host.clientHeight
      state.labels.forEach((l) => {
        tmp.copy(l.pos).project(camera)
        const visible = tmp.z < 1 && tmp.z > -1
        l.el.style.display = visible ? 'block' : 'none'
        if (visible) {
          l.el.style.transform = `translate(-50%, -100%) translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`
        }
      })
    }
    loop()

    const labelHost = labelRef.current
    return () => {
      cancelAnimationFrame(state.raf)
      observer.disconnect()
      controls.dispose()
      disposeTree(world)
      renderer.dispose()
      host.removeChild(renderer.domElement)
      labelHost.replaceChildren()
      three.current = null
    }
  }, [data])

  useEffect(() => {
    const state = three.current
    if (!data || !state || !clusterInfo) return
    const { world, labels } = state
    while (world.children.length) {
      const c = world.children[0]
      world.remove(c)
      disposeTree(c)
    }
    labelRef.current.replaceChildren()
    labels.length = 0

    const { rows, cols } = data
    const latC = (data.lat_min + data.lat_max) / 2
    const lonC = (data.lon_min + data.lon_max) / 2
    const kmLon = KM_PER_DEG * Math.cos((latC * Math.PI) / 180)
    const W = (data.lon_max - data.lon_min) * kmLon
    const D = (data.lat_max - data.lat_min) * KM_PER_DEG
    const size = Math.max(W, D)
    const elev = Float32Array.from(data.elevation_m.flat())
    const meanM = elev.reduce((a, b) => a + b, 0) / elev.length
    const yOf = (m) => ((m - meanM) / 1000) * exag

    const heightAt = (lat, lng) => {
      const fr = Math.min(rows - 1, Math.max(0, ((data.lat_max - lat) / (data.lat_max - data.lat_min)) * (rows - 1)))
      const fc = Math.min(cols - 1, Math.max(0, ((lng - data.lon_min) / (data.lon_max - data.lon_min)) * (cols - 1)))
      const r0 = Math.min(rows - 2, Math.floor(fr))
      const c0 = Math.min(cols - 2, Math.floor(fc))
      const tr = fr - r0
      const tc = fc - c0
      const at = (r, c) => elev[r * cols + c]
      const top = at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc
      const bot = at(r0 + 1, c0) * (1 - tc) + at(r0 + 1, c0 + 1) * tc
      return yOf(top * (1 - tr) + bot * tr)
    }
    const toX = (lng) => (lng - lonC) * kmLon
    const toZ = (lat) => -(lat - latC) * KM_PER_DEG
    const lift = Math.max(0.15, size * 0.003)

    const positions = new Float32Array(rows * cols * 3)
    const base = new Float32Array(rows * cols * 3)
    const flat = data.cluster.flat()
    const color = new THREE.Color()
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const idx = i * cols + j
        positions[idx * 3] = -W / 2 + (W * j) / (cols - 1)
        positions[idx * 3 + 1] = yOf(elev[idx])
        positions[idx * 3 + 2] = -D / 2 + (D * i) / (rows - 1)
        color.set(clusterInfo[flat[idx]].color)
        base[idx * 3] = color.r
        base[idx * 3 + 1] = color.g
        base[idx * 3 + 2] = color.b
      }
    }
    const lonSpan = data.lon_max - data.lon_min
    const radius = Math.max(1, Math.round((cols / (lonSpan / 0.25)) * 0.55))
    let colors = boxBlur(base, rows, cols, radius)
    colors = boxBlur(colors, rows, cols, radius)

    const indices = []
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j
        const b = a + 1
        const c = a + cols
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    world.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })))

    let yMin = Infinity
    let yMax = -Infinity
    for (let i = 1; i < positions.length; i += 3) {
      yMin = Math.min(yMin, positions[i])
      yMax = Math.max(yMax, positions[i])
    }

    hazards.forEach((h) => {
      const x = toX(h.lng)
      const z = toZ(h.lat)
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(h.rKm, h.rKm, yMax - yMin + 2, 48, 1, true),
        new THREE.MeshBasicMaterial({
          color: '#ef4444',
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
      wall.position.set(x, (yMax + yMin) / 2, z)
      world.add(wall)
      const ring = []
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2
        const rx = x + Math.cos(a) * h.rKm
        const rz = z + Math.sin(a) * h.rKm
        const lat = latC - rz / KM_PER_DEG
        const lng = lonC + rx / kmLon
        ring.push(new THREE.Vector3(rx, heightAt(lat, lng) + lift, rz))
      }
      world.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: '#f87171' })))
    })

    const dense = []
    const step = Math.max(size / 160, 0.2)
    for (let i = 0; i < routePts.length; i++) {
      const [lat, lng] = routePts[i]
      if (i > 0) {
        const [pLat, pLng] = routePts[i - 1]
        const km = Math.hypot((lng - pLng) * kmLon, (lat - pLat) * KM_PER_DEG)
        const n = Math.max(1, Math.ceil(km / step))
        for (let k = 1; k < n; k++) {
          const f = k / n
          const la = pLat + (lat - pLat) * f
          const ln = pLng + (lng - pLng) * f
          dense.push(new THREE.Vector3(toX(ln), heightAt(la, ln) + lift, toZ(la)))
        }
      }
      dense.push(new THREE.Vector3(toX(lng), heightAt(lat, lng) + lift, toZ(lat)))
    }
    if (dense.length > 1) {
      const curve = new THREE.CatmullRomCurve3(dense, false, 'centripetal')
      const segments = Math.min(dense.length * 2, 1500)
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, size * 0.002, 6, false),
        new THREE.MeshBasicMaterial({ color: '#ffffff' })
      )
      world.add(tube)
      const rover = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.007, 20, 14),
        new THREE.MeshBasicMaterial({ color: '#e05a34' })
      )
      world.add(rover)
      state.tube = tube
      state.curve = curve
      state.rover = rover
      state.tubeSegments = segments
    } else {
      state.tube = null
      state.curve = null
      state.rover = null
    }

    data.regions.forEach((r) => {
      const idx = r.row * cols + r.col
      const pos = new THREE.Vector3(positions[idx * 3], positions[idx * 3 + 1] + size * 0.035, positions[idx * 3 + 2])
      labels.push({ el: makeLabel(labelRef.current, clusterInfo[r.cluster].label, 'r3d-label region'), pos })
    })

    waypoints.forEach((w, i) => {
      const y = heightAt(w.lat, w.lng)
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.006, 16, 12),
        new THREE.MeshBasicMaterial({ color: '#f59e0b' })
      )
      marker.position.set(toX(w.lng), y + lift, toZ(w.lat))
      world.add(marker)
      const text = w.label ? `${i + 1} · ${w.label}` : `Stop ${i + 1}`
      labels.push({
        el: makeLabel(labelRef.current, text, 'r3d-label stop'),
        pos: new THREE.Vector3(toX(w.lng), y + size * 0.03, toZ(w.lat)),
      })
    })

    state.animStart = state.built ? performance.now() - PLAY_MS : performance.now()
    state.built = true
  }, [data, clusterInfo, exag, routePts, hazards, waypoints])

  const replay = () => {
    if (three.current) three.current.animStart = performance.now()
  }

  return (
    <div className="r3d-overlay">
      <div ref={hostRef} className="r3d-canvas" />
      <div ref={labelRef} className={`r3d-labels ${showLabels ? '' : 'hidden'}`} />

      <div className="r3d-topbar">
        <div className="r3d-title">
          <span className="r3d-title-main">3D Route View</span>
          <span className="r3d-title-sub">
            {summary
              ? `${summary.distKm.toFixed(1)} km · ${summary.evaH.toFixed(1)} h EVA · ${waypoints.length} stops`
              : `${waypoints.length} stop${waypoints.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <button type="button" className="action-btn" onClick={onClose}>
          Close ✕
        </button>
      </div>

      {data && (
        <div className="r3d-legend">
          <span className="r3d-panel-title">AI terrain zones</span>
          {presentClusters.map((id) => (
            <div className="r3d-legend-row" key={id}>
              <span className="r3d-swatch" style={{ background: clusterInfo[id].color }} />
              {clusterInfo[id].label}
            </div>
          ))}
        </div>
      )}

      <div className="r3d-controls">
        <span className="r3d-panel-title">View</span>
        <div className="field-header">
          <span>Vertical exaggeration</span>
          <span className="field-badge">{exag}×</span>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={exag}
          onChange={(e) => setExag(Number(e.target.value))}
          className="range-slider"
        />
        <div className="field-header">
          <span>Context area</span>
          <span className="field-badge">{spanKm} km</span>
        </div>
        <div className="telemetry-subtabs">
          {SPANS.map((s) => (
            <button
              type="button"
              key={s}
              className={`subtab-btn ${spanKm === s ? 'active' : ''}`}
              onClick={() => setSpanKm(s)}
            >
              {s} km
            </button>
          ))}
        </div>
        <div className="r3d-btn-row">
          <button type="button" className="btn-quiet" onClick={replay}>
            ▶ Replay route
          </button>
          <button type="button" className="btn-quiet" onClick={() => setShowLabels(!showLabels)}>
            {showLabels ? 'Hide labels' : 'Show labels'}
          </button>
        </div>
      </div>

      {data && (
        <p className="r3d-footnote">
          Elevation: MOLA 0.25° grid, smoothed (about 15 km per cell, so fine relief is not shown). Zones: AI terrain
          clusters, not geologic maps. Vertical scale exaggerated {exag}×. Drag to orbit, scroll to zoom.
        </p>
      )}

      {loading && <div className="r3d-status">Building terrain…</div>}
      {error && (
        <div className="r3d-status r3d-status-error">
          Terrain backend unreachable ({error}). Start it with <code>uvicorn app.main:app --port 8000</code> in{' '}
          <code>backend/</code>.
        </div>
      )}
    </div>
  )
}
