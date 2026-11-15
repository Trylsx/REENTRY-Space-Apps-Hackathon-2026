// Landing sites and milestones. lng = east longitude folded into -180..180
export const HISTORY = [
  { name: 'Viking 1', year: 1976, lat: 22.5, lng: -48.0, agency: 'NASA', type: 'Lander', note: 'First operational Mars surface lander (Chryse Planitia)' },
  { name: 'Viking 2', year: 1976, lat: 47.6, lng: -134.3, agency: 'NASA', type: 'Lander', note: 'Northern plains lander in Utopia Planitia' },
  { name: 'Pathfinder', year: 1997, lat: 19.1, lng: -33.2, agency: 'NASA', type: 'Rover', note: 'Sojourner rover; first planetary rover demonstration' },
  { name: 'Spirit', year: 2004, lat: -14.6, lng: 175.5, agency: 'NASA', type: 'Rover', note: 'Explored volcanic plains and Columbia Hills in Gusev Crater' },
  { name: 'Opportunity', year: 2004, lat: -1.9, lng: -5.5, agency: 'NASA', type: 'Rover', note: 'Discovered hematite spherules in Meridiani Planum, roved 45.16 km' },
  { name: 'Phoenix', year: 2008, lat: 68.2, lng: -125.7, agency: 'NASA', type: 'Lander', note: 'Directly verified water ice in the Martian arctic soil' },
  { name: 'Curiosity', year: 2012, lat: -4.59, lng: 137.44, agency: 'NASA', type: 'Rover', note: 'Bradbury Landing, Gale Crater; climbing Mount Sharp' },
  { name: 'InSight', year: 2018, lat: 4.5, lng: 135.6, agency: 'NASA', type: 'Lander', note: 'Internal seismic station; detected over 1,300 marsquakes' },
  { name: 'Perseverance', year: 2021, lat: 18.44, lng: 77.45, agency: 'NASA', type: 'Rover', note: 'Octavia E. Butler Landing; ancient river delta sample caching' },
  { name: 'Zhurong', year: 2021, lat: 25.1, lng: 109.9, agency: 'CNSA', type: 'Rover', note: 'Tianwen-1 mission; southern Utopia Planitia surface radar' },
]

export const LANDMARKS = [
  { name: 'Gale Crater (Mount Sharp)', lat: -5.4, lng: 137.8, elev: '-4.5 km', note: 'Sedimentary layers recording ancient Martian lake environments' },
  { name: 'Olympus Mons', lat: 18.65, lng: -133.8, elev: '+21.9 km', note: 'Largest volcano in the solar system; spans over 600 km across' },
  { name: 'Valles Marineris', lat: -14.0, lng: -59.2, elev: '-7.0 km', note: 'Tectonic canyon system extending over 4,000 km along the equator' },
  { name: 'Jezero Crater', lat: 18.44, lng: 77.45, elev: '-2.5 km', note: 'Preserved clay delta deposits from an ancient crater paleolake' },
  { name: 'Victoria Crater', lat: -2.05, lng: -5.5, elev: '-1.4 km', note: 'Impact crater in Meridiani Planum with exposed cliff stratigraphy' },
  { name: 'Elysium Mons', lat: 25.02, lng: 147.21, elev: '+14.1 km', note: 'Massive shield volcano in the volcanic Elysium province' },
]

// Real NASA Trek tile covering the site, used as its photo
export const thumb = (lat, lng, z = 5) =>
  `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${Math.floor(((90 - lat) / 180) * 2 ** z)}/${Math.floor(((lng + 180) / 360) * 2 ** (z + 1))}.jpg`

