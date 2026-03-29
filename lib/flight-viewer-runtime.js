let canvas
let ctx
let refreshButton
let injectConflictButton
let statusBadge
let flightCount
let lastUpdated
let airportList
let flightList
let feedNote
let flightSearchForm
let flightSearchInput
let hudPanel
let collapseButton
let terrainToggle
let weatherToggle
let autoRefreshToggle
let autoRefreshRateInput
let hoverCard
let toastAlert
let listeners = []
let animationFrameId = 0
let disposed = false

const WORLD_UP = { x: 0, y: 1, z: 0 }
const EARTH_RADIUS_M = 6371000
const FOV = Math.PI / 3.15
const NEAR_PLANE = 0.1
const MAP_HALF_SIZE = 220
const MAX_TRAIL_POINTS = 6
const METERS_PER_NM = 1852
const FEET_PER_METER = 3.28084
const SETTINGS_STORAGE_KEY = "michigan-thumb-traffic-settings"
const DEFAULT_AUTO_REFRESH_PER_MIN = 2
const MIN_AUTO_REFRESH_PER_MIN = 1
const MAX_AUTO_REFRESH_PER_MIN = 60
const CAMERA_DEFAULT_TARGET = { x: 0, y: 28, z: 0 }
const CAMERA_DEFAULT_DISTANCE = 540
const CAMERA_DEFAULT_YAW = 0.74
const CAMERA_DEFAULT_PITCH = 0.92
const CAMERA_MIN_DISTANCE = 110
const CAMERA_MAX_DISTANCE = 1300
const KEYBOARD_PAN_SPEED_PX_PER_SECOND = 520
const KEYBOARD_ELEVATION_SPEED_WORLD_UNITS_PER_SECOND = 72
const KEYBOARD_ROTATION_SPEED_RAD_PER_SECOND = 1.9
const KEYBOARD_ZOOM_DELTA_PER_SECOND = 620
const LEVEL_ALTITUDE_DELTA_THRESHOLD_M = 15
const FLIGHT_PITCH_VISUAL_SCALE = 2.4
const MAX_FLIGHT_PITCH_RADIANS = 0.42
const SEARCH_HIGHLIGHT_DURATION_MS = 3000
const TERRAIN_FILL_ALPHA = 0.74
const INITIAL_FEED_NOTE = "Press Refresh to load the first live traffic snapshot."
const ADVISORY_SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  info: 2
}
const EMERGENCY_SQUAWK_LABELS = {
  7500: "Unlawful Interference",
  7600: "Radio Failure",
  7700: "General Emergency"
}
const DEFAULT_REGION = {
  name: "Detroit Approach",
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
  target: { ...CAMERA_DEFAULT_TARGET },
  distance: CAMERA_DEFAULT_DISTANCE,
  yaw: CAMERA_DEFAULT_YAW,
  pitch: CAMERA_DEFAULT_PITCH,
  minDistance: CAMERA_MIN_DISTANCE,
  maxDistance: CAMERA_MAX_DISTANCE
}

function loadSettings() {
  const defaults = {
    showTerrainMap: false,
    showWeatherOverlay: true,
    hudCollapsed: false,
    autoRefreshEnabled: false,
    autoRefreshPerMinute: DEFAULT_AUTO_REFRESH_PER_MIN
  }

  if (typeof window === "undefined") {
    return defaults
  }

  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!rawValue) {
      return defaults
    }

    const merged = {
      ...defaults,
      ...JSON.parse(rawValue)
    }

    return {
      ...merged,
      autoRefreshPerMinute: sanitizeAutoRefreshPerMinute(merged.autoRefreshPerMinute)
    }
  } catch {
    return defaults
  }
}

function sanitizeAutoRefreshPerMinute(value) {
  const numericValue = Number.parseFloat(String(value))
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_AUTO_REFRESH_PER_MIN
  }

  return clamp(Math.round(numericValue), MIN_AUTO_REFRESH_PER_MIN, MAX_AUTO_REFRESH_PER_MIN)
}

const state = {
  width: 0,
  height: 0,
  region: DEFAULT_REGION,
  airports: DEFAULT_AIRPORTS,
  runways: [],
  terrain: null,
  liveFlightsRaw: [],
  syntheticFlightsRaw: [],
  flights: [],
  advisories: [],
  trails: new Map(),
  headingCache: new Map(),
  previousRefreshFlightPoints: new Map(),
  loading: false,
  lastUpdatedMs: null,
  lastOpenSkyTime: null,
  refreshIntervalMs: 30000,
  refreshTimer: null,
  feedNoteText: INITIAL_FEED_NOTE,
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
  hoveredFlightIcao: null,
  highlightedConflictIcaos: new Set(),
  searchHighlightIcao: null,
  searchHighlightTimer: null,
  toastTimer: null,
  pressedPanKeys: new Set(),
  lastFrameTimeMs: null
}

function resetRuntimeState() {
  Object.assign(camera, {
    target: { ...CAMERA_DEFAULT_TARGET },
    distance: CAMERA_DEFAULT_DISTANCE,
    yaw: CAMERA_DEFAULT_YAW,
    pitch: CAMERA_DEFAULT_PITCH,
    minDistance: CAMERA_MIN_DISTANCE,
    maxDistance: CAMERA_MAX_DISTANCE
  })

  state.width = 0
  state.height = 0
  state.region = DEFAULT_REGION
  state.airports = DEFAULT_AIRPORTS
  state.runways = []
  state.terrain = null
  state.liveFlightsRaw = []
  state.syntheticFlightsRaw = []
  state.flights = []
  state.advisories = []
  state.trails = new Map()
  state.headingCache = new Map()
  state.previousRefreshFlightPoints = new Map()
  state.loading = false
  state.lastUpdatedMs = null
  state.lastOpenSkyTime = null
  state.refreshIntervalMs = 30000
  state.refreshTimer = null
  state.feedNoteText = INITIAL_FEED_NOTE
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
  state.highlightedConflictIcaos = new Set()
  state.searchHighlightIcao = null
  state.searchHighlightTimer = null
  state.toastTimer = null
  state.pressedPanKeys = new Set()
  state.lastFrameTimeMs = null
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

  if (toastAlert) {
    toastAlert.classList.add("hidden")
    toastAlert.setAttribute("aria-hidden", "true")
  }

  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer)
    state.toastTimer = null
  }

  if (state.searchHighlightTimer) {
    window.clearTimeout(state.searchHighlightTimer)
    state.searchHighlightTimer = null
  }

  canvas = null
  ctx = null
  refreshButton = null
  injectConflictButton = null
  statusBadge = null
  flightCount = null
  lastUpdated = null
  airportList = null
  flightList = null
  feedNote = null
  flightSearchForm = null
  flightSearchInput = null
  hudPanel = null
  collapseButton = null
  terrainToggle = null
  weatherToggle = null
  autoRefreshToggle = null
  autoRefreshRateInput = null
  hoverCard = null
  toastAlert = null
}

export function mountFlightViewer(elements) {
  cleanupFlightViewer()

  canvas = elements.canvas
  refreshButton = elements.refreshButton
  injectConflictButton = elements.injectConflictButton
  statusBadge = elements.statusBadge
  flightCount = elements.flightCount
  lastUpdated = elements.lastUpdated
  airportList = elements.airportList
  flightList = elements.flightList
  feedNote = elements.feedNote
  flightSearchForm = elements.flightSearchForm
  flightSearchInput = elements.flightSearchInput
  hudPanel = elements.hudPanel
  collapseButton = elements.collapseButton
  terrainToggle = elements.terrainToggle
  weatherToggle = elements.weatherToggle
  autoRefreshToggle = elements.autoRefreshToggle
  autoRefreshRateInput = elements.autoRefreshRateInput
  hoverCard = elements.hoverCard
  toastAlert = elements.toastAlert

  if (
    !canvas ||
    !refreshButton ||
    !injectConflictButton ||
    !statusBadge ||
    !flightCount ||
    !lastUpdated ||
    !airportList ||
    !flightList ||
    !feedNote ||
    !flightSearchForm ||
    !flightSearchInput ||
    !hudPanel ||
    !collapseButton ||
    !terrainToggle ||
    !weatherToggle ||
    !autoRefreshToggle ||
    !autoRefreshRateInput ||
    !hoverCard ||
    !toastAlert
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

function lerpNumber(start, end, amount) {
  return start + (end - start) * amount
}

function wrapAngleRadians(angle) {
  const fullTurn = Math.PI * 2
  return ((((angle + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI
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
const FLIGHT_COLOR_THEMES = {
  ascending: {
    base: { r: 154, g: 226, b: 255 },
    outline: "rgba(228, 245, 255, 0.62)",
    line: "#9ae2ff",
    trail: "rgba(154, 226, 255, 0.84)"
  },
  level: {
    base: { r: 78, g: 126, b: 255 },
    outline: "rgba(213, 225, 255, 0.58)",
    line: "#4e7eff",
    trail: "rgba(78, 126, 255, 0.82)"
  },
  descending: {
    base: { r: 44, g: 73, b: 168 },
    outline: "rgba(198, 211, 255, 0.56)",
    line: "#2c49a8",
    trail: "rgba(62, 103, 212, 0.78)"
  },
  ground: {
    base: { r: 142, g: 151, b: 166 },
    outline: "rgba(235, 238, 244, 0.44)",
    line: "#8e97a6",
    trail: "rgba(142, 151, 166, 0.7)"
  },
  conflict: {
    base: { r: 255, g: 92, b: 92 },
    outline: "rgba(255, 232, 232, 0.82)",
    line: "#ff5c5c",
    trail: "rgba(255, 92, 92, 0.9)"
  },
  search: {
    base: { r: 244, g: 250, b: 255 },
    outline: "rgba(255, 255, 255, 0.96)",
    line: "#f4faff",
    trail: "rgba(244, 250, 255, 0.92)"
  }
}
const CLEAR_SKY_CODES = new Set(["CLR", "SKC", "NCD", "NSC", "CAVOK"])
const METAR_CLOUD_STYLES = {
  FEW: {
    puffCount: 4,
    spreadWorld: 7,
    radius: 13,
    squash: 0.62,
    alpha: 0.1,
    layerDepthWorld: 1.8,
    fill: "rgb(190, 201, 214)",
    underside: "rgb(80, 98, 124)",
    glow: "rgba(178, 193, 212, 0.1)",
    label: "#dce8f5"
  },
  SCT: {
    puffCount: 6,
    spreadWorld: 10,
    radius: 15,
    squash: 0.64,
    alpha: 0.13,
    layerDepthWorld: 2.1,
    fill: "rgb(188, 199, 212)",
    underside: "rgb(78, 96, 122)",
    glow: "rgba(176, 191, 210, 0.11)",
    label: "#dce8f5"
  },
  BKN: {
    puffCount: 8,
    spreadWorld: 13,
    radius: 17,
    squash: 0.68,
    alpha: 0.16,
    layerDepthWorld: 2.4,
    fill: "rgb(182, 193, 206)",
    underside: "rgb(74, 90, 114)",
    glow: "rgba(170, 184, 202, 0.12)",
    label: "#e0e9f5"
  },
  OVC: {
    puffCount: 10,
    spreadWorld: 15,
    radius: 18.5,
    squash: 0.72,
    alpha: 0.19,
    layerDepthWorld: 2.7,
    fill: "rgb(176, 187, 199)",
    underside: "rgb(68, 84, 106)",
    glow: "rgba(164, 177, 193, 0.12)",
    label: "#e4ebf5"
  },
  VV: {
    puffCount: 9,
    spreadWorld: 12,
    radius: 17.5,
    squash: 0.76,
    alpha: 0.2,
    layerDepthWorld: 2.6,
    fill: "rgb(170, 182, 195)",
    underside: "rgb(64, 79, 101)",
    glow: "rgba(156, 170, 188, 0.11)",
    label: "#e4ebf5"
  },
  OVX: {
    puffCount: 9,
    spreadWorld: 12,
    radius: 17.5,
    squash: 0.76,
    alpha: 0.2,
    layerDepthWorld: 2.6,
    fill: "rgb(170, 182, 195)",
    underside: "rgb(64, 79, 101)",
    glow: "rgba(156, 170, 188, 0.11)",
    label: "#e4ebf5"
  }
}
const CLOUD_PUFF_PATTERN = [
  { x: -1.08, z: -0.24, size: 0.84, lift: 0.08, opacity: 0.84 },
  { x: -0.56, z: -0.58, size: 1.02, lift: 0.58, opacity: 0.92 },
  { x: 0, z: -0.34, size: 1.2, lift: 0.94, opacity: 1 },
  { x: 0.74, z: -0.16, size: 1.02, lift: 0.56, opacity: 0.94 },
  { x: 1.22, z: 0.1, size: 0.84, lift: 0.12, opacity: 0.82 },
  { x: -0.32, z: 0.28, size: 1.06, lift: 0.54, opacity: 0.95 },
  { x: 0.54, z: 0.42, size: 0.98, lift: 0.28, opacity: 0.9 },
  { x: -0.92, z: 0.34, size: 0.78, lift: 0.14, opacity: 0.8 },
  { x: 1.5, z: -0.42, size: 0.72, lift: 0.16, opacity: 0.74 },
  { x: -1.42, z: -0.04, size: 0.7, lift: 0.18, opacity: 0.72 }
]
const TERRAIN_COLOR_STOPS = [
  { t: 0, color: { r: 27, g: 74, b: 71 } },
  { t: 0.26, color: { r: 54, g: 104, b: 78 } },
  { t: 0.52, color: { r: 103, g: 134, b: 85 } },
  { t: 0.76, color: { r: 150, g: 149, b: 96 } },
  { t: 1, color: { r: 184, g: 166, b: 128 } }
]

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

function rgbToRgbaString(color, alpha = 1) {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`
}

function interpolateColorStops(stops, amount) {
  if (amount <= stops[0].t) {
    return stops[0].color
  }

  for (let index = 1; index < stops.length; index += 1) {
    if (amount <= stops[index].t) {
      const previous = stops[index - 1]
      const next = stops[index]
      const localAmount = (amount - previous.t) / Math.max(0.0001, next.t - previous.t)

      return {
        r: lerpNumber(previous.color.r, next.color.r, localAmount),
        g: lerpNumber(previous.color.g, next.color.g, localAmount),
        b: lerpNumber(previous.color.b, next.color.b, localAmount)
      }
    }
  }

  return stops[stops.length - 1].color
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
  camera.pitch = wrapAngleRadians(camera.pitch + pixelDy * 0.006)
}

function panViewport(pixelDx, pixelDy) {
  // Keyboard panning should move the viewport in the pressed direction rather than drag the scene.
  panCamera(-pixelDx, -pixelDy)
}

function adjustCameraHeight(worldDy) {
  camera.target = {
    x: camera.target.x,
    y: camera.target.y + worldDy,
    z: camera.target.z
  }
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

function formatDistanceNm(distanceNm) {
  return `${distanceNm < 10 ? distanceNm.toFixed(1) : Math.round(distanceNm)} NM`
}

function formatVerticalSeparationFeet(distanceFeet) {
  return `${Math.round(distanceFeet).toLocaleString()} ft`
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

function normalizeMetarCoverCode(value) {
  const normalized = String(value || "").trim().toUpperCase()
  return normalized || null
}

function formatCloudLayerTag(layer) {
  const cover = normalizeMetarCoverCode(layer?.cover)
  if (!cover) {
    return null
  }

  const baseFeet = Number.isFinite(layer?.base_ft_agl) ? Math.round(layer.base_ft_agl) : null
  if (baseFeet == null) {
    return cover
  }

  return `${cover}${String(Math.round(baseFeet / 100)).padStart(3, "0")}`
}

function summarizeAirportClouds(metar) {
  const cloudTags = Array.isArray(metar?.clouds)
    ? metar.clouds.map((layer) => formatCloudLayerTag(layer)).filter(Boolean)
    : []

  if (cloudTags.length) {
    return cloudTags.join(" · ")
  }

  const cover = normalizeMetarCoverCode(metar?.cover)
  if (!cover) {
    return "No cloud layers reported"
  }

  return CLEAR_SKY_CODES.has(cover) ? "Clear" : cover
}

function formatAirportWeatherSummary(airport) {
  if (!airport?.metar) {
    return state.lastUpdatedMs == null ? null : "METAR unavailable"
  }

  const parts = ["METAR"]
  if (airport.metar.flight_category) {
    parts.push(airport.metar.flight_category)
  }
  parts.push(summarizeAirportClouds(airport.metar))
  return parts.join(" · ")
}

function getAirportCloudLayers(airport) {
  if (!Array.isArray(airport?.metar?.clouds)) {
    return []
  }

  return airport.metar.clouds.filter((layer) => {
    const cover = normalizeMetarCoverCode(layer?.cover)
    return cover && !CLEAR_SKY_CODES.has(cover)
  })
}

function setHoverCardVisible(visible) {
  hoverCard.classList.toggle("hidden", !visible)
  hoverCard.setAttribute("aria-hidden", String(!visible))
}

function setToastAlertVisible(visible) {
  toastAlert.classList.toggle("hidden", !visible)
  toastAlert.setAttribute("aria-hidden", String(!visible))
}

function hideToastAlert() {
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer)
    state.toastTimer = null
  }

  setToastAlertVisible(false)
}

function clearSearchHighlight() {
  if (state.searchHighlightTimer) {
    window.clearTimeout(state.searchHighlightTimer)
    state.searchHighlightTimer = null
  }

  state.searchHighlightIcao = null
}

function setSearchHighlight(icao24) {
  clearSearchHighlight()
  state.searchHighlightIcao = icao24
  state.searchHighlightTimer = window.setTimeout(() => {
    state.searchHighlightIcao = null
    state.searchHighlightTimer = null
  }, SEARCH_HIGHLIGHT_DURATION_MS)
}

function clearFlightSearchError(clearValue = false) {
  flightSearchInput.classList.remove("search-input-error")
  flightSearchInput.removeAttribute("aria-invalid")
  if (clearValue) {
    flightSearchInput.value = ""
  }
}

function setFlightSearchNotFound() {
  clearSearchHighlight()
  flightSearchInput.value = "Flight not found"
  flightSearchInput.classList.add("search-input-error")
  flightSearchInput.setAttribute("aria-invalid", "true")
  flightSearchInput.focus()
  flightSearchInput.select()
}

function resetFlightSearchInput() {
  clearFlightSearchError(true)
}

function normalizeFlightSearchQuery(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
}

function getFlightSearchKeys(flight) {
  return [
    normalizeFlightSearchQuery(flight.callsign),
    normalizeFlightSearchQuery(flight.code_display),
    normalizeFlightSearchQuery(flight.icao24)
  ].filter(Boolean)
}

function findFlightByQuery(query) {
  const normalizedQuery = normalizeFlightSearchQuery(query)
  if (!normalizedQuery) {
    return null
  }

  let partialMatch = null

  for (const flight of state.flights) {
    const searchKeys = getFlightSearchKeys(flight)
    if (searchKeys.some((key) => key === normalizedQuery)) {
      return flight
    }

    if (!partialMatch && searchKeys.some((key) => key.includes(normalizedQuery))) {
      partialMatch = flight
    }
  }

  return partialMatch
}

function focusCameraOnFlight(flight) {
  const headingRadians = ((flight.display_heading_deg ?? 0) * Math.PI) / 180

  camera.target = {
    x: flight.world.x,
    y: flight.world.y,
    z: flight.world.z
  }
  camera.yaw = headingRadians + Math.PI
  camera.pitch = flight.on_ground ? 0.34 : 0.42
  camera.distance = clamp(flight.on_ground ? 150 : 138, camera.minDistance, camera.maxDistance)
}

function searchForFlight() {
  if (flightSearchInput.classList.contains("search-input-error")) {
    flightSearchInput.focus()
    flightSearchInput.select()
    return
  }

  const rawQuery = flightSearchInput.value
  if (!normalizeFlightSearchQuery(rawQuery)) {
    clearFlightSearchError(false)
    return
  }

  const matchedFlight = findFlightByQuery(rawQuery)
  if (!matchedFlight) {
    setFlightSearchNotFound()
    return
  }

  clearFlightSearchError(false)
  flightSearchInput.value = getFlightDisplayName(matchedFlight)
  focusCameraOnFlight(matchedFlight)
  setSearchHighlight(matchedFlight.icao24)
  flightSearchInput.blur()
}

function clearPressedPanKeys() {
  state.pressedPanKeys.clear()
}

function isEditableTarget(target) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  )
}

function getKeyboardPanDirection() {
  let horizontal = 0
  let vertical = 0
  let elevation = 0
  let rotation = 0
  let zoom = 0

  if (state.pressedPanKeys.has("KeyA")) {
    horizontal -= 1
  }
  if (state.pressedPanKeys.has("KeyD")) {
    horizontal += 1
  }
  if (state.pressedPanKeys.has("ArrowUp") || state.pressedPanKeys.has("KeyW")) {
    vertical -= 1
  }
  if (state.pressedPanKeys.has("ArrowDown") || state.pressedPanKeys.has("KeyS")) {
    vertical += 1
  }
  if (state.pressedPanKeys.has("ArrowLeft")) {
    rotation -= 1
  }
  if (state.pressedPanKeys.has("ArrowRight")) {
    rotation += 1
  }
  if (state.pressedPanKeys.has("KeyE")) {
    elevation += 1
  }
  if (state.pressedPanKeys.has("KeyQ")) {
    elevation -= 1
  }
  if (state.pressedPanKeys.has("KeyI")) {
    zoom -= 1
  }
  if (state.pressedPanKeys.has("KeyO")) {
    zoom += 1
  }

  if (!horizontal && !vertical && !elevation && !rotation && !zoom) {
    return null
  }

  const length = Math.hypot(horizontal, vertical)
  return {
    x: length ? horizontal / length : 0,
    y: length ? vertical / length : 0,
    elevation,
    rotation,
    zoom
  }
}

function applyKeyboardPan(deltaMs) {
  const direction = getKeyboardPanDirection()
  if (!direction || !state.height) {
    return
  }

  const distancePx = (KEYBOARD_PAN_SPEED_PX_PER_SECOND * deltaMs) / 1000
  if (direction.x || direction.y) {
    panViewport(direction.x * distancePx, direction.y * distancePx)
  }

  if (direction.elevation) {
    const distanceWorld =
      (KEYBOARD_ELEVATION_SPEED_WORLD_UNITS_PER_SECOND * deltaMs) / 1000
    adjustCameraHeight(direction.elevation * distanceWorld)
  }

  if (direction.rotation) {
    camera.yaw -=
      direction.rotation * KEYBOARD_ROTATION_SPEED_RAD_PER_SECOND * (deltaMs / 1000)
  }

  if (direction.zoom) {
    const zoomDelta = direction.zoom * KEYBOARD_ZOOM_DELTA_PER_SECOND * (deltaMs / 1000)
    zoomCamera(zoomDelta)
  }
}

function showToastAlert({
  severity = "info",
  label = "AI Assist",
  title,
  body,
  detail = "",
  durationMs = 5200,
  sticky = false
}) {
  if (!title || !body) {
    return
  }

  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer)
    state.toastTimer = null
  }

  toastAlert.className = `toast-alert severity-${severity}`
  toastAlert.replaceChildren()

  const pill = document.createElement("span")
  const heading = document.createElement("strong")
  const copy = document.createElement("p")
  const meta = detail ? document.createElement("p") : null

  pill.className = "advisory-pill"
  pill.textContent = label
  heading.className = "toast-title"
  heading.textContent = title
  copy.className = "toast-body"
  copy.textContent = body
  if (meta) {
    meta.className = "toast-meta"
    meta.textContent = detail
  }

  toastAlert.appendChild(pill)
  toastAlert.appendChild(heading)
  toastAlert.appendChild(copy)
  if (meta) {
    toastAlert.appendChild(meta)
  }
  setToastAlertVisible(true)

  if (!sticky && durationMs > 0) {
    state.toastTimer = window.setTimeout(() => {
      setToastAlertVisible(false)
      state.toastTimer = null
    }, durationMs)
  }
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
  collapseButton.setAttribute("aria-expanded", String(!state.settings.hudCollapsed))
  collapseButton.setAttribute(
    "aria-label",
    state.settings.hudCollapsed ? "Expand panel" : "Collapse panel"
  )
  collapseButton.classList.add("is-ready")
}

function getAutoRefreshIntervalMs() {
  return Math.round(60000 / sanitizeAutoRefreshPerMinute(state.settings.autoRefreshPerMinute))
}

function clearScheduledRefresh() {
  if (state.refreshTimer) {
    window.clearTimeout(state.refreshTimer)
    state.refreshTimer = null
  }
}

function updateSettingsControls() {
  terrainToggle.checked = state.settings.showTerrainMap
  weatherToggle.checked = state.settings.showWeatherOverlay
  autoRefreshToggle.checked = state.settings.autoRefreshEnabled
  autoRefreshRateInput.value = String(
    sanitizeAutoRefreshPerMinute(state.settings.autoRefreshPerMinute)
  )
  autoRefreshRateInput.disabled = !state.settings.autoRefreshEnabled
  updateHudCollapse()
}

function commitAutoRefreshRate() {
  state.settings.autoRefreshPerMinute = sanitizeAutoRefreshPerMinute(autoRefreshRateInput.value)
  saveSettings()
  updateSettingsControls()
  scheduleRefresh()
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

function getMetersPerWorldUnit() {
  return (state.region.side_m * 0.5) / MAP_HALF_SIZE
}

function worldToLatLon(worldX, worldZ) {
  const scaleFactor = getMapScale()
  const eastMeters = worldX / scaleFactor
  const northMeters = -worldZ / scaleFactor
  const centerLatRadians = (state.region.center_lat * Math.PI) / 180

  return {
    lat: state.region.center_lat + (northMeters * 180) / (Math.PI * EARTH_RADIUS_M),
    lon:
      state.region.center_lon +
      (eastMeters * 180) / (Math.PI * EARTH_RADIUS_M * Math.cos(centerLatRadians))
  }
}

function worldDistanceMeters(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) * getMetersPerWorldUnit()
}

function worldDistanceNm(a, b) {
  return worldDistanceMeters(a, b) / METERS_PER_NM
}

function bearingBetweenWorldPoints(from, to) {
  return normalizeHeadingDegrees(
    (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI
  )
}

function headingDifferenceDegrees(left, right) {
  const difference = Math.abs(normalizeHeadingDegrees(left - right))
  return difference > 180 ? 360 - difference : difference
}

function getFlightDisplayName(flight) {
  return flight.callsign || flight.code_display || flight.icao24.toUpperCase()
}

function getFlightSpeedKnots(flight) {
  return (flight.velocity_mps ?? 0) * 1.94384
}

function getFlightVelocityVector(flight) {
  const speed = flight.velocity_mps ?? 0
  const headingRadians = ((flight.display_heading_deg ?? 0) * Math.PI) / 180

  return {
    x: Math.sin(headingRadians) * speed,
    z: -Math.cos(headingRadians) * speed
  }
}

function getNearestAirportContext(flight) {
  let bestMatch = null

  state.airports.forEach((airport) => {
    const airportWorld = latLonToWorld(airport.lat, airport.lon)
    const distanceNm = worldDistanceNm(flight.world, airportWorld)

    if (!bestMatch || distanceNm < bestMatch.distanceNm) {
      bestMatch = {
        airport,
        airportWorld,
        distanceNm,
        bearingToAirport: bearingBetweenWorldPoints(flight.world, airportWorld)
      }
    }
  })

  return bestMatch
}

function isInboundToAirport(flight, airportContext) {
  if (flight.on_ground || !airportContext) {
    return false
  }

  if (getFlightSpeedKnots(flight) < 70 || flight.altitude_m > 3657.6) {
    return false
  }

  return (
    airportContext.distanceNm <= 45 &&
    headingDifferenceDegrees(flight.display_heading_deg, airportContext.bearingToAirport) <= 42
  )
}

function isOutboundFromAirport(flight, airportContext) {
  if (flight.on_ground || !airportContext) {
    return false
  }

  if (airportContext.distanceNm > 16 || flight.altitude_m > 2438.4) {
    return false
  }

  const outboundBearing = normalizeHeadingDegrees(airportContext.bearingToAirport + 180)
  return (
    headingDifferenceDegrees(flight.display_heading_deg, outboundBearing) <= 50 &&
    (flight.vertical_rate_mps ?? 0) >= -1.5
  )
}

function getPreviousDistanceToAirportNm(flight, airportWorld) {
  if (!flight.trail || flight.trail.length < 2) {
    return null
  }

  return worldDistanceNm(flight.trail[flight.trail.length - 2], airportWorld)
}

function classifyPairConflict(left, right) {
  const horizontalMeters = worldDistanceMeters(left.world, right.world)
  const horizontalNm = horizontalMeters / METERS_PER_NM
  const verticalFeet = Math.abs((left.altitude_m ?? 0) - (right.altitude_m ?? 0)) * FEET_PER_METER

  if (horizontalNm > 6 || verticalFeet > 1600) {
    return null
  }

  const leftVelocity = getFlightVelocityVector(left)
  const rightVelocity = getFlightVelocityVector(right)
  const futureSeconds = 45
  const leftFuture = {
    x: left.world.x * getMetersPerWorldUnit() + leftVelocity.x * futureSeconds,
    z: left.world.z * getMetersPerWorldUnit() + leftVelocity.z * futureSeconds
  }
  const rightFuture = {
    x: right.world.x * getMetersPerWorldUnit() + rightVelocity.x * futureSeconds,
    z: right.world.z * getMetersPerWorldUnit() + rightVelocity.z * futureSeconds
  }
  const futureMeters = Math.hypot(leftFuture.x - rightFuture.x, leftFuture.z - rightFuture.z)
  const converging = futureMeters < horizontalMeters * 0.9

  if (!converging && horizontalNm > 3.5) {
    return null
  }

  const severity = horizontalNm < 3 || verticalFeet < 900 ? "critical" : "warning"
  return {
    severity,
    label: "Conflict",
    score: horizontalNm + verticalFeet / 10000,
    title: `${getFlightDisplayName(left)} and ${getFlightDisplayName(right)} are converging`,
    body: `${formatDistanceNm(horizontalNm)} lateral and ${formatVerticalSeparationFeet(verticalFeet)} vertical separation near ${getNearestAirportContext(left)?.airport.code || state.region.name}. Consider vectors or altitude separation.`,
    relatedIcaos: [left.icao24, right.icao24]
  }
}

function createBannerAdvisory(severity, label, title, body, score = 99, metadata = {}) {
  return { severity, label, title, body, score, ...metadata }
}

function getPinnedConflictAdvisory() {
  if (!state.highlightedConflictIcaos.size) {
    return null
  }

  return (
    state.advisories.find(
      (advisory) =>
        advisory.label === "Conflict" &&
        advisory.relatedIcaos?.some((icao24) => state.highlightedConflictIcaos.has(icao24))
    ) || null
  )
}

function getSimulationTimestampSeconds() {
  return Math.floor(Date.now() / 1000)
}

function createOffsetWorldPoint(originWorld, headingDegrees, distanceNm) {
  const distanceWorld = (distanceNm * METERS_PER_NM) / getMetersPerWorldUnit()
  const headingRadians = (headingDegrees * Math.PI) / 180

  return {
    x: originWorld.x + Math.sin(headingRadians) * distanceWorld,
    z: originWorld.z - Math.cos(headingRadians) * distanceWorld
  }
}

function createSyntheticFlight({
  icao24,
  callsign,
  world,
  altitudeM,
  headingDegrees,
  speedKnots,
  squawk = "1200",
  conflictHighlight = false
}) {
  const latLon = worldToLatLon(world.x, world.z)
  const timestamp = getSimulationTimestampSeconds()

  return {
    icao24,
    callsign,
    origin_country: "Simulation",
    last_contact: timestamp,
    age_s: 0,
    lon: latLon.lon,
    lat: latLon.lat,
    baro_altitude_m: altitudeM,
    geo_altitude_m: altitudeM,
    altitude_m: altitudeM,
    on_ground: false,
    velocity_mps: speedKnots / 1.94384,
    track_deg: normalizeHeadingDegrees(headingDegrees),
    vertical_rate_mps: 0,
    squawk,
    position_source: "simulation",
    category: 3,
    category_label: "Simulation",
    type_label: "Simulation",
    aircraft_type_name: "Conflict Test",
    aircraft_type_code: "SIM",
    manufacturer: "Synthetic",
    registration: callsign,
    registered_owner: "AI Assist Simulation",
    operator_flag_code: "SIM",
    registry_source: "simulation",
    code_display: callsign,
    is_synthetic: true,
    is_conflict_highlight: conflictHighlight
  }
}

function buildControllerAdvisories() {
  const advisories = []
  const airborneFlights = state.flights.filter((flight) => !flight.on_ground)
  const airportContexts = new Map(
    state.flights.map((flight) => [flight.icao24, getNearestAirportContext(flight)])
  )

  state.flights.forEach((flight) => {
    const squawk = Number.parseInt(flight.squawk || "", 10)
    const emergencyLabel = EMERGENCY_SQUAWK_LABELS[squawk]
    const airportContext = airportContexts.get(flight.icao24)

    if (!emergencyLabel) {
      return
    }

    advisories.push(
      createBannerAdvisory(
        "critical",
        "Priority",
        `${getFlightDisplayName(flight)} squawking ${squawk}`,
        `${emergencyLabel} near ${airportContext?.airport.code || state.region.name}. Consider priority handling, coordination, and reroute options.`,
        0
      )
    )
  })

  const conflictAdvisories = []
  for (let leftIndex = 0; leftIndex < airborneFlights.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < airborneFlights.length; rightIndex += 1) {
      const candidate = classifyPairConflict(airborneFlights[leftIndex], airborneFlights[rightIndex])
      if (candidate) {
        conflictAdvisories.push(candidate)
      }
    }
  }
  conflictAdvisories
    .sort((left, right) => {
      const severityDelta = ADVISORY_SEVERITY_RANK[left.severity] - ADVISORY_SEVERITY_RANK[right.severity]
      return severityDelta || left.score - right.score
    })
    .slice(0, 2)
    .forEach((advisory) => advisories.push(advisory))

  state.airports.forEach((airport) => {
    const inbound = airborneFlights
      .map((flight) => ({
        flight,
        context: airportContexts.get(flight.icao24)
      }))
      .filter(
        (item) =>
          item.context?.airport.code === airport.code &&
          isInboundToAirport(item.flight, item.context)
      )
      .sort((left, right) => left.context.distanceNm - right.context.distanceNm)

    if (inbound.length >= 2) {
      const leader = inbound[0]
      const follower = inbound[1]
      const spacingNm = Math.max(0, follower.context.distanceNm - leader.context.distanceNm)
      const severity = spacingNm < 4 ? "warning" : "info"
      advisories.push(
        createBannerAdvisory(
          severity,
          "Arrival",
          `${airport.code} arrival sequencing`,
          `Sequence ${getFlightDisplayName(leader.flight)} ahead of ${getFlightDisplayName(follower.flight)}. Current in-trail spacing is ${formatDistanceNm(spacingNm)} with ${inbound.length} inbound aircraft inside 45 NM.`,
          spacingNm
        )
      )
    }

    const outbound = airborneFlights
      .map((flight) => ({
        flight,
        context: airportContexts.get(flight.icao24)
      }))
      .filter(
        (item) =>
          item.context?.airport.code === airport.code &&
          isOutboundFromAirport(item.flight, item.context)
      )
      .sort((left, right) => right.context.distanceNm - left.context.distanceNm)

    if (outbound.length >= 2) {
      const leader = outbound[0]
      const trail = outbound[1]
      const spacingNm = Math.max(0, leader.context.distanceNm - trail.context.distanceNm)
      const severity = spacingNm < 3.5 ? "warning" : "info"
      advisories.push(
        createBannerAdvisory(
          severity,
          "Departure",
          `${airport.code} departure release spacing`,
          `${getFlightDisplayName(leader.flight)} and ${getFlightDisplayName(trail.flight)} are climbing out with about ${formatDistanceNm(spacingNm)} longitudinal spacing. Consider release timing or divergent headings.`,
          spacingNm + 20
        )
      )
    }
  })

  airborneFlights.forEach((flight) => {
    const airportContext = airportContexts.get(flight.icao24)
    if (!airportContext || airportContext.distanceNm > 12 || flight.altitude_m > 1524) {
      return
    }

    const previousDistanceNm = getPreviousDistanceToAirportNm(flight, airportContext.airportWorld)
    if (
      previousDistanceNm == null ||
      previousDistanceNm >= airportContext.distanceNm ||
      !isOutboundFromAirport(flight, airportContext) ||
      (flight.vertical_rate_mps ?? 0) < 2.5
    ) {
      return
    }

    advisories.push(
      createBannerAdvisory(
        "warning",
        "Reroute",
        `${getFlightDisplayName(flight)} climbing away from ${airportContext.airport.code}`,
        `Possible missed approach, go-around, or reroute cue. Aircraft is below ${formatAltitudeFeet(flight.altitude_m, false)} and trending away from the field with positive climb.`,
        airportContext.distanceNm + 10
      )
    )
  })

  return advisories
    .sort((left, right) => {
      const severityDelta = ADVISORY_SEVERITY_RANK[left.severity] - ADVISORY_SEVERITY_RANK[right.severity]
      return severityDelta || left.score - right.score
    })
    .slice(0, 5)
}

function renderAdvisories() {
  const pinnedConflictAdvisory = getPinnedConflictAdvisory()
  const topAdvisory = pinnedConflictAdvisory || state.advisories[0] || null

  if (!topAdvisory) {
    hideToastAlert()
    return
  }

  const additionalAdvisoryCount = pinnedConflictAdvisory
    ? state.advisories.filter((advisory) => advisory !== pinnedConflictAdvisory).length
    : Math.max(0, state.advisories.length - 1)
  const detail =
    additionalAdvisoryCount > 0
      ? `${additionalAdvisoryCount} more active ${
          additionalAdvisoryCount === 1 ? "advisory" : "advisories"
        }`
      : "AI assist is monitoring live sector traffic."

  showToastAlert({
    severity: topAdvisory.severity,
    label: topAdvisory.label,
    title: topAdvisory.title,
    body: topAdvisory.body,
    detail,
    sticky: true
  })
}

function createRefreshFlightPoint(flight, world) {
  return {
    x: world.x,
    y: world.y,
    z: world.z,
    altitude_m: flight.altitude_m ?? 0,
    on_ground: flight.on_ground
  }
}

function pitchFromRefreshPoints(previousPoint, currentPoint) {
  if (!previousPoint || !currentPoint || currentPoint.on_ground) {
    return 0
  }

  const altitudeDeltaMeters = (currentPoint.altitude_m ?? 0) - (previousPoint.altitude_m ?? 0)
  const horizontalDistanceMeters = worldDistanceMeters(previousPoint, currentPoint)

  if (
    horizontalDistanceMeters < 25 ||
    Math.abs(altitudeDeltaMeters) < LEVEL_ALTITUDE_DELTA_THRESHOLD_M
  ) {
    return 0
  }

  const pathPitchRadians = Math.atan2(altitudeDeltaMeters, horizontalDistanceMeters)
  return clamp(
    pathPitchRadians * FLIGHT_PITCH_VISUAL_SCALE,
    -MAX_FLIGHT_PITCH_RADIANS,
    MAX_FLIGHT_PITCH_RADIANS
  )
}

function updatePreviousRefreshFlightPoints(flights) {
  const nextPoints = new Map()

  flights.forEach((flight) => {
    if (flight.is_synthetic) {
      return
    }

    nextPoints.set(flight.icao24, createRefreshFlightPoint(flight, flight.world))
  })

  state.previousRefreshFlightPoints = nextPoints
}

function buildDisplayedFlights(rawFlights) {
  return rawFlights.map((flight) => {
    const horizontal = latLonToWorld(flight.lat, flight.lon)
    const altitudeMeters = flight.altitude_m ?? 0
    const world = {
      x: horizontal.x,
      y: altitudeToWorld(altitudeMeters, flight.on_ground),
      z: horizontal.z
    }
    const currentRefreshPoint = createRefreshFlightPoint(flight, world)
    const previousRefreshPoint = flight.is_synthetic
      ? null
      : state.previousRefreshFlightPoints.get(flight.icao24) ?? null

    const normalized = {
      ...flight,
      world,
      trail: [],
      display_heading_deg: 0,
      display_pitch_rad: pitchFromRefreshPoints(previousRefreshPoint, currentRefreshPoint)
    }

    normalized.trail = upsertTrail(normalized)
    normalized.display_heading_deg = getDisplayHeading(normalized)
    return normalized
  })
}

function refreshDisplayedFlights() {
  const nextFlights = buildDisplayedFlights([
    ...state.liveFlightsRaw,
    ...state.syntheticFlightsRaw
  ])
  pruneTrails(nextFlights)
  updatePreviousRefreshFlightPoints(nextFlights)
  state.flights = nextFlights
  state.advisories = buildControllerAdvisories()
  updateFlightList()
  renderAdvisories()
}

function clearSyntheticFlights() {
  state.syntheticFlightsRaw.forEach((flight) => {
    state.trails.delete(flight.icao24)
    state.headingCache.delete(flight.icao24)
  })
  state.syntheticFlightsRaw = []
  state.highlightedConflictIcaos = new Set()
}

function createFallbackConflictScenarioFlights() {
  const dtwAirport = state.airports.find((airport) => airport.code === "KDTW") || state.airports[0]
  const conflictCenter = latLonToWorld(dtwAirport.lat, dtwAirport.lon)
  const westStart = createOffsetWorldPoint(conflictCenter, 270, 1.6)
  const eastStart = createOffsetWorldPoint(conflictCenter, 90, 1.6)

  return [
    createSyntheticFlight({
      icao24: "simbase1",
      callsign: "SIMBASE",
      world: westStart,
      altitudeM: 1219.2,
      headingDegrees: 90,
      speedKnots: 220,
      conflictHighlight: true
    }),
    createSyntheticFlight({
      icao24: "simwarn1",
      callsign: "SIMWARN",
      world: eastStart,
      altitudeM: 1219.2,
      headingDegrees: 270,
      speedKnots: 220,
      conflictHighlight: true
    })
  ]
}

function createConflictScenarioFlights() {
  const targetFlight = state.flights.find(
    (flight) => !flight.on_ground && !flight.is_synthetic
  )

  if (!targetFlight) {
    return {
      flights: createFallbackConflictScenarioFlights(),
      note: "Injected a fully simulated head-on conflict scenario near KDTW to trigger AI-assist alerts."
    }
  }

  const targetHeading = targetFlight.display_heading_deg
  const targetSpeedKnots = Math.max(180, getFlightSpeedKnots(targetFlight))
  const conflictStart = createOffsetWorldPoint(targetFlight.world, targetHeading, 2.6)

  return {
    flights: [
      createSyntheticFlight({
        icao24: "simwarn1",
        callsign: "SIMWARN",
        world: conflictStart,
        altitudeM: Math.max(targetFlight.altitude_m ?? 914.4, 914.4),
        headingDegrees: normalizeHeadingDegrees(targetHeading + 180),
        speedKnots: targetSpeedKnots + 20,
        conflictHighlight: true
      })
    ],
    note: `Injected SIMWARN on a reciprocal heading toward ${getFlightDisplayName(targetFlight)} to trigger a conflict advisory.`
  }
}

function injectConflictScenario() {
  clearSyntheticFlights()
  const scenario = createConflictScenarioFlights()
  state.syntheticFlightsRaw = scenario.flights
  state.highlightedConflictIcaos = new Set(
    scenario.flights
      .filter((flight) => flight.is_conflict_highlight)
      .map((flight) => flight.icao24)
  )
  refreshDisplayedFlights()
  if (state.settings.hudCollapsed) {
    state.settings.hudCollapsed = false
    updateHudCollapse()
  }
  state.feedNoteText = scenario.note
  updateHud()
}

function renderHoverCard(flight, projected) {
  if (state.mouseMode) {
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
    const weather = document.createElement("span")
    const weatherSummary = state.settings.showWeatherOverlay
      ? formatAirportWeatherSummary(airport)
      : ""

    title.className = "airport-code"
    title.textContent = `${airport.code} · ${airport.name}`
    meta.className = "airport-meta"
    meta.textContent = formatLatLon(airport.lat, airport.lon)
    weather.className = "airport-weather"
    weather.textContent = weatherSummary || ""

    item.appendChild(title)
    item.appendChild(meta)
    if (weatherSummary) {
      item.appendChild(weather)
    }
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
  lastUpdated.textContent = formatUpdateTime(state.lastUpdatedMs)
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

function getTerrainPoint(terrain, row, column) {
  return terrain?.points?.[row * terrain.columns + column] ?? null
}

function getTerrainContourStep(terrainRangeMeters) {
  if (terrainRangeMeters <= 40) {
    return 4
  }

  if (terrainRangeMeters <= 80) {
    return 8
  }

  if (terrainRangeMeters <= 150) {
    return 12
  }

  return 20
}

function terrainElevationToColor(elevationMeters, minElevationMeters, maxElevationMeters, lightFactor) {
  const range = Math.max(1, maxElevationMeters - minElevationMeters)
  const normalized = clamp((elevationMeters - minElevationMeters) / range, 0, 1)
  const baseColor = interpolateColorStops(TERRAIN_COLOR_STOPS, normalized)
  const shading = clamp(lightFactor, 0.58, 1.16)

  return {
    r: baseColor.r * shading,
    g: baseColor.g * shading,
    b: baseColor.b * shading
  }
}

function computeTerrainCellLight(northwest, northeast, southwest, southeast, terrainRangeMeters) {
  const eastRise = ((northeast + southeast) - (northwest + southwest)) * 0.5
  const southRise = ((southwest + southeast) - (northwest + northeast)) * 0.5
  const gradientScale = Math.max(18, terrainRangeMeters * 0.18)
  const directionalLight = (southRise - eastRise) / gradientScale
  return clamp(0.84 + directionalLight * 0.26, 0.62, 1.08)
}

function drawTerrainMap(basis) {
  if (!state.settings.showTerrainMap || !state.terrain?.points?.length) {
    return
  }

  const terrain = state.terrain
  const terrainRangeMeters = Math.max(
    1,
    (terrain.max_elevation_m ?? 0) - (terrain.min_elevation_m ?? 0)
  )

  for (let row = 0; row < terrain.rows - 1; row += 1) {
    for (let column = 0; column < terrain.columns - 1; column += 1) {
      const northwest = getTerrainPoint(terrain, row, column)
      const northeast = getTerrainPoint(terrain, row, column + 1)
      const southwest = getTerrainPoint(terrain, row + 1, column)
      const southeast = getTerrainPoint(terrain, row + 1, column + 1)

      if (!northwest || !northeast || !southwest || !southeast) {
        continue
      }

      const averageElevationMeters =
        (northwest.elevation_m + northeast.elevation_m + southwest.elevation_m + southeast.elevation_m) /
        4
      const lightFactor = computeTerrainCellLight(
        northwest.elevation_m,
        northeast.elevation_m,
        southwest.elevation_m,
        southeast.elevation_m,
        terrainRangeMeters
      )
      const fillColor = terrainElevationToColor(
        averageElevationMeters,
        terrain.min_elevation_m,
        terrain.max_elevation_m,
        lightFactor
      )
      const quad = [
        { ...latLonToWorld(northwest.lat, northwest.lon), y: 0.02 },
        { ...latLonToWorld(northeast.lat, northeast.lon), y: 0.02 },
        { ...latLonToWorld(southeast.lat, southeast.lon), y: 0.02 },
        { ...latLonToWorld(southwest.lat, southwest.lon), y: 0.02 }
      ]

      drawFilledWorldPolygon(quad, rgbToRgbaString(fillColor), TERRAIN_FILL_ALPHA, basis)
    }
  }

  const contourStepMeters = getTerrainContourStep(terrainRangeMeters)
  const contourColor = "rgba(235, 243, 232, 0.22)"

  for (let row = 0; row < terrain.rows; row += 1) {
    for (let column = 0; column < terrain.columns; column += 1) {
      const point = getTerrainPoint(terrain, row, column)
      if (!point) {
        continue
      }

      const pointWorld = latLonToWorld(point.lat, point.lon)
      const pointBand = Math.floor(point.elevation_m / contourStepMeters)

      if (column + 1 < terrain.columns) {
        const east = getTerrainPoint(terrain, row, column + 1)
        if (east && Math.floor(east.elevation_m / contourStepMeters) !== pointBand) {
          const eastWorld = latLonToWorld(east.lat, east.lon)
          drawWorldLine(
            { x: pointWorld.x, y: 0.08, z: pointWorld.z },
            { x: eastWorld.x, y: 0.08, z: eastWorld.z },
            contourColor,
            0.85,
            0.9,
            [],
            basis
          )
        }
      }

      if (row + 1 < terrain.rows) {
        const south = getTerrainPoint(terrain, row + 1, column)
        if (south && Math.floor(south.elevation_m / contourStepMeters) !== pointBand) {
          const southWorld = latLonToWorld(south.lat, south.lon)
          drawWorldLine(
            { x: pointWorld.x, y: 0.08, z: pointWorld.z },
            { x: southWorld.x, y: 0.08, z: southWorld.z },
            contourColor,
            0.85,
            0.9,
            [],
            basis
          )
        }
      }
    }
  }
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
  drawTerrainMap(basis)

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

function getCloudRenderStyle(cover) {
  return METAR_CLOUD_STYLES[normalizeMetarCoverCode(cover)] ?? METAR_CLOUD_STYLES.SCT
}

function drawCloudPuff(projected, radiusX, radiusY, style, opacity) {
  ctx.save()
  ctx.globalAlpha = opacity * 0.2
  ctx.fillStyle = style.underside
  ctx.beginPath()
  ctx.ellipse(
    projected.x,
    projected.y + radiusY * 0.18,
    radiusX * 1.06,
    radiusY * 0.62,
    0,
    0,
    Math.PI * 2
  )
  ctx.fill()

  ctx.globalAlpha = opacity * 0.68
  ctx.fillStyle = style.fill
  ctx.shadowColor = style.glow
  ctx.shadowBlur = clamp(radiusX * 0.6, 3, 10)
  ctx.beginPath()
  ctx.ellipse(projected.x, projected.y, radiusX, radiusY, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawAirportClouds(airport, basis) {
  if (!state.settings.showWeatherOverlay) {
    return
  }

  const cloudLayers = getAirportCloudLayers(airport).slice(0, 3)
  if (!cloudLayers.length) {
    return
  }

  const airportWorld = latLonToWorld(airport.lat, airport.lon)

  cloudLayers.forEach((layer, layerIndex) => {
    const style = getCloudRenderStyle(layer.cover)
    const baseMeters = Number.isFinite(layer?.base_m_agl) ? layer.base_m_agl : 900 + layerIndex * 450
    const layerWorldY = Math.max(12, altitudeToWorld(baseMeters, false))
    const sprites = []

    for (
      let patternIndex = 0;
      patternIndex < Math.min(style.puffCount, CLOUD_PUFF_PATTERN.length);
      patternIndex += 1
    ) {
      const pattern = CLOUD_PUFF_PATTERN[patternIndex]
      const worldPoint = {
        x: airportWorld.x + pattern.x * style.spreadWorld,
        y: layerWorldY + pattern.lift * style.layerDepthWorld,
        z: airportWorld.z + pattern.z * style.spreadWorld
      }
      const cameraPoint = worldToCamera(worldPoint, basis)

      if (cameraPoint.z < NEAR_PLANE) {
        continue
      }

      const projected = projectPoint(cameraPoint)
      const radiusX = clamp(projected.scale * style.radius * pattern.size, 7, 36)
      const radiusY = radiusX * style.squash
      const depthFade = clamp(1 - cameraPoint.z / 1300, 0.28, 1)

      sprites.push({
        depth: cameraPoint.z,
        projected,
        radiusX,
        radiusY,
        opacity: style.alpha * pattern.opacity * depthFade
      })
    }

    sprites.sort((left, right) => right.depth - left.depth)
    sprites.forEach((sprite) => {
      drawCloudPuff(sprite.projected, sprite.radiusX, sprite.radiusY, style, sprite.opacity)
    })

    const label = formatCloudLayerTag(layer)
    const labelPoint = projectWorldPoint(
      {
        x: airportWorld.x + style.spreadWorld * 1.24,
        y: layerWorldY + style.layerDepthWorld + 1.4,
        z: airportWorld.z - style.spreadWorld * 0.28
      },
      basis
    )

    if (label && labelPoint) {
      ctx.save()
      ctx.globalAlpha = 0.92
      ctx.fillStyle = style.label
      ctx.font = "600 11px 'Trebuchet MS', sans-serif"
      ctx.fillText(label, labelPoint.x + 6, labelPoint.y - 3)
      ctx.restore()
    }
  })
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

  const trailColor = getFlightColorTheme(flight).trail

  for (let index = 1; index < flight.trail.length; index += 1) {
    const previous = flight.trail[index - 1]
    const current = flight.trail[index]
    const alpha = 0.16 + (index / flight.trail.length) * 0.44
    drawWorldLine(previous, current, trailColor, 1, alpha, [], basis)
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

function isConflictHighlightedFlight(flight) {
  return flight.is_conflict_highlight || state.highlightedConflictIcaos.has(flight.icao24)
}

function getTrailAltitudeDeltaMeters(trail) {
  if (!trail || trail.length < 2) {
    return null
  }

  const previous = trail[trail.length - 2]
  const current = trail[trail.length - 1]
  return (current.altitude_m ?? 0) - (previous.altitude_m ?? 0)
}

function getFlightColorTheme(flight) {
  if (flight.icao24 === state.searchHighlightIcao) {
    return FLIGHT_COLOR_THEMES.search
  }

  if (isConflictHighlightedFlight(flight)) {
    return FLIGHT_COLOR_THEMES.conflict
  }

  if (flight.on_ground) {
    return FLIGHT_COLOR_THEMES.ground
  }

  const altitudeDeltaMeters = getTrailAltitudeDeltaMeters(flight.trail)
  if (altitudeDeltaMeters == null || Math.abs(altitudeDeltaMeters) < LEVEL_ALTITUDE_DELTA_THRESHOLD_M) {
    return FLIGHT_COLOR_THEMES.level
  }

  return altitudeDeltaMeters > 0
    ? FLIGHT_COLOR_THEMES.ascending
    : FLIGHT_COLOR_THEMES.descending
}

function getAircraftPalette(flight) {
  return getFlightColorTheme(flight)
}

function buildAircraftFaces(flight, basis) {
  const headingRadians = ((flight.display_heading_deg ?? 0) * Math.PI) / 180
  const pitchRadians = flight.on_ground ? 0 : flight.display_pitch_rad ?? 0
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
  const isConflictFlight = isConflictHighlightedFlight(flight)
  const colorTheme = getFlightColorTheme(flight)

  drawWorldLine(
    { x: flight.world.x, y: 0, z: flight.world.z },
    flight.world,
    colorTheme.line,
    1.2,
    isConflictFlight ? 0.9 : flight.on_ground ? 0.55 : 0.7,
    isConflictFlight ? [4, 3] : flight.on_ground ? [4, 5] : [7, 6],
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
    ctx.fillStyle = isConflictFlight ? "#ffd7d7" : "#eff7fb"
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
  const panelWidth = 126
  const panelHeight = 62
  const compassCenterX = state.width - 84
  const compassRadius = 34
  const compassHalo = 18
  const gap = 16
  const compassLeftEdge = compassCenterX - (compassRadius + compassHalo)
  const panelX = compassLeftEdge - gap - panelWidth
  const panelY = 42

  ctx.save()
  ctx.fillStyle = "rgba(5, 16, 24, 0.55)"
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight)
  ctx.fillStyle = "#eff7fb"
  ctx.font = "600 12px 'Trebuchet MS', sans-serif"
  ctx.fillText("Altitude Up", panelX + 14, panelY + 22)
  ctx.fillStyle = "#ffcf72"
  ctx.fillRect(panelX + 14, panelY + 34, 18, 3)
  ctx.fillStyle = "#55d6ff"
  ctx.fillRect(panelX + 14, panelY + 46, 18, 3)
  ctx.fillStyle = "#9eb7c6"
  ctx.font = "12px 'Trebuchet MS', sans-serif"
  ctx.fillText("Airport", panelX + 40, panelY + 40)
  ctx.fillText("Aircraft", panelX + 40, panelY + 52)
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

function render(timestampMs = 0) {
  if (disposed) {
    return
  }

  const deltaMs =
    state.lastFrameTimeMs == null ? 16.67 : clamp(timestampMs - state.lastFrameTimeMs, 0, 40)
  state.lastFrameTimeMs = timestampMs
  applyKeyboardPan(deltaMs)

  drawBackground()

  const basis = getCameraBasis()
  updateHoveredFlightFromPointer(basis)
  drawSectorPlane(basis)
  const placedRunwayLabels = []
  state.runways.forEach((runway) => drawRunway(runway, basis, placedRunwayLabels))
  state.airports.forEach((airport) => drawAirportClouds(airport, basis))
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

function scheduleRefresh(delayMs = getAutoRefreshIntervalMs()) {
  if (disposed) {
    return
  }

  clearScheduledRefresh()

  if (!state.settings.autoRefreshEnabled) {
    return
  }

  state.refreshTimer = window.setTimeout(() => {
    state.refreshTimer = null

    if (!state.settings.autoRefreshEnabled) {
      return
    }

    fetchTraffic()
  }, delayMs)
}

function upsertTrail(flight) {
  const existingTrail = state.trails.get(flight.icao24) || []
  const nextPoint = {
    x: flight.world.x,
    y: flight.world.y,
    z: flight.world.z,
    altitude_m: flight.altitude_m ?? 0
  }
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
  state.terrain = payload.terrain || state.terrain
  state.refreshIntervalMs = payload.refresh_interval_ms || state.refreshIntervalMs
  state.lastUpdatedMs = Date.now()
  state.lastOpenSkyTime = payload.opensky_time || null
  state.sourceModeText = payload.source?.label || "OpenSky"
  state.liveFlightsRaw = payload.flights || []

  const noteParts = []

  if (payload.warning) {
    noteParts.push(payload.warning)
  } else if (payload.source?.rate_limit_remaining != null) {
    noteParts.push(`OpenSky credits remaining: ${payload.source.rate_limit_remaining}`)
  } else {
    noteParts.push(
      `Live sector centered on ${state.region.name}. OpenSky snapshot time: ${payload.opensky_time || "n/a"}.`
    )
  }

  if (payload.weather_warning) {
    noteParts.push(payload.weather_warning)
  }

  if (payload.terrain_warning) {
    noteParts.push(payload.terrain_warning)
  }

  state.feedNoteText = noteParts.join(" ")

  updateAirportList()
  refreshDisplayedFlights()
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
  addManagedListener(terrainToggle, "change", () => {
    state.settings.showTerrainMap = terrainToggle.checked
    saveSettings()
    updateSettingsControls()
  })
  addManagedListener(weatherToggle, "change", () => {
    state.settings.showWeatherOverlay = weatherToggle.checked
    saveSettings()
    updateSettingsControls()
    updateAirportList()
  })
  addManagedListener(autoRefreshToggle, "change", () => {
    state.settings.autoRefreshEnabled = autoRefreshToggle.checked
    saveSettings()
    updateSettingsControls()
    scheduleRefresh()
  })
  addManagedListener(autoRefreshRateInput, "change", commitAutoRefreshRate)
  addManagedListener(autoRefreshRateInput, "blur", commitAutoRefreshRate)
  addManagedListener(injectConflictButton, "click", () => {
    injectConflictScenario()
  })
  addManagedListener(refreshButton, "click", () => {
    fetchTraffic()
  })
  addManagedListener(flightSearchForm, "submit", (event) => {
    event.preventDefault()
    searchForFlight()
  })
  addManagedListener(flightSearchInput, "focus", () => {
    if (flightSearchInput.classList.contains("search-input-error")) {
      clearFlightSearchError(true)
    }
  })
  addManagedListener(flightSearchInput, "input", () => {
    clearFlightSearchError(false)
  })
  addManagedListener(toastAlert, "click", () => {
    hideToastAlert()
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
    clearPressedPanKeys()
  })
  addManagedListener(window, "keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
      return
    }

    if (
      event.code !== "ArrowLeft" &&
      event.code !== "ArrowRight" &&
      event.code !== "ArrowUp" &&
      event.code !== "ArrowDown" &&
      event.code !== "KeyW" &&
      event.code !== "KeyA" &&
      event.code !== "KeyS" &&
      event.code !== "KeyD" &&
      event.code !== "KeyQ" &&
      event.code !== "KeyE" &&
      event.code !== "KeyI" &&
      event.code !== "KeyO"
    ) {
      return
    }

    event.preventDefault()
    state.pressedPanKeys.add(event.code)
  })
  addManagedListener(window, "keyup", (event) => {
    if (
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "KeyW" ||
      event.code === "KeyA" ||
      event.code === "KeyS" ||
      event.code === "KeyD" ||
      event.code === "KeyQ" ||
      event.code === "KeyE" ||
      event.code === "KeyI" ||
      event.code === "KeyO"
    ) {
      state.pressedPanKeys.delete(event.code)
    }
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
  resetFlightSearchInput()
  updateSettingsControls()
  updateAirportList()
  updateFlightList()
  renderAdvisories()
  updateHud()
  setStatus("Idle", "pending")
  bindEvents()
  animationFrameId = requestAnimationFrame(render)
}
