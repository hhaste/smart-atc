let canvas
let ctx
let refreshButton
let statusBadge
let flightCount
let feedMode
let lastUpdated
let sectorName
let airportList
let flightList
let feedNote
let hudPanel
let collapseButton
let hoverDetailsToggle
let hoverCard
let listeners = []
let animationFrameId = 0
let disposed = false

const WORLD_UP = { x: 0, y: 1, z: 0 }
const EARTH_RADIUS_M = 6371000
const FOV = Math.PI / 3.15
const NEAR_PLANE = 0.1
const MAP_HALF_SIZE = 220
const MAX_TRAIL_POINTS = 6
const SETTINGS_STORAGE_KEY = "michigan-thumb-traffic-settings"
const DEFAULT_REGION = {
  name: "Michigan Thumb Sector",
  center_lat: 42.58895,
  center_lon: -83.37765,
  side_m: 113740.89925601677,
  bbox: {
    lamin: 42.077501759112195,
    lamax: 43.100398240887806,
    lomin: -84.07168277464358,
    lomax: -82.68361722535641
  }
}
const DEFAULT_AIRPORTS = [
  {
    code: "KDET",
    name: "Coleman A. Young Municipal",
    lat: 42.4124,
    lon: -83.0106
  },
  {
    code: "KDTW",
    name: "Detroit Metropolitan Wayne County",
    lat: 42.2124,
    lon: -83.3534
  },
  {
    code: "KFNT",
    name: "Bishop International",
    lat: 42.9655,
    lon: -83.7447
  }
]

const camera = {
  target: { x: 0, y: 28, z: 0 },
  distance: 540,
  yaw: 0.74,
  pitch: 0.92,
  minDistance: 180,
  maxDistance: 1300
}

function loadSettings() {
  const defaults = {
    showHoverDetails: true,
    hudCollapsed: false
  }

  if (typeof window === "undefined") {
    return defaults
  }

  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!rawValue) {
      return defaults
    }

    return {
      ...defaults,
      ...JSON.parse(rawValue)
    }
  } catch {
    return defaults
  }
}

const state = {
  width: 0,
  height: 0,
  region: DEFAULT_REGION,
  airports: DEFAULT_AIRPORTS,
  runways: [],
  flights: [],
  trails: new Map(),
  headingCache: new Map(),
  loading: false,
  lastUpdatedMs: null,
  lastOpenSkyTime: null,
  refreshIntervalMs: 30000,
  refreshTimer: null,
  feedNoteText: "Waiting for the first live traffic snapshot.",
  sourceModeText: "Waiting",
  settings: loadSettings(),
  mouseMode: null,
  lastMouseX: 0,
  lastMouseY: 0,
  touchMode: null,
  lastTouchX: 0,
  lastTouchY: 0,
  lastTouchCenterX: 0,
  lastTouchCenterY: 0,
  lastTouchDistance: 0,
  pointerInsideCanvas: false,
  pointerX: 0,
  pointerY: 0,
  hoveredFlightIcao: null
}

function resetRuntimeState() {
  Object.assign(camera, {
    target: { x: 0, y: 28, z: 0 },
    distance: 540,
    yaw: 0.74,
    pitch: 0.92,
    minDistance: 180,
    maxDistance: 1300
  })

  state.width = 0
  state.height = 0
  state.region = DEFAULT_REGION
  state.airports = DEFAULT_AIRPORTS
  state.runways = []
  state.flights = []
  state.trails = new Map()
  state.headingCache = new Map()
  state.loading = false
  state.lastUpdatedMs = null
  state.lastOpenSkyTime = null
  state.refreshIntervalMs = 30000
  state.refreshTimer = null
  state.feedNoteText = "Waiting for the first live traffic snapshot."
  state.sourceModeText = "Waiting"
  state.settings = loadSettings()
  state.mouseMode = null
  state.lastMouseX = 0
  state.lastMouseY = 0
  state.touchMode = null
  state.lastTouchX = 0
  state.lastTouchY = 0
  state.lastTouchCenterX = 0
  state.lastTouchCenterY = 0
  state.lastTouchDistance = 0
  state.pointerInsideCanvas = false
  state.pointerX = 0
  state.pointerY = 0
  state.hoveredFlightIcao = null
}

function addManagedListener(target, type, handler, options) {
  target.addEventListener(type, handler, options)
  listeners.push(() => {
    target.removeEventListener(type, handler, options)
  })
}

function cleanupFlightViewer() {
  disposed = true

  if (state.refreshTimer) {
    window.clearTimeout(state.refreshTimer)
    state.refreshTimer = null
  }

  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
  }

  while (listeners.length) {
    const removeListener = listeners.pop()
    removeListener()
  }

  if (canvas) {
    canvas.classList.remove("dragging")
  }

  if (hoverCard) {
    hoverCard.classList.add("hidden")
    hoverCard.setAttribute("aria-hidden", "true")
  }

  canvas = null
  ctx = null
  refreshButton = null
  statusBadge = null
  flightCount = null
  feedMode = null
  lastUpdated = null
  sectorName = null
  airportList = null
  flightList = null
  feedNote = null
  hudPanel = null
  collapseButton = null
  hoverDetailsToggle = null
  hoverCard = null
}

export function mountFlightViewer(elements) {
  cleanupFlightViewer()

  canvas = elements.canvas
  refreshButton = elements.refreshButton
  statusBadge = elements.statusBadge
  flightCount = elements.flightCount
  feedMode = elements.feedMode
  lastUpdated = elements.lastUpdated
  sectorName = elements.sectorName
  airportList = elements.airportList
  flightList = elements.flightList
  feedNote = elements.feedNote
  hudPanel = elements.hudPanel
  collapseButton = elements.collapseButton
  hoverDetailsToggle = elements.hoverDetailsToggle
  hoverCard = elements.hoverCard

  if (
    !canvas ||
    !refreshButton ||
    !statusBadge ||
    !flightCount ||
    !feedMode ||
    !lastUpdated ||
    !sectorName ||
    !airportList ||
    !flightList ||
    !feedNote ||
    !hudPanel ||
    !collapseButton ||
    !hoverDetailsToggle ||
    !hoverCard
  ) {
    return () => {}
  }

  ctx = canvas.getContext("2d")
  if (!ctx) {
    return () => {}
  }

  listeners = []
  animationFrameId = 0
  disposed = false
  resetRuntimeState()
  init()

  return cleanupFlightViewer
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalize(vector) {
  const vectorLength = length(vector)
  if (!vectorLength) {
    return { x: 0, y: 0, z: 0 }
  }

  return scale(vector, 1 / vectorLength)
}

function saveSettings() {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify(state.settings)
    )
  } catch {
    // Ignore storage failures so the viewer still works in locked-down browsers.
  }
}

function createAircraftModel() {
  const vertices = []
  const faces = []

  function addVertex(vertex) {
    vertices.push(vertex)
    return vertices.length - 1
  }

  function pushBox(center, size, tone) {
    const hx = size.x * 0.5
    const hy = size.y * 0.5
    const hz = size.z * 0.5
    const start = vertices.length

    addVertex({ x: center.x - hx, y: center.y - hy, z: center.z - hz })
    addVertex({ x: center.x + hx, y: center.y - hy, z: center.z - hz })
    addVertex({ x: center.x + hx, y: center.y + hy, z: center.z - hz })
    addVertex({ x: center.x - hx, y: center.y + hy, z: center.z - hz })
    addVertex({ x: center.x - hx, y: center.y - hy, z: center.z + hz })
    addVertex({ x: center.x + hx, y: center.y - hy, z: center.z + hz })
    addVertex({ x: center.x + hx, y: center.y + hy, z: center.z + hz })
    addVertex({ x: center.x - hx, y: center.y + hy, z: center.z + hz })

    faces.push(
      { indices: [start + 0, start + 3, start + 2, start + 1], tone },
      { indices: [start + 4, start + 5, start + 6, start + 7], tone: tone * 0.96 },
      { indices: [start + 0, start + 4, start + 7, start + 3], tone: tone * 0.9 },
      { indices: [start + 1, start + 2, start + 6, start + 5], tone: tone * 0.9 },
      { indices: [start + 3, start + 7, start + 6, start + 2], tone: tone * 1.04 },
      { indices: [start + 0, start + 1, start + 5, start + 4], tone: tone * 0.82 }
    )
  }

  function pushPyramid(baseCenter, baseSize, tip, tone) {
    const hx = baseSize.x * 0.5
    const hy = baseSize.y * 0.5
    const start = vertices.length

    addVertex({ x: baseCenter.x - hx, y: baseCenter.y - hy, z: baseCenter.z })
    addVertex({ x: baseCenter.x + hx, y: baseCenter.y - hy, z: baseCenter.z })
    addVertex({ x: baseCenter.x + hx, y: baseCenter.y + hy, z: baseCenter.z })
    addVertex({ x: baseCenter.x - hx, y: baseCenter.y + hy, z: baseCenter.z })
    addVertex(tip)

    faces.push(
      { indices: [start + 0, start + 3, start + 4], tone: tone * 0.95 },
      { indices: [start + 3, start + 2, start + 4], tone: tone * 1.06 },
      { indices: [start + 2, start + 1, start + 4], tone: tone * 0.95 },
      { indices: [start + 1, start + 0, start + 4], tone: tone * 0.84 }
    )
  }

  pushBox({ x: 0, y: 0, z: 0 }, { x: 0.42, y: 0.34, z: 3 }, 1)
  pushPyramid({ x: 0, y: 0, z: -1.5 }, { x: 0.42, y: 0.34 }, { x: 0, y: 0, z: -2.4 }, 1.08)
  pushPyramid({ x: 0, y: 0.02, z: 1.5 }, { x: 0.34, y: 0.28 }, { x: 0, y: 0.02, z: 2.25 }, 0.94)
  pushBox({ x: 0, y: 0, z: -0.08 }, { x: 3.3, y: 0.08, z: 0.8 }, 0.97)
  pushBox({ x: 0, y: 0.06, z: 1.58 }, { x: 1.24, y: 0.06, z: 0.38 }, 0.9)
  pushBox({ x: 0, y: 0.47, z: 1.45 }, { x: 0.08, y: 0.9, z: 0.42 }, 0.88)

  return { vertices, faces }
}

const AIRCRAFT_MODEL = createAircraftModel()
const AIRCRAFT_LIGHT_DIR = normalize({ x: -0.46, y: 0.84, z: -0.29 })

function getMapScale() {
  return MAP_HALF_SIZE / (state.region.side_m * 0.5)
}

function altitudeToWorld(meters, onGround) {
  if (onGround) {
    return 2
  }

  return clamp(meters * getMapScale() * 1.05, 4, 180)
}

function latLonToWorld(lat, lon) {
  const latRad = (state.region.center_lat * Math.PI) / 180
  const eastMeters =
    ((lon - state.region.center_lon) * Math.PI * EARTH_RADIUS_M * Math.cos(latRad)) /
    180
  const northMeters =
    ((lat - state.region.center_lat) * Math.PI * EARTH_RADIUS_M) / 180
  const scaleFactor = getMapScale()

  return {
    x: eastMeters * scaleFactor,
    z: -northMeters * scaleFactor
  }
}

function getCameraBasis() {
  const cosPitch = Math.cos(camera.pitch)
  const position = {
    x: camera.target.x + Math.sin(camera.yaw) * cosPitch * camera.distance,
    y: camera.target.y + Math.sin(camera.pitch) * camera.distance,
    z: camera.target.z + Math.cos(camera.yaw) * cosPitch * camera.distance
  }

  const forward = normalize(subtract(camera.target, position))
  let right = normalize(cross(forward, WORLD_UP))

  if (!length(right)) {
    right = { x: 1, y: 0, z: 0 }
  }

  const up = normalize(cross(right, forward))

  return { position, forward, right, up }
}

function worldToCamera(point, basis) {
  const relative = subtract(point, basis.position)
  return {
    x: dot(relative, basis.right),
    y: dot(relative, basis.up),
    z: dot(relative, basis.forward)
  }
}

function projectPoint(cameraPoint) {
  const focalLength = Math.min(state.width, state.height) * 0.92
  return {
    x: state.width * 0.5 + (cameraPoint.x / cameraPoint.z) * focalLength,
    y: state.height * 0.5 - (cameraPoint.y / cameraPoint.z) * focalLength,
    scale: focalLength / cameraPoint.z
  }
}

function projectWorldPoint(worldPoint, basis) {
  const cameraPoint = worldToCamera(worldPoint, basis)
  if (cameraPoint.z < NEAR_PLANE) {
    return null
  }

  return projectPoint(cameraPoint)
}

function clipLineToNearPlane(start, end) {
  if (start.z < NEAR_PLANE && end.z < NEAR_PLANE) {
    return null
  }

  if (start.z >= NEAR_PLANE && end.z >= NEAR_PLANE) {
    return [start, end]
  }

  const t = (NEAR_PLANE - start.z) / (end.z - start.z)
  const intersection = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: NEAR_PLANE
  }

  return start.z < NEAR_PLANE ? [intersection, end] : [start, intersection]
}

function drawWorldLine(a, b, color, width, alpha, dash = [], basis = getCameraBasis()) {
  const start = worldToCamera(a, basis)
  const end = worldToCamera(b, basis)
  const clipped = clipLineToNearPlane(start, end)

  if (!clipped) {
    return
  }

  const projectedStart = projectPoint(clipped[0])
  const projectedEnd = projectPoint(clipped[1])
  const depth = (clipped[0].z + clipped[1].z) * 0.5
  const fade = clamp(1 - depth / 1200, 0.16, 1)

  ctx.save()
  ctx.globalAlpha = alpha * fade
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(projectedStart.x, projectedStart.y)
  ctx.lineTo(projectedEnd.x, projectedEnd.y)
  ctx.stroke()
  ctx.restore()
}

function drawFilledWorldPolygon(points, fillStyle, alpha, basis) {
  const projected = []

  for (const point of points) {
    const cameraPoint = worldToCamera(point, basis)
    if (cameraPoint.z < NEAR_PLANE) {
      return
    }
    projected.push(projectPoint(cameraPoint))
  }

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = fillStyle
  ctx.beginPath()
  ctx.moveTo(projected[0].x, projected[0].y)

  for (let index = 1; index < projected.length; index += 1) {
    ctx.lineTo(projected[index].x, projected[index].y)
  }

  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function panCamera(pixelDx, pixelDy) {
  const basis = getCameraBasis()
  const worldUnitsPerPixel = (2 * camera.distance * Math.tan(FOV / 2)) / state.height
  const groundRight = normalize({ x: basis.right.x, y: 0, z: basis.right.z })
  const groundForward = normalize({ x: basis.forward.x, y: 0, z: basis.forward.z })
  const moveRight = scale(groundRight, -pixelDx * worldUnitsPerPixel)
  const moveForward = scale(groundForward, pixelDy * worldUnitsPerPixel)

  camera.target = {
    x: camera.target.x + moveRight.x + moveForward.x,
    y: camera.target.y,
    z: camera.target.z + moveRight.z + moveForward.z
  }
}

function rotateCamera(pixelDx, pixelDy) {
  camera.yaw -= pixelDx * 0.008
  camera.pitch = clamp(camera.pitch + pixelDy * 0.006, 0.18, 1.35)
}

function zoomCamera(delta) {
  const zoomFactor = Math.exp(delta * 0.00115)
  camera.distance = clamp(
    camera.distance * zoomFactor,
    camera.minDistance,
    camera.maxDistance
  )
}

function formatLatLon(lat, lon) {
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`
}

function formatAltitudeFeet(meters, onGround) {
  if (onGround) {
    return "Ground"
  }

  return `${Math.round(meters * 3.28084).toLocaleString()} ft`
}

function formatSpeedKnots(metersPerSecond) {
  if (metersPerSecond == null) {
    return "Speed n/a"
  }

  return `${Math.round(metersPerSecond * 1.94384)} kt`
}

function formatTrackDegrees(trackDegrees) {
  if (trackDegrees == null) {
    return "Track n/a"
  }

  return `${Math.round(trackDegrees)}°`
}

function formatAge(seconds) {
  if (seconds == null) {
    return "Age n/a"
  }

  return `${Math.max(0, Math.round(seconds))}s ago`
}

function formatUpdateTime(timestampMs) {
  if (!timestampMs) {
    return "Waiting"
  }

  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  })
}

function formatAircraftType(flight) {
  const typeName = flight.aircraft_type_name?.trim()
  const typeCode = flight.aircraft_type_code?.trim()

  if (typeName && typeCode && !typeName.includes(typeCode)) {
    return `${typeName} (${typeCode})`
  }

  return typeName || typeCode || "Type unavailable"
}

function formatAircraftClass(flight) {
  return flight.category_label || flight.type_label || "Category unavailable"
}

function formatRegistration(flight) {
  return flight.registration || "Registration unavailable"
}

function setHoverCardVisible(visible) {
  hoverCard.classList.toggle("hidden", !visible)
  hoverCard.setAttribute("aria-hidden", String(!visible))
}

function isPointInsideElement(element, x, y) {
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function setHoveredFlight(icao24) {
  state.hoveredFlightIcao = icao24
}

function clearHoveredFlight() {
  state.hoveredFlightIcao = null
  setHoverCardVisible(false)
}

function updateHudCollapse() {
  hudPanel.classList.toggle("collapsed", state.settings.hudCollapsed)
  collapseButton.textContent = state.settings.hudCollapsed ? "Expand" : "Collapse"
  collapseButton.setAttribute("aria-expanded", String(!state.settings.hudCollapsed))
}

function updateSettingsControls() {
  hoverDetailsToggle.checked = state.settings.showHoverDetails
  updateHudCollapse()
}

function createHoverField(labelText, valueText) {
  const wrapper = document.createElement("div")
  const label = document.createElement("span")
  const value = document.createElement("span")

  label.className = "hover-label"
  label.textContent = labelText
  value.className = "hover-value"
  value.textContent = valueText

  wrapper.appendChild(label)
  wrapper.appendChild(value)
  return wrapper
}

function renderHoverCard(flight, projected) {
  if (!state.settings.showHoverDetails || state.mouseMode) {
    setHoverCardVisible(false)
    return
  }

  hoverCard.replaceChildren()

  const title = document.createElement("div")
  const subtitle = document.createElement("div")
  const grid = document.createElement("div")

  title.className = "hover-title"
  subtitle.className = "hover-subtitle"
  grid.className = "hover-grid"

  title.textContent = flight.callsign || flight.icao24.toUpperCase()
  subtitle.textContent = `${flight.code_display} · ${formatAircraftType(flight)}`

  grid.appendChild(createHoverField("Speed", formatSpeedKnots(flight.velocity_mps)))
  grid.appendChild(createHoverField("Altitude", formatAltitudeFeet(flight.altitude_m, flight.on_ground)))
  grid.appendChild(createHoverField("Track", formatTrackDegrees(flight.display_heading_deg)))
  grid.appendChild(createHoverField("Type", formatAircraftType(flight)))
  grid.appendChild(createHoverField("Registration", formatRegistration(flight)))
  grid.appendChild(createHoverField("Class", formatAircraftClass(flight)))

  hoverCard.appendChild(title)
  hoverCard.appendChild(subtitle)
  hoverCard.appendChild(grid)

  const maxLeft = window.innerWidth - 296
  const maxTop = window.innerHeight - 160
  const left = clamp(projected.x + 18, 12, Math.max(12, maxLeft))
  const top = clamp(projected.y + 18, 12, Math.max(12, maxTop))
  hoverCard.style.left = `${left}px`
  hoverCard.style.top = `${top}px`
  setHoverCardVisible(true)
}

function setStatus(text, tone) {
  statusBadge.textContent = text
  statusBadge.className = `status-badge status-${tone}`
}

function updateAirportList() {
  airportList.innerHTML = ""

  state.airports.forEach((airport) => {
    const item = document.createElement("li")
    const title = document.createElement("span")
    const meta = document.createElement("span")

    title.className = "airport-code"
    title.textContent = `${airport.code} · ${airport.name}`
    meta.className = "airport-meta"
    meta.textContent = formatLatLon(airport.lat, airport.lon)

    item.appendChild(title)
    item.appendChild(meta)
    airportList.appendChild(item)
  })
}

function updateFlightList() {
  flightList.innerHTML = ""

  if (!state.flights.length) {
    const empty = document.createElement("li")
    empty.className = "flight-meta"
    empty.textContent = "No aircraft in the sector right now."
    flightList.appendChild(empty)
    return
  }

  const displayedFlights = [...state.flights]
    .sort((left, right) => {
      if (left.on_ground !== right.on_ground) {
        return Number(left.on_ground) - Number(right.on_ground)
      }

      return right.altitude_m - left.altitude_m
    })
    .slice(0, 12)

  displayedFlights.forEach((flight) => {
    const item = document.createElement("li")
    const header = document.createElement("div")
    const id = document.createElement("span")
    const altitude = document.createElement("span")
    const meta = document.createElement("span")

    header.className = "flight-header"
    id.className = "flight-id"
    altitude.className = "flight-altitude"
    meta.className = "flight-meta"

    id.textContent = flight.callsign || flight.icao24.toUpperCase()
    altitude.textContent = formatAltitudeFeet(flight.altitude_m, flight.on_ground)
    meta.textContent = `${flight.code_display} · ${formatSpeedKnots(flight.velocity_mps)} · ${formatAge(flight.age_s)}`

    header.appendChild(id)
    header.appendChild(altitude)
    item.appendChild(header)
    item.appendChild(meta)
    flightList.appendChild(item)
  })
}

function updateHud() {
  flightCount.textContent = state.flights.length.toString()
  feedMode.textContent = state.sourceModeText
  lastUpdated.textContent = formatUpdateTime(state.lastUpdatedMs)
  sectorName.textContent = state.region.name
  feedNote.textContent = state.feedNoteText
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight

  state.width = width
  state.height = height
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, state.height)
  gradient.addColorStop(0, "#04111a")
  gradient.addColorStop(0.48, "#0b1d2d")
  gradient.addColorStop(1, "#13324b")
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, state.width, state.height)

  const glow = ctx.createRadialGradient(
    state.width * 0.72,
    state.height * 0.14,
    20,
    state.width * 0.72,
    state.height * 0.14,
    state.height * 0.82
  )
  glow.addColorStop(0, "rgba(113, 213, 255, 0.16)")
  glow.addColorStop(1, "rgba(113, 213, 255, 0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, state.width, state.height)
}

function drawSectorPlane(basis) {
  const half = MAP_HALF_SIZE
  const corners = [
    { x: -half, y: 0, z: -half },
    { x: half, y: 0, z: -half },
    { x: half, y: 0, z: half },
    { x: -half, y: 0, z: half }
  ]

  drawFilledWorldPolygon(corners, "rgba(12, 40, 48, 0.82)", 1, basis)

  for (let index = 0; index <= 8; index += 1) {
    const fraction = index / 8
    const offset = -half + fraction * half * 2
    const isCenter = index === 4
    const lineColor = isCenter
      ? "rgba(163, 231, 255, 0.24)"
      : "rgba(110, 175, 190, 0.15)"

    drawWorldLine(
      { x: offset, y: 0, z: -half },
      { x: offset, y: 0, z: half },
      lineColor,
      isCenter ? 1.7 : 1,
      1,
      [],
      basis
    )
    drawWorldLine(
      { x: -half, y: 0, z: offset },
      { x: half, y: 0, z: offset },
      lineColor,
      isCenter ? 1.7 : 1,
      1,
      [],
      basis
    )
  }

  const border = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]]
  ]

  border.forEach(([from, to]) => {
    drawWorldLine(from, to, "#7ae9ff", 2.1, 0.95, [], basis)
  })

  const airportWorlds = state.airports.map((airport) => latLonToWorld(airport.lat, airport.lon))

  if (airportWorlds.length === 3) {
    drawWorldLine(
      { x: airportWorlds[0].x, y: 0, z: airportWorlds[0].z },
      { x: airportWorlds[1].x, y: 0, z: airportWorlds[1].z },
      "rgba(125, 255, 179, 0.55)",
      1.2,
      0.75,
      [10, 8],
      basis
    )
    drawWorldLine(
      { x: airportWorlds[1].x, y: 0, z: airportWorlds[1].z },
      { x: airportWorlds[2].x, y: 0, z: airportWorlds[2].z },
      "rgba(125, 255, 179, 0.55)",
      1.2,
      0.75,
      [10, 8],
      basis
    )
    drawWorldLine(
      { x: airportWorlds[2].x, y: 0, z: airportWorlds[2].z },
      { x: airportWorlds[0].x, y: 0, z: airportWorlds[0].z },
      "rgba(125, 255, 179, 0.55)",
      1.2,
      0.75,
      [10, 8],
      basis
    )
  }
}

function drawAirport(airport, basis) {
  const world = latLonToWorld(airport.lat, airport.lon)
  const anchor = { x: world.x, y: 0, z: world.z }

  drawWorldLine(
    { x: world.x - 5, y: 0, z: world.z },
    { x: world.x + 5, y: 0, z: world.z },
    "#ffcf72",
    2,
    0.98,
    [],
    basis
  )
  drawWorldLine(
    { x: world.x, y: 0, z: world.z - 5 },
    { x: world.x, y: 0, z: world.z + 5 },
    "#ffcf72",
    2,
    0.98,
    [],
    basis
  )
  drawWorldLine(anchor, { x: world.x, y: 10, z: world.z }, "#ffcf72", 1.3, 0.6, [], basis)

  const projected = projectWorldPoint({ x: world.x, y: 10, z: world.z }, basis)
  if (!projected) {
    return
  }
  ctx.save()
  ctx.fillStyle = "#ffe6ae"
  ctx.font = "600 13px 'Trebuchet MS', sans-serif"
  ctx.fillText(airport.code, projected.x + 8, projected.y - 8)
  ctx.restore()
}

function runwaySurfaceStyle(runway) {
  if (runway.condition === "CLOSED") {
    return {
      fill: "rgba(80, 54, 54, 0.95)",
      edge: "rgba(214, 144, 144, 0.96)",
      glow: "rgba(130, 70, 70, 0.5)"
    }
  }

  if (runway.surface === "CONC") {
    return {
      fill: "rgba(96, 102, 108, 0.92)",
      edge: "rgba(244, 248, 251, 0.96)",
      glow: "rgba(196, 214, 225, 0.42)"
    }
  }

  return {
    fill: "rgba(67, 72, 79, 0.94)",
    edge: "rgba(236, 242, 247, 0.92)",
    glow: "rgba(184, 198, 210, 0.34)"
  }
}

function drawRunwayLabel(runwayEnd, oppositeEnd, basis, placedLabels) {
  const start = latLonToWorld(runwayEnd.lat, runwayEnd.lon)
  const opposite = latLonToWorld(oppositeEnd.lat, oppositeEnd.lon)
  const direction = normalize({
    x: start.x - opposite.x,
    y: 0,
    z: start.z - opposite.z
  })
  const labelWorld = {
    x: start.x + direction.x * 9,
    y: 1.3,
    z: start.z + direction.z * 9
  }
  const projected = projectWorldPoint(labelWorld, basis)

  if (!projected) {
    return
  }

  const tooClose = placedLabels.some(
    (label) => Math.hypot(projected.x - label.x, projected.y - label.y) < 34
  )
  if (tooClose) {
    return
  }

  placedLabels.push({ x: projected.x, y: projected.y })
  ctx.save()
  ctx.fillStyle = "#f4f8fb"
  ctx.font = "700 11px 'Trebuchet MS', sans-serif"
  ctx.fillText(runwayEnd.ident, projected.x + 3, projected.y - 3)
  ctx.restore()
}

function drawRunway(runway, basis, placedLabels) {
  const polygon = runway.polygon.map(([lon, lat]) => {
    const horizontal = latLonToWorld(lat, lon)
    return { x: horizontal.x, y: 0.6, z: horizontal.z }
  })
  const style = runwaySurfaceStyle(runway)

  drawFilledWorldPolygon(polygon, style.fill, 1, basis)

  for (let index = 1; index < polygon.length; index += 1) {
    drawWorldLine(polygon[index - 1], polygon[index], style.glow, 4.4, 0.42, [], basis)
    drawWorldLine(polygon[index - 1], polygon[index], style.edge, 2.35, 0.96, [], basis)
  }

  const thresholdA = latLonToWorld(runway.end_a.lat, runway.end_a.lon)
  const thresholdB = latLonToWorld(runway.end_b.lat, runway.end_b.lon)
  const centerlineA = { x: thresholdA.x, y: 0.72, z: thresholdA.z }
  const centerlineB = { x: thresholdB.x, y: 0.72, z: thresholdB.z }

  drawWorldLine(
    centerlineA,
    centerlineB,
    "rgba(245, 247, 249, 0.95)",
    1.8,
    0.96,
    [10, 8],
    basis
  )

  drawRunwayLabel(runway.end_a, runway.end_b, basis, placedLabels)
  drawRunwayLabel(runway.end_b, runway.end_a, basis, placedLabels)
}

function drawTrail(flight, basis) {
  if (!flight.trail || flight.trail.length < 2) {
    return
  }

  for (let index = 1; index < flight.trail.length; index += 1) {
    const previous = flight.trail[index - 1]
    const current = flight.trail[index]
    const alpha = 0.16 + (index / flight.trail.length) * 0.44
    drawWorldLine(previous, current, "rgba(85, 214, 255, 0.82)", 1, alpha, [], basis)
  }
}

function getProjectedFlightMarker(flight, basis) {
  const cameraPoint = worldToCamera(flight.world, basis)
  if (cameraPoint.z < NEAR_PLANE) {
    return null
  }

  const projected = projectPoint(cameraPoint)
  return {
    projected,
    radius: clamp(projected.scale * 16, 10, 28)
  }
}

function rotateAroundX(point, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)

  return {
    x: point.x,
    y: point.y * cosine - point.z * sine,
    z: point.y * sine + point.z * cosine
  }
}

function rotateAroundY(point, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)

  return {
    x: point.x * cosine - point.z * sine,
    y: point.y,
    z: point.x * sine + point.z * cosine
  }
}

function averagePoints(points) {
  const total = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + point.z
    }),
    { x: 0, y: 0, z: 0 }
  )

  return scale(total, 1 / points.length)
}

function shadeAircraftColor(base, tone, light, alpha) {
  const lightFactor = 0.56 + Math.max(light, -0.2) * 0.34
  const factor = clamp(tone * lightFactor, 0.3, 1.2)

  return `rgba(${Math.round(base.r * factor)}, ${Math.round(base.g * factor)}, ${Math.round(base.b * factor)}, ${alpha})`
}

function getAircraftPalette(flight) {
  if (flight.on_ground) {
    return {
      base: { r: 255, g: 207, b: 114 },
      outline: "rgba(255, 243, 212, 0.55)"
    }
  }

  return {
    base: { r: 85, g: 214, b: 255 },
    outline: "rgba(231, 247, 255, 0.48)"
  }
}

function buildAircraftFaces(flight, basis) {
  const headingRadians = ((flight.display_heading_deg ?? 0) * Math.PI) / 180
  const pitchRadians = clamp((flight.vertical_rate_mps ?? 0) * 0.015, -0.2, 0.2)
  const palette = getAircraftPalette(flight)
  const modelScale = flight.on_ground ? 1.15 : 1.35

  const worldVertices = AIRCRAFT_MODEL.vertices.map((vertex) => {
    const scaled = scale(vertex, modelScale)
    const pitched = rotateAroundX(scaled, pitchRadians)
    const rotated = rotateAroundY(pitched, headingRadians)
    return add(flight.world, rotated)
  })

  const renderedFaces = []

  AIRCRAFT_MODEL.faces.forEach((face) => {
    const faceWorldPoints = face.indices.map((index) => worldVertices[index])
    const cameraPoints = faceWorldPoints.map((point) => worldToCamera(point, basis))

    if (cameraPoints.some((point) => point.z < NEAR_PLANE)) {
      return
    }

    const faceCenter = averagePoints(faceWorldPoints)
    const faceNormal = normalize(
      cross(
        subtract(faceWorldPoints[1], faceWorldPoints[0]),
        subtract(faceWorldPoints[2], faceWorldPoints[0])
      )
    )
    const toCamera = normalize(subtract(basis.position, faceCenter))

    if (dot(faceNormal, toCamera) <= 0) {
      return
    }

    renderedFaces.push({
      depth: averagePoints(cameraPoints).z,
      projected: cameraPoints.map(projectPoint),
      fill: shadeAircraftColor(
        palette.base,
        face.tone,
        dot(faceNormal, AIRCRAFT_LIGHT_DIR),
        flight.on_ground ? 0.92 : 0.95
      ),
      stroke: palette.outline
    })
  })

  renderedFaces.sort((left, right) => right.depth - left.depth)
  return renderedFaces
}

function drawProjectedFace(face) {
  ctx.save()
  ctx.fillStyle = face.fill
  ctx.strokeStyle = face.stroke
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(face.projected[0].x, face.projected[0].y)

  for (let index = 1; index < face.projected.length; index += 1) {
    ctx.lineTo(face.projected[index].x, face.projected[index].y)
  }

  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function normalizeHeadingDegrees(angle) {
  return ((angle % 360) + 360) % 360
}

function headingFromTrail(trail) {
  if (!trail || trail.length < 2) {
    return null
  }

  const previous = trail[trail.length - 2]
  const current = trail[trail.length - 1]
  const dx = current.x - previous.x
  const dz = current.z - previous.z

  if (Math.hypot(dx, dz) < 0.001) {
    return null
  }

  return normalizeHeadingDegrees((Math.atan2(dx, -dz) * 180) / Math.PI)
}

function getDisplayHeading(flight) {
  if (flight.track_deg != null) {
    const heading = normalizeHeadingDegrees(flight.track_deg)
    state.headingCache.set(flight.icao24, heading)
    return heading
  }

  const trailHeading = headingFromTrail(flight.trail)
  if (trailHeading != null) {
    state.headingCache.set(flight.icao24, trailHeading)
    return trailHeading
  }

  return state.headingCache.get(flight.icao24) ?? 0
}

function drawFlight(flight, basis, showLabel) {
  drawTrail(flight, basis)

  drawWorldLine(
    { x: flight.world.x, y: 0, z: flight.world.z },
    flight.world,
    flight.on_ground ? "#ffcf72" : "#55d6ff",
    1.2,
    flight.on_ground ? 0.55 : 0.7,
    flight.on_ground ? [4, 5] : [7, 6],
    basis
  )

  const marker = getProjectedFlightMarker(flight, basis)
  if (!marker) {
    return
  }

  const projected = marker.projected
  const modelFaces = buildAircraftFaces(flight, basis)

  modelFaces.forEach(drawProjectedFace)

  if (showLabel) {
    ctx.fillStyle = "#eff7fb"
    ctx.font = "600 12px 'Trebuchet MS', sans-serif"
    ctx.fillText(
      flight.callsign || flight.icao24.toUpperCase(),
      projected.x + 14,
      projected.y - 12
    )
  }
}

function updateHoveredFlightFromPointer(basis) {
  if (
    !state.pointerInsideCanvas ||
    !state.settings.showHoverDetails ||
    state.mouseMode ||
    isPointInsideElement(hudPanel, state.pointerX, state.pointerY)
  ) {
    clearHoveredFlight()
    return
  }

  let bestMatch = null

  state.flights.forEach((flight) => {
    const marker = getProjectedFlightMarker(flight, basis)
    if (!marker) {
      return
    }

    const distance = Math.hypot(
      state.pointerX - marker.projected.x,
      state.pointerY - marker.projected.y
    )

    if (distance > marker.radius) {
      return
    }

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = {
        flight,
        projected: marker.projected,
        distance
      }
    }
  })

  if (!bestMatch) {
    clearHoveredFlight()
    return
  }

  setHoveredFlight(bestMatch.flight.icao24)
  renderHoverCard(bestMatch.flight, bestMatch.projected)
}

function drawOverlayLegend() {
  ctx.save()
  ctx.fillStyle = "rgba(5, 16, 24, 0.55)"
  ctx.fillRect(state.width - 166, state.height - 92, 142, 62)
  ctx.fillStyle = "#eff7fb"
  ctx.font = "600 12px 'Trebuchet MS', sans-serif"
  ctx.fillText("Altitude Up", state.width - 148, state.height - 60)
  ctx.fillStyle = "#ffcf72"
  ctx.fillRect(state.width - 148, state.height - 48, 18, 3)
  ctx.fillStyle = "#55d6ff"
  ctx.fillRect(state.width - 148, state.height - 36, 18, 3)
  ctx.fillStyle = "#9eb7c6"
  ctx.font = "12px 'Trebuchet MS', sans-serif"
  ctx.fillText("Airport", state.width - 122, state.height - 42)
  ctx.fillText("Aircraft", state.width - 122, state.height - 30)
  ctx.restore()
}

function getScreenDirection(worldDirection, basis) {
  const screenX = dot(worldDirection, basis.right)
  const screenY = -dot(worldDirection, basis.up)
  const magnitude = Math.hypot(screenX, screenY)

  if (!magnitude) {
    return { x: 0, y: -1 }
  }

  return {
    x: screenX / magnitude,
    y: screenY / magnitude
  }
}

function getCameraHeadingDegrees(basis) {
  const horizontalForward = normalize({
    x: basis.forward.x,
    y: 0,
    z: basis.forward.z
  })

  return normalizeHeadingDegrees(
    (Math.atan2(horizontalForward.x, -horizontalForward.z) * 180) / Math.PI
  )
}

function formatCompassHeadingDegrees(headingDegrees) {
  return `${Math.round(headingDegrees).toString().padStart(3, "0")}°`
}

function drawCompass(basis) {
  const centerX = state.width - 84
  const centerY = 82
  const radius = 34
  const north = getScreenDirection({ x: 0, y: 0, z: -1 }, basis)
  const east = getScreenDirection({ x: 1, y: 0, z: 0 }, basis)
  const south = { x: -north.x, y: -north.y }
  const west = { x: -east.x, y: -east.y }
  const headingDegrees = getCameraHeadingDegrees(basis)

  ctx.save()
  ctx.fillStyle = "rgba(5, 16, 24, 0.62)"
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius + 18, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = "rgba(142, 227, 255, 0.22)"
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = "rgba(158, 183, 198, 0.36)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(centerX + north.x * (radius - 6), centerY + north.y * (radius - 6))
  ctx.lineTo(centerX + south.x * (radius - 6), centerY + south.y * (radius - 6))
  ctx.moveTo(centerX + east.x * (radius - 10), centerY + east.y * (radius - 10))
  ctx.lineTo(centerX + west.x * (radius - 10), centerY + west.y * (radius - 10))
  ctx.stroke()

  ctx.strokeStyle = "rgba(239, 247, 251, 0.92)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(centerX - north.x * 10, centerY - north.y * 10)
  ctx.lineTo(centerX + north.x * (radius - 9), centerY + north.y * (radius - 9))
  ctx.stroke()

  const tipX = centerX + north.x * (radius - 4)
  const tipY = centerY + north.y * (radius - 4)
  const leftX = centerX + north.x * 10 - north.y * 5
  const leftY = centerY + north.y * 10 + north.x * 5
  const rightX = centerX + north.x * 10 + north.y * 5
  const rightY = centerY + north.y * 10 - north.x * 5

  ctx.fillStyle = "#55d6ff"
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(leftX, leftY)
  ctx.lineTo(rightX, rightY)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = "#eff7fb"
  ctx.font = "700 11px 'Trebuchet MS', sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("N", centerX + north.x * (radius + 10), centerY + north.y * (radius + 10))
  ctx.fillText("E", centerX + east.x * (radius + 10), centerY + east.y * (radius + 10))
  ctx.fillText("S", centerX + south.x * (radius + 10), centerY + south.y * (radius + 10))
  ctx.fillText("W", centerX + west.x * (radius + 10), centerY + west.y * (radius + 10))
  ctx.fillStyle = "rgba(158, 183, 198, 0.88)"
  ctx.font = "600 9px 'Trebuchet MS', sans-serif"
  ctx.fillText("HDG", centerX, centerY + radius + 3)
  ctx.fillStyle = "#eff7fb"
  ctx.font = "700 13px 'Trebuchet MS', sans-serif"
  ctx.fillText(formatCompassHeadingDegrees(headingDegrees), centerX, centerY + radius + 16)
  ctx.restore()
}

function render() {
  if (disposed) {
    return
  }

  drawBackground()

  const basis = getCameraBasis()
  updateHoveredFlightFromPointer(basis)
  drawSectorPlane(basis)
  const placedRunwayLabels = []
  state.runways.forEach((runway) => drawRunway(runway, basis, placedRunwayLabels))
  state.airports.forEach((airport) => drawAirport(airport, basis))

  const drawableFlights = state.flights
    .map((flight) => ({
      flight,
      depth: worldToCamera(flight.world, basis).z
    }))
    .filter((item) => item.depth >= NEAR_PLANE)
    .sort((left, right) => right.depth - left.depth)

  const labeledIcaos = new Set(
    drawableFlights
      .filter((item) => !item.flight.on_ground)
      .slice(0, 10)
      .map((item) => item.flight.icao24)
  )

  drawableFlights.forEach((item) => {
    drawFlight(item.flight, basis, labeledIcaos.has(item.flight.icao24))
  })

  drawCompass(basis)
  drawOverlayLegend()
  animationFrameId = requestAnimationFrame(render)
}

function scheduleRefresh(delayMs = state.refreshIntervalMs) {
  if (disposed) {
    return
  }

  if (state.refreshTimer) {
    window.clearTimeout(state.refreshTimer)
  }

  state.refreshTimer = window.setTimeout(() => {
    fetchTraffic()
  }, delayMs)
}

function upsertTrail(flight) {
  const existingTrail = state.trails.get(flight.icao24) || []
  const nextPoint = { x: flight.world.x, y: flight.world.y, z: flight.world.z }
  const lastPoint = existingTrail[existingTrail.length - 1]

  if (!lastPoint || length(subtract(nextPoint, lastPoint)) > 1.4) {
    existingTrail.push(nextPoint)
  } else {
    existingTrail[existingTrail.length - 1] = nextPoint
  }

  while (existingTrail.length > MAX_TRAIL_POINTS) {
    existingTrail.shift()
  }

  state.trails.set(flight.icao24, existingTrail)
  return existingTrail
}

function pruneTrails(activeFlights) {
  const activeIcaos = new Set(activeFlights.map((flight) => flight.icao24))
  for (const icao24 of state.trails.keys()) {
    if (!activeIcaos.has(icao24)) {
      state.trails.delete(icao24)
    }
  }
  for (const icao24 of state.headingCache.keys()) {
    if (!activeIcaos.has(icao24)) {
      state.headingCache.delete(icao24)
    }
  }
}

function applyFeedSnapshot(payload) {
  state.region = payload.region || state.region
  state.airports = payload.airports || state.airports
  state.runways = payload.runways || state.runways
  state.refreshIntervalMs = payload.refresh_interval_ms || state.refreshIntervalMs
  state.lastUpdatedMs = Date.now()
  state.lastOpenSkyTime = payload.opensky_time || null
  state.sourceModeText = payload.source?.label || "OpenSky"

  const nextFlights = (payload.flights || []).map((flight) => {
    const horizontal = latLonToWorld(flight.lat, flight.lon)
    const altitudeMeters = flight.altitude_m ?? 0
    const world = {
      x: horizontal.x,
      y: altitudeToWorld(altitudeMeters, flight.on_ground),
      z: horizontal.z
    }

    const normalized = {
      ...flight,
      world,
      trail: [],
      display_heading_deg: 0
    }

    normalized.trail = upsertTrail(normalized)
    normalized.display_heading_deg = getDisplayHeading(normalized)
    return normalized
  })

  pruneTrails(nextFlights)
  state.flights = nextFlights

  if (payload.warning) {
    state.feedNoteText = payload.warning
  } else if (payload.source?.rate_limit_remaining != null) {
    state.feedNoteText = `OpenSky credits remaining: ${payload.source.rate_limit_remaining}`
  } else {
    state.feedNoteText = `Live sector centered on ${state.region.name}. OpenSky snapshot time: ${payload.opensky_time || "n/a"}.`
  }

  updateAirportList()
  updateFlightList()
  updateHud()
}

async function fetchTraffic() {
  if (disposed || state.loading) {
    return
  }

  state.loading = true
  refreshButton.disabled = true
  setStatus("Updating", "pending")

  try {
    const response = await fetch(`/api/flights?ts=${Date.now()}`, {
      cache: "no-store"
    })
    const payload = await response.json()

    if (disposed) {
      return
    }

    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`)
    }

    applyFeedSnapshot(payload)
    setStatus("Live", "live")
  } catch (error) {
    if (disposed) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    state.feedNoteText = `Feed error: ${message}`
    updateHud()
    setStatus(state.lastUpdatedMs ? "Stale" : "Error", "error")
  } finally {
    if (disposed) {
      return
    }

    state.loading = false
    refreshButton.disabled = false
    scheduleRefresh()
  }
}

function onMouseDown(event) {
  event.preventDefault()
  canvas.classList.add("dragging")
  state.lastMouseX = event.clientX
  state.lastMouseY = event.clientY
  state.mouseMode = event.button === 2 || event.shiftKey ? "pan" : "rotate"
  clearHoveredFlight()
}

function onMouseMove(event) {
  state.pointerInsideCanvas = true
  state.pointerX = event.clientX
  state.pointerY = event.clientY

  if (!state.mouseMode) {
    const basis = getCameraBasis()
    updateHoveredFlightFromPointer(basis)
    return
  }

  const dx = event.clientX - state.lastMouseX
  const dy = event.clientY - state.lastMouseY
  state.lastMouseX = event.clientX
  state.lastMouseY = event.clientY

  if (state.mouseMode === "pan") {
    panCamera(dx, dy)
  } else {
    rotateCamera(dx, dy)
  }
}

function endMouseInteraction() {
  state.mouseMode = null
  canvas.classList.remove("dragging")
}

function clearPointerHoverState() {
  state.pointerInsideCanvas = false
  clearHoveredFlight()
}

function getTouchCenterAndDistance(touches) {
  const first = touches[0]
  const second = touches[1]
  const dx = second.clientX - first.clientX
  const dy = second.clientY - first.clientY

  return {
    centerX: (first.clientX + second.clientX) * 0.5,
    centerY: (first.clientY + second.clientY) * 0.5,
    distance: Math.hypot(dx, dy)
  }
}

function onTouchStart(event) {
  event.preventDefault()
  clearHoveredFlight()

  if (event.touches.length === 1) {
    const touch = event.touches[0]
    state.touchMode = "rotate"
    state.lastTouchX = touch.clientX
    state.lastTouchY = touch.clientY
    return
  }

  if (event.touches.length === 2) {
    const gesture = getTouchCenterAndDistance(event.touches)
    state.touchMode = "gesture"
    state.lastTouchCenterX = gesture.centerX
    state.lastTouchCenterY = gesture.centerY
    state.lastTouchDistance = gesture.distance
  }
}

function onTouchMove(event) {
  event.preventDefault()

  if (event.touches.length === 1 && state.touchMode === "rotate") {
    const touch = event.touches[0]
    const dx = touch.clientX - state.lastTouchX
    const dy = touch.clientY - state.lastTouchY
    state.lastTouchX = touch.clientX
    state.lastTouchY = touch.clientY
    rotateCamera(dx, dy)
    return
  }

  if (event.touches.length === 2) {
    const gesture = getTouchCenterAndDistance(event.touches)
    const panDx = gesture.centerX - state.lastTouchCenterX
    const panDy = gesture.centerY - state.lastTouchCenterY
    const pinchDelta = state.lastTouchDistance - gesture.distance

    state.touchMode = "gesture"
    state.lastTouchCenterX = gesture.centerX
    state.lastTouchCenterY = gesture.centerY
    state.lastTouchDistance = gesture.distance

    panCamera(panDx, panDy)
    zoomCamera(pinchDelta)
  }
}

function onTouchEnd(event) {
  if (event.touches.length === 0) {
    state.touchMode = null
    return
  }

  if (event.touches.length === 1) {
    const touch = event.touches[0]
    state.touchMode = "rotate"
    state.lastTouchX = touch.clientX
    state.lastTouchY = touch.clientY
    return
  }

  if (event.touches.length === 2) {
    const gesture = getTouchCenterAndDistance(event.touches)
    state.touchMode = "gesture"
    state.lastTouchCenterX = gesture.centerX
    state.lastTouchCenterY = gesture.centerY
    state.lastTouchDistance = gesture.distance
  }
}

function bindEvents() {
  addManagedListener(collapseButton, "click", () => {
    state.settings.hudCollapsed = !state.settings.hudCollapsed
    saveSettings()
    updateHudCollapse()
  })
  addManagedListener(hoverDetailsToggle, "change", () => {
    state.settings.showHoverDetails = hoverDetailsToggle.checked
    saveSettings()
    if (!state.settings.showHoverDetails) {
      clearHoveredFlight()
    }
  })
  addManagedListener(refreshButton, "click", () => {
    fetchTraffic()
  })

  addManagedListener(canvas, "mousedown", onMouseDown)
  addManagedListener(canvas, "mouseenter", (event) => {
    state.pointerInsideCanvas = true
    state.pointerX = event.clientX
    state.pointerY = event.clientY
  })
  addManagedListener(canvas, "mouseleave", () => {
    clearPointerHoverState()
  })
  addManagedListener(window, "mousemove", onMouseMove)
  addManagedListener(window, "mouseup", endMouseInteraction)
  addManagedListener(window, "mouseleave", () => {
    endMouseInteraction()
    clearPointerHoverState()
  })
  addManagedListener(window, "blur", () => {
    endMouseInteraction()
    clearPointerHoverState()
  })
  addManagedListener(canvas, "contextmenu", (event) => event.preventDefault())
  addManagedListener(
    canvas,
    "wheel",
    (event) => {
      event.preventDefault()
      zoomCamera(event.deltaY)
    },
    { passive: false }
  )

  addManagedListener(canvas, "touchstart", onTouchStart, { passive: false })
  addManagedListener(canvas, "touchmove", onTouchMove, { passive: false })
  addManagedListener(canvas, "touchend", onTouchEnd)
  addManagedListener(canvas, "touchcancel", onTouchEnd)

  addManagedListener(window, "resize", resizeCanvas)
}

function init() {
  resizeCanvas()
  updateSettingsControls()
  updateAirportList()
  updateFlightList()
  updateHud()
  bindEvents()
  fetchTraffic()
  animationFrameId = requestAnimationFrame(render)
}
