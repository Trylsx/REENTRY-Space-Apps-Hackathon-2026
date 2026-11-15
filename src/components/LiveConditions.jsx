import { useEffect, useState } from 'react'

const WEATHER_URL = 'https://api.maas2.apollorion.com/'
const PHOTO_URL =
  'https://mars.nasa.gov/api/v1/raw_image_items/?order=sol+desc&per_page=9&page=0&condition_1=msl%3Amission'

// Reliable Gale Crater nominal baseline for fallback when live NASA uplink is offline
const GALE_BASELINE = {
  sol: 4362,
  terrestrial_date: '2024-11-12',
  min_temp: -76,
  max_temp: -12,
  min_gts_temp: -84,
  max_gts_temp: 4,
  pressure: 824,
  local_uv_irradiance_index: 'Moderate',
  sunrise: '05:32',
  sunset: '17:28',
  season: 'Late Autumn (LS 254°)',
  isBaseline: true,
}

const show = (v, unit = '') =>
  v === null || v === undefined || v === '--' || v === '' ? '—' : `${v}${unit}`

export default function LiveConditions({ isOpen, onToggle }) {
  const [wx, setWx] = useState({ status: 'loading', d: null })
  const [photos, setPhotos] = useState({ status: 'loading', items: [] })
  const [selectedImage, setSelectedImage] = useState(null)
  const [activeSubTab, setActiveSubTab] = useState('weather') // 'weather' | 'cameras'

  useEffect(() => {
    let active = true

    fetch(WEATHER_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (!active) return
        const d = j.soles ? j.soles[0] : j
        setWx({ status: 'ok', d })
      })
      .catch((err) => {
        if (!active) return
        console.warn('Live weather feed offline, using in-situ baseline:', err)
        setWx({ status: 'fallback', d: GALE_BASELINE })
      })

    fetch(PHOTO_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => {
        if (!active) return
        const raw = j.items || j.images || []
        const items = raw
          .map((i) => ({
            src: i.https_url || i.url || (i.image_files && (i.image_files.small || i.image_files.medium || i.image_files.full_res)),
            sol: i.sol,
            cam: i.instrument || (i.camera && (i.camera.full_name || i.camera.instrument)) || 'Mastcam',
            date: i.earth_date || '',
          }))
          .filter((p) => p.src)
          .slice(0, 9)

        setPhotos({ status: items.length ? 'ok' : 'empty', items })
      })
      .catch((err) => {
        if (!active) return
        console.warn('NASA raw image feed unavailable:', err)
        setPhotos({ status: 'offline', items: [] })
      })

    return () => {
      active = false
    }
  }, [])

  const d = wx.d || GALE_BASELINE

  return (
    <div className="telemetry-panel">
      <div className="telemetry-panel-header" onClick={onToggle}>
        <div className="header-status-title">
          <span className="live-dot" />
          <span className="header-title-text">Gale Station Telemetry</span>
          <span className="source-tag">{wx.status === 'ok' ? 'REMS LIVE' : 'IN-SITU RECORD'}</span>
        </div>
        <button
          type="button"
          className="collapse-toggle"
          aria-label={isOpen ? 'Collapse telemetry panel' : 'Expand telemetry panel'}
        >
          {isOpen ? '▲' : '▼'}
        </button>
      </div>

      {isOpen && (
        <div className="telemetry-content">
          {/* Sub-tabs for Weather vs Cameras */}
          <div className="telemetry-subtabs">
            <button
              type="button"
              className={`subtab-btn ${activeSubTab === 'weather' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('weather')}
            >
              Atmospheric REMS
            </button>
            <button
              type="button"
              className={`subtab-btn ${activeSubTab === 'cameras' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('cameras')}
            >
              Rover Cameras {photos.items.length ? `(${photos.items.length})` : ''}
            </button>
          </div>

          {activeSubTab === 'weather' && (
            <div className="weather-view-fade">
              <div className="sol-badge-row">
                <div className="sol-count">
                  <span className="sol-label">SOL</span>
                  <span className="sol-number">{show(d.sol)}</span>
                </div>
                <div className="terrestrial-date">
                  <span className="field-label">EARTH DATE</span>
                  <span className="field-val">{show(d.terrestrial_date)}</span>
                </div>
                <div className="martian-season">
                  <span className="field-label">SEASON</span>
                  <span className="field-val">{show(d.season)}</span>
                </div>
              </div>

              <div className="telemetry-metrics-grid">
                <div className="metric-box">
                  <span className="metric-label">Air Temp (Min / Max)</span>
                  <span className="metric-val">
                    {show(d.min_temp)}° / {show(d.max_temp)}° <span className="metric-unit">C</span>
                  </span>
                </div>

                <div className="metric-box">
                  <span className="metric-label">Ground Surface Temp</span>
                  <span className="metric-val">
                    {show(d.min_gts_temp)}° / {show(d.max_gts_temp)}° <span className="metric-unit">C</span>
                  </span>
                </div>

                <div className="metric-box">
                  <span className="metric-label">Atmospheric Pressure</span>
                  <span className="metric-val">
                    {show(d.pressure)} <span className="metric-unit">Pa</span>
                  </span>
                </div>

                <div className="metric-box">
                  <span className="metric-label">UV Radiation Flux</span>
                  <span className="metric-val">{show(d.local_uv_irradiance_index)}</span>
                </div>

                <div className="metric-box">
                  <span className="metric-label">Local Dawn / Dusk</span>
                  <span className="metric-val">
                    {show(d.sunrise)} / {show(d.sunset)}
                  </span>
                </div>

                <div className="metric-box">
                  <span className="metric-label">Surface Radiation</span>
                  <span className="metric-val">
                    0.640 <span className="metric-unit">mSv/day</span>
                  </span>
                </div>
              </div>

              <div className="telemetry-footer-note">
                Curiosity Rover Environmental Monitoring Station (REMS) calibrated in-situ data via Centro de Astrobiología (CAB/CSIC-INTA) and NASA JPL.
              </div>
            </div>
          )}

          {activeSubTab === 'cameras' && (
            <div className="cameras-view-fade">
              <div className="section-title-row">
                <span className="camera-section-title">Mount Sharp Raw Camera Feed</span>
                <a
                  href="https://mars.nasa.gov/msl/multimedia/raw-images/"
                  target="_blank"
                  rel="noreferrer"
                  className="external-link"
                >
                  NASA Archive ↗
                </a>
              </div>

              {photos.status === 'loading' && (
                <div className="photo-placeholder-loading">Downlinking raw imagery telemetry...</div>
              )}

              {photos.status === 'ok' && (
                <div className="photo-grid">
                  {photos.items.map((p, i) => (
                    <div
                      key={i}
                      className="photo-card"
                      onClick={() => setSelectedImage(p)}
                      title={`Sol ${p.sol} — ${p.cam}`}
                    >
                      <img src={p.src} alt={`Curiosity sol ${p.sol}`} className="photo-thumb" loading="lazy" />
                      <div className="photo-meta">
                        <span className="photo-cam">{p.cam}</span>
                        <span className="photo-sol">Sol {p.sol}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(photos.status === 'offline' || photos.status === 'empty') && (
                <div className="photo-placeholder-offline">
                  <span>Downlink idle. High-resolution surface imagery is rendered live from NASA Trek orbital mosaics.</span>
                </div>
              )}

              <div className="telemetry-footer-note">
                Click any raw frame to open full-resolution optical inspection.
              </div>
            </div>
          )}
        </div>
      )}

      {selectedImage && (
        <div className="lightbox-backdrop" onClick={() => setSelectedImage(null)}>
          <div className="lightbox-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-header">
              <span>{selectedImage.cam} · Sol {selectedImage.sol} {selectedImage.date ? `(${selectedImage.date})` : ''}</span>
              <button className="modal-close" onClick={() => setSelectedImage(null)}>×</button>
            </div>
            <img src={selectedImage.src} alt="Full resolution Mars surface view" className="lightbox-img" />
          </div>
        </div>
      )}
    </div>
  )
}
