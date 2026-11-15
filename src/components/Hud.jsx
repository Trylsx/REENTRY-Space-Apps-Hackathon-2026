import { useState } from 'react'
import MarsGlobe from './MarsGlobe'
import { HISTORY, LANDMARKS, thumb } from '../data/history'

export function Intro({ onStart, onPreset }) {
  const [leaving, setLeaving] = useState(false)

  const handleStart = (preset = null) => {
    setLeaving(true)
    setTimeout(() => {
      if (preset && onPreset) {
        onPreset(preset)
      }
      onStart()
    }, 850)
  }

  return (
    <div className={`intro-screen ${leaving ? 'leaving' : ''}`}>
      <div className="intro-globe-backdrop">
        <MarsGlobe spin={0.0012} />
      </div>

      <div className="intro-overlay">
        <div className="intro-container">
          <div className="intro-header">
            <span className="agency-tag">TEAM REENTRY</span>
            <span className="division-tag">EVA OPS · GALE CRATER DISPATCH</span>
          </div>

          <h1 className="intro-title">
            MARSWALK <span className="title-dim">3D</span>
          </h1>

          <p className="intro-lead">
            Surface traverse planner and tactical operations console for extravehicular 
            crews and robotic explorers on Mars.
          </p>

          <div className="intro-specs-grid">
            <div className="spec-card">
              <span className="spec-label">Orbital Basemap</span>
              <span className="spec-value">232m MDIM 2.1</span>
              <span className="spec-desc">Viking global color mosaic with MOLA altimetry</span>
            </div>
            <div className="spec-card">
              <span className="spec-label">Traverse Dynamics</span>
              <span className="spec-value">Hazard Avoidance</span>
              <span className="spec-desc">Automatic obstacle clearance & radiation dose models</span>
            </div>
            <div className="spec-card">
              <span className="spec-label">Surface Telemetry</span>
              <span className="spec-value">Curiosity REMS</span>
              <span className="spec-desc">Real-time Gale atmospheric data & raw camera feeds</span>
            </div>
          </div>

          <div className="intro-actions">
            <button className="btn-primary" onClick={() => handleStart()}>
              Launch Mission Console
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
            <button className="btn-secondary" onClick={() => handleStart('gale')}>
              Load Gale Crater Traverse
            </button>
          </div>

          <div className="intro-footer-line">
            <span>COORDINATE DATUM: IAU MARS 2000 // R_MARS = 3,389.5 KM</span>
            <span>FLIGHT CONTROL DESK // V2.5</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CoordinateModal({ isOpen, onClose, onTeleport }) {
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [err, setErr] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    const parsedLat = parseFloat(lat)
    let parsedLng = parseFloat(lng)

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      setErr('Please enter valid numerical coordinates.')
      return
    }

    if (parsedLng > 180) parsedLng -= 360

    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      setErr('Latitude must be between -90° and +90°. Longitude between -180° and +180° (or 0° to 360°).')
      return
    }

    setErr('')
    onTeleport(parsedLat, parsedLng)
    onClose()
  }

  const handlePreset = (targetLat, targetLng) => {
    onTeleport(targetLat, targetLng)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-category">TACTICAL NAVIGATION</span>
            <h3 className="modal-title">Teleport to Martian Coordinates</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        <form onSubmit={handleSubmit} className="coord-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="modal-lat">Latitude (°)</label>
              <input
                id="modal-lat"
                type="number"
                step="any"
                placeholder="-5.400 (South / North)"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                autoFocus
              />
              <span className="field-hint">Range: -90.0° to +90.0°</span>
            </div>

            <div className="form-group">
              <label htmlFor="modal-lng">Longitude (°)</label>
              <input
                id="modal-lng"
                type="number"
                step="any"
                placeholder="137.800 (East / West)"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
              <span className="field-hint">Range: -180.0° to +180.0°</span>
            </div>
          </div>

          {err && <div className="form-error">{err}</div>}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Fly to Coordinates
            </button>
          </div>
        </form>

        <div className="presets-section">
          <span className="presets-label">Martian Geographical Landmarks:</span>
          <div className="preset-chips">
            {LANDMARKS.map((lm) => (
              <button
                key={lm.name}
                type="button"
                className="preset-chip"
                onClick={() => handlePreset(lm.lat, lm.lng)}
                title={`${lm.note} (${lm.elev})`}
              >
                <span className="preset-name">{lm.name}</span>
                <span className="preset-coords">{lm.lat > 0 ? `${lm.lat}°N` : `${Math.abs(lm.lat)}°S`}, {lm.lng > 0 ? `${lm.lng}°E` : `${Math.abs(lm.lng)}°W`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function HistoryModal({ isOpen, onClose, onFlyTo }) {
  if (!isOpen) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-category">PLANETARY ARCHIVE</span>
            <h3 className="modal-title">Historic Martian Surface Missions</h3>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        <p className="modal-desc">
          Documented human-made landers and rovers that successfully operated on the Martian surface. 
          Satellite thumbnail imagery rendered from real NASA Trek Viking mosaics.
        </p>

        <div className="history-grid">
          {HISTORY.map((h) => (
            <div key={h.name} className="history-card">
              <div className="history-thumb-wrap">
                <img src={thumb(h.lat, h.lng)} alt={`Satellite view of ${h.name} landing site`} className="history-thumb" />
                <span className="history-year">{h.year}</span>
                <span className="history-agency">{h.agency}</span>
              </div>
              <div className="history-info">
                <div className="history-name-row">
                  <span className="history-name">{h.name}</span>
                  <span className="history-type">{h.type}</span>
                </div>
                <div className="history-coords">
                  {h.lat > 0 ? `${h.lat.toFixed(2)}°N` : `${Math.abs(h.lat).toFixed(2)}°S`}, {h.lng > 0 ? `${h.lng.toFixed(2)}°E` : `${Math.abs(h.lng).toFixed(2)}°W`}
                </div>
                <p className="history-note">{h.note}</p>
                <button
                  type="button"
                  className="btn-card-action"
                  onClick={() => {
                    onFlyTo(h.lat, h.lng, 7)
                    onClose()
                  }}
                >
                  Inspect Site
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8h10M9 4l4 4-4 4" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
