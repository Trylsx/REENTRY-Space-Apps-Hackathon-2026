const BASE = import.meta.env.VITE_QUANTUM_API_BASE || ''

const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180

async function get(path, params, signal) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) query.set(key, String(value))
  })
  const res = await fetch(`${BASE}${path}?${query}`, { signal })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : 'Invalid request'
    } catch {
      detail = `HTTP ${res.status}`
    }
    throw new Error(detail)
  }
  return res.json()
}

export const fetchAnalysis = ({ lat, lng, ls, localTime }, signal) =>
  get('/api/analyse', { lat, lon: wrapLng(lng), ls, local_time: localTime }, signal)

export const fetchDayCurve = ({ lat, lng, ls }, signal) =>
  get('/api/day-curve', { lat, lon: wrapLng(lng), ls }, signal)

export const fetchMcdEnvironment = ({ lat, lng, ls, localTime }, signal) =>
  get('/api/environment', { lat, lon: wrapLng(lng), ls, local_time: localTime }, signal)

export const fetchTerrainPatch = ({ latMin, latMax, lonMin, lonMax, size = 96 }, signal) =>
  get('/api/terrain-patch', { lat_min: latMin, lat_max: latMax, lon_min: lonMin, lon_max: lonMax, size }, signal)
