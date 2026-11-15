import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const D = Math.PI / 180
const toVec = (lat, lng, r = 1) => {
  const p = (90 - lat) * D, t = (lng + 180) * D
  return new THREE.Vector3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t))
}

// Stitch NASA Trek tiles into one texture; stays rust-coloured if the tiles can't load
function marsTexture() {
  const Z = 2, cols = 8, rows = 4
  const c = document.createElement('canvas')
  c.width = cols * 256; c.height = rows * 256
  const g = c.getContext('2d')
  g.fillStyle = '#a4563a'; g.fillRect(0, 0, c.width, c.height)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => { g.drawImage(im, x * 256, y * 256); tex.needsUpdate = true }
    im.src = `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${Z}/${y}/${x}.jpg`
  }
  return tex
}

export default function MarsGlobe({ interactive = false, spin = 0.002, markers = [], focus = null, onPick }) {
  const host = useRef(null)
  const s = useRef({})
  const pick = useRef(onPick)
  pick.current = onPick

  useEffect(() => {
    const el = host.current
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(r.domElement)
    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    cam.position.z = 3.2
    const globe = new THREE.Group()
    const mars = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshBasicMaterial({ map: marsTexture() }))
    globe.add(mars)
    const pins = new THREE.Group()
    globe.add(pins)
    scene.add(globe)
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 48), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 n;void main(){float i=pow(max(.75-dot(n,vec3(0.,0.,1.)),0.),2.8);gl_FragColor=vec4(0.92,.42,.22,1.)*i*1.8;}',
    })))
    const sp = new Float32Array(1800)
    for (let i = 0; i < 1800; i += 3) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(32)
      sp.set([v.x, v.y, v.z], i)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.06, transparent: true, opacity: 0.6 })))

    const size = () => {
      r.setSize(el.clientWidth, el.clientHeight)
      cam.aspect = el.clientWidth / el.clientHeight
      cam.updateProjectionMatrix()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)

    let down = null, moved = 0, raf
    const dom = r.domElement
    if (interactive) {
      dom.style.cursor = 'grab'
      dom.onpointerdown = (e) => { down = [e.clientX, e.clientY]; moved = 0; s.current.target = null }
      dom.onpointermove = (e) => {
        if (!down) return
        const dx = e.clientX - down[0], dy = e.clientY - down[1]
        moved += Math.abs(dx) + Math.abs(dy)
        globe.rotation.y += dx * 0.006
        globe.rotation.x = Math.max(-1.3, Math.min(1.3, globe.rotation.x + dy * 0.006))
        down = [e.clientX, e.clientY]
      }
      dom.onpointerup = (e) => {
        down = null
        if (moved > 5 || !pick.current) return
        const b = dom.getBoundingClientRect()
        const ray = new THREE.Raycaster()
        ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), cam)
        const hit = ray.intersectObject(mars)[0]
        if (!hit) return
        const p = globe.worldToLocal(hit.point.clone()).normalize()
        let lng = Math.atan2(p.z, -p.x) / D - 180
        if (lng < -180) lng += 360
        pick.current(Math.asin(p.y) / D, lng)
      }
    }
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const t = s.current.target
      if (t) {
        globe.rotation.x += (t.x - globe.rotation.x) * 0.06
        globe.rotation.y += (t.y - globe.rotation.y) * 0.06
      } else if (!down) globe.rotation.y += spin
      r.render(scene, cam)
    }
    loop()
    s.current.pins = pins
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); r.dispose(); el.removeChild(dom)
    }
  }, [interactive, spin])

  useEffect(() => {
    const pins = s.current.pins
    if (!pins) return
    pins.clear()
    markers.forEach((m) => {
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }))
      pin.position.copy(toVec(m.lat, m.lng, 1.01))
      pins.add(pin)
    })
  }, [markers])

  useEffect(() => {
    if (!focus) return
    const v = toVec(focus[0], focus[1])
    s.current.target = { x: focus[0] * D, y: -Math.atan2(v.x, v.z) }
  }, [focus])

  return <div ref={host} className="globe-host" />
}
