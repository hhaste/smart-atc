import runwaysData from "../data/runways.json"

const EARTH_RADIUS_M = 6_371_000
const OPENSKY_API_ROOT = "https://opensky-network.org/api"
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
const OPENSKY_USER_AGENT = "MichiganThumbTrafficViewer/1.0"
const AVIATION_WEATHER_API_ROOT = "https://aviationweather.gov/api/data"
const USGS_ELEVATION_API_ROOT =
  "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer"
const REGISTRY_API_ROOT = "https://hexdb.io/api/v1"
const TOKEN_REFRESH_MARGIN_SECONDS = 30
const SECTOR_PADDING_M = 15_000
const MAX_STALENESS_SECONDS = 90
const REGISTRY_LOOKUP_TIMEOUT_MS = 2500
const METAR_LOOKUP_TIMEOUT_MS = 2500
const TERRAIN_LOOKUP_TIMEOUT_MS = 4000
const REGISTRY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REGISTRY_NEGATIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const REGISTRY_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000
const METAR_CACHE_TTL_MS = 2 * 60 * 1000
const METAR_FAILURE_CACHE_TTL_MS = 60 * 1000
const TERRAIN_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000
const TERRAIN_FAILURE_CACHE_TTL_MS = 30 * 60 * 1000
const TERRAIN_GRID_COLUMNS = 13
const TERRAIN_GRID_ROWS = 13
const REGISTRY_LOOKUPS_PER_REQUEST = Math.max(
  0,
  Number.parseInt(process.env.REGISTRY_LOOKUPS_PER_REQUEST ?? "4", 10) || 4
)

const AIRCRAFT_CATEGORIES = {
  0: "Not published by feed",
  1: "No ADS-B category info",
  2: "Light",
  3: "Small",
  4: "Large",
  5: "High Vortex Large",
  6: "Heavy",
  7: "High Performance",
  8: "Rotorcraft",
  9: "Glider",
  10: "Lighter-than-air",
  11: "Parachutist / Skydiver",
  12: "Ultralight",
  13: "Reserved",
  14: "Unmanned Aerial Vehicle",
  15: "Space / Trans-atmospheric",
  16: "Surface Emergency Vehicle",
  17: "Surface Service Vehicle",
  18: "Point Obstacle",
  19: "Cluster Obstacle",
  20: "Line Obstacle"
}

const AIRPORTS = [
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

function hasOpenSkyCredentials() {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
}

function defaultRefreshIntervalMs() {
  const rawValue = process.env.FLIGHT_REFRESH_INTERVAL_MS
  if (rawValue) {
    return Math.max(5000, Number.parseInt(rawValue, 10))
  }

  return hasOpenSkyCredentials() ? 10_000 : 30_000
}

function metersToLatDegrees(meters) {
  return meters / 111_320
}

function metersToLonDegrees(meters, latitudeDegrees) {
  return meters / (111_320 * Math.cos((latitudeDegrees * Math.PI) / 180))
}

function computeRegion(airports) {
  const averageLat = airports.reduce((sum, airport) => sum + airport.lat, 0) / airports.length
  const averageLon = airports.reduce((sum, airport) => sum + airport.lon, 0) / airports.length

  const localPoints = airports.map((airport) => {
    const eastMeters =
      ((airport.lon - averageLon) * Math.PI * EARTH_RADIUS_M * Math.cos((averageLat * Math.PI) / 180)) /
      180
    const northMeters = ((airport.lat - averageLat) * Math.PI * EARTH_RADIUS_M) / 180
    return [eastMeters, northMeters]
  })

  const minEast = Math.min(...localPoints.map((point) => point[0]))
  const maxEast = Math.max(...localPoints.map((point) => point[0]))
  const minNorth = Math.min(...localPoints.map((point) => point[1]))
  const maxNorth = Math.max(...localPoints.map((point) => point[1]))

  const sideM = Math.max(maxEast - minEast, maxNorth - minNorth) + 2 * SECTOR_PADDING_M
  const centerEast = (minEast + maxEast) * 0.5
  const centerNorth = (minNorth + maxNorth) * 0.5
  const centerLat = averageLat + metersToLatDegrees(centerNorth)
  const centerLon = averageLon + metersToLonDegrees(centerEast, averageLat)
  const halfSideM = sideM * 0.5

  return {
    name: "Detroit Approach",
    center_lat: centerLat,
    center_lon: centerLon,
    side_m: sideM,
    bbox: {
      lamin: centerLat - metersToLatDegrees(halfSideM),
      lamax: centerLat + metersToLatDegrees(halfSideM),
      lomin: centerLon - metersToLonDegrees(halfSideM, averageLat),
      lomax: centerLon + metersToLonDegrees(halfSideM, averageLat)
    }
  }
}

function loadRunways(payload) {
  if (!payload || !Array.isArray(payload.runways) || payload.runways.length === 0) {
    throw new Error("Runway data is missing or invalid")
  }

  return payload
}

function cleanText(value) {
  if (typeof value !== "string") {
    return null
  }

  const cleaned = value.trim()
  return cleaned || null
}

function normalizeUpperText(value) {
  const cleaned = cleanText(value)
  return cleaned ? cleaned.toUpperCase() : null
}

function normalizeNumber(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeAltimeterInHg(value) {
  const numericValue = normalizeNumber(value)
  if (numericValue == null) {
    return null
  }

  // NOAA values may arrive in hPa/mb rather than inches of mercury.
  return numericValue > 100 ? numericValue * 0.0295299830714 : numericValue
}

function feetToMeters(feet) {
  return feet * 0.3048
}

function averageNumbers(values, fallback = 0) {
  const validValues = values.filter((value) => Number.isFinite(value))
  if (!validValues.length) {
    return fallback
  }

  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length
}

async function readResponseDetail(response) {
  const text = (await response.text()).trim()
  return text ? text.slice(0, 200) : "no detail"
}

function withTimeout(ms) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  }
}

const REGION = computeRegion(AIRPORTS)
const REFRESH_INTERVAL_MS = defaultRefreshIntervalMs()
const RUNWAY_DATA = loadRunways(runwaysData)

class OpenSkyClient {
  constructor() {
    this.clientId = process.env.OPENSKY_CLIENT_ID ?? null
    this.clientSecret = process.env.OPENSKY_CLIENT_SECRET ?? null
    this.token = null
    this.tokenExpiry = 0
  }

  get mode() {
    return this.clientId && this.clientSecret ? "oauth" : "anonymous"
  }

  async authHeaders() {
    const headers = {
      "User-Agent": OPENSKY_USER_AGENT
    }
    const token = await this.getToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }

  async getToken() {
    if (!this.clientId || !this.clientSecret) {
      return null
    }

    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    })

    const response = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OPENSKY_USER_AGENT
      },
      body,
      cache: "no-store"
    })

    if (!response.ok) {
      const detail = await readResponseDetail(response)
      throw new Error(`OpenSky token request failed with HTTP ${response.status}: ${detail}`)
    }

    const payload = await response.json()
    const expiresIn = Number.parseInt(payload.expires_in ?? "1800", 10)
    this.token = payload.access_token
    this.tokenExpiry = Date.now() + Math.max(1000, (expiresIn - TOKEN_REFRESH_MARGIN_SECONDS) * 1000)
    return this.token
  }

  async fetchStates() {
    const params = new URLSearchParams({
      lamin: String(REGION.bbox.lamin),
      lamax: String(REGION.bbox.lamax),
      lomin: String(REGION.bbox.lomin),
      lomax: String(REGION.bbox.lomax),
      extended: "1"
    })

    const response = await fetch(`${OPENSKY_API_ROOT}/states/all?${params.toString()}`, {
      method: "GET",
      headers: await this.authHeaders(),
      cache: "no-store"
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(
          "OpenSky rate limit reached. Slow the refresh interval or configure OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET."
        )
      }

      if (response.status === 401) {
        throw new Error(
          "OpenSky authentication failed. Check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET."
        )
      }

      const detail = await readResponseDetail(response)
      throw new Error(`OpenSky request failed with HTTP ${response.status}: ${detail}`)
    }

    return {
      payload: await response.json(),
      headers: {
        "x-rate-limit-remaining": response.headers.get("x-rate-limit-remaining")
      }
    }
  }
}

class AircraftRegistryClient {
  constructor() {
    this.cache = new Map()
  }

  getCached(icao24) {
    const key = icao24.trim().toLowerCase()
    const entry = this.cache.get(key)
    if (!entry) {
      return { payload: null, hit: false }
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key)
      return { payload: null, hit: false }
    }

    return { payload: entry.payload, hit: true }
  }

  store(icao24, payload, ttlMs) {
    this.cache.set(icao24.trim().toLowerCase(), {
      payload,
      expiresAt: Date.now() + ttlMs
    })
  }

  async lookup(icao24) {
    const key = icao24.trim().toLowerCase()
    const cached = this.getCached(key)
    if (cached.hit) {
      return cached.payload
    }

    const timeout = withTimeout(REGISTRY_LOOKUP_TIMEOUT_MS)

    try {
      const response = await fetch(`${REGISTRY_API_ROOT}/aircraft/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: {
          "User-Agent": OPENSKY_USER_AGENT
        },
        cache: "no-store",
        signal: timeout.signal
      })

      if (response.status === 404) {
        this.store(key, null, REGISTRY_NEGATIVE_CACHE_TTL_MS)
        return null
      }

      if (!response.ok) {
        this.store(key, null, REGISTRY_FAILURE_CACHE_TTL_MS)
        return null
      }

      const payload = await response.json()
      const metadata = {
        aircraft_type_name: cleanText(payload.Type),
        aircraft_type_code: cleanText(payload.ICAOTypeCode),
        manufacturer: cleanText(payload.Manufacturer),
        registration: cleanText(payload.Registration),
        registered_owner: cleanText(payload.RegisteredOwners),
        operator_flag_code: cleanText(payload.OperatorFlagCode),
        registry_source: "hexdb.io"
      }

      if (!Object.entries(metadata).some(([keyName, value]) => keyName !== "registry_source" && value)) {
        this.store(key, null, REGISTRY_NEGATIVE_CACHE_TTL_MS)
        return null
      }

      this.store(key, metadata, REGISTRY_CACHE_TTL_MS)
      return metadata
    } catch {
      this.store(key, null, REGISTRY_FAILURE_CACHE_TTL_MS)
      return null
    } finally {
      timeout.clear()
    }
  }
}

class MetarClient {
  constructor() {
    this.cache = new Map()
  }

  getCached(idsKey) {
    const entry = this.cache.get(idsKey)
    if (!entry) {
      return { payload: null, hit: false, stale: null }
    }

    if (entry.expiresAt <= Date.now()) {
      return { payload: null, hit: false, stale: entry.payload }
    }

    return { payload: entry.payload, hit: true, stale: entry.payload }
  }

  store(idsKey, payload, ttlMs) {
    this.cache.set(idsKey, {
      payload,
      expiresAt: Date.now() + ttlMs
    })
  }

  async fetchLatest(airports) {
    const ids = airports
      .map((airport) => normalizeUpperText(airport.code))
      .filter(Boolean)
      .join(",")

    if (!ids) {
      return {
        metars: new Map(),
        warning: null
      }
    }

    const cached = this.getCached(ids)
    if (cached.hit) {
      return {
        metars: cached.payload,
        warning: null
      }
    }

    const timeout = withTimeout(METAR_LOOKUP_TIMEOUT_MS)

    try {
      const params = new URLSearchParams({
        ids,
        format: "json"
      })
      const response = await fetch(`${AVIATION_WEATHER_API_ROOT}/metar?${params.toString()}`, {
        method: "GET",
        headers: {
          "User-Agent": OPENSKY_USER_AGENT
        },
        cache: "no-store",
        signal: timeout.signal
      })

      if (!response.ok) {
        const detail = await readResponseDetail(response)
        throw new Error(`METAR request failed with HTTP ${response.status}: ${detail}`)
      }

      const payload = await response.json()
      const metars = new Map()

      for (const record of Array.isArray(payload) ? payload : []) {
        const normalized = normalizeMetarRecord(record)
        if (normalized) {
          metars.set(normalized.station_code, normalized)
        }
      }

      this.store(ids, metars, METAR_CACHE_TTL_MS)
      return {
        metars,
        warning: null
      }
    } catch {
      if (cached.stale) {
        this.store(ids, cached.stale, METAR_FAILURE_CACHE_TTL_MS)
        return {
          metars: cached.stale,
          warning: "METAR refresh unavailable. Showing the last cached cloud layers."
        }
      }

      const emptyMetars = new Map()
      this.store(ids, emptyMetars, METAR_FAILURE_CACHE_TTL_MS)
      return {
        metars: emptyMetars,
        warning: "METAR refresh unavailable right now."
      }
    } finally {
      timeout.clear()
    }
  }
}

class TerrainClient {
  constructor() {
    this.cache = null
  }

  getCached() {
    if (!this.cache) {
      return { payload: null, hit: false, stale: null }
    }

    if (this.cache.expiresAt <= Date.now()) {
      return { payload: null, hit: false, stale: this.cache.payload }
    }

    return { payload: this.cache.payload, hit: true, stale: this.cache.payload }
  }

  store(payload, ttlMs) {
    this.cache = {
      payload,
      expiresAt: Date.now() + ttlMs
    }
  }

  async fetchRegion(region) {
    const cached = this.getCached()
    if (cached.hit) {
      return {
        terrain: cached.payload,
        warning: null
      }
    }

    const timeout = withTimeout(TERRAIN_LOOKUP_TIMEOUT_MS)

    try {
      const points = buildTerrainSamplingPoints(region, TERRAIN_GRID_ROWS, TERRAIN_GRID_COLUMNS)
      const body = new URLSearchParams({
        geometryType: "esriGeometryMultipoint",
        geometry: JSON.stringify({
          points: points.map((point) => [point.lon, point.lat]),
          spatialReference: {
            wkid: 4326
          }
        }),
        returnFirstValueOnly: "true",
        interpolation: "RSP_BilinearInterpolation",
        f: "json"
      })

      const response = await fetch(`${USGS_ELEVATION_API_ROOT}/getSamples`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": OPENSKY_USER_AGENT
        },
        body,
        cache: "no-store",
        signal: timeout.signal
      })

      if (!response.ok) {
        const detail = await readResponseDetail(response)
        throw new Error(`Terrain request failed with HTTP ${response.status}: ${detail}`)
      }

      const payload = await response.json()
      const terrain = normalizeTerrainGrid(points, payload?.samples)
      this.store(terrain, TERRAIN_CACHE_TTL_MS)

      return {
        terrain,
        warning: null
      }
    } catch {
      if (cached.stale) {
        this.store(cached.stale, TERRAIN_FAILURE_CACHE_TTL_MS)
        return {
          terrain: cached.stale,
          warning: "Terrain refresh unavailable. Showing the last cached terrain map."
        }
      }

      return {
        terrain: null,
        warning: "Terrain data unavailable right now."
      }
    } finally {
      timeout.clear()
    }
  }
}

const OPENSKY = new OpenSkyClient()
const REGISTRY = new AircraftRegistryClient()
const METAR = new MetarClient()
const TERRAIN = new TerrainClient()

function normalizeFlights(rawStates) {
  const flights = []
  const currentTime = Math.floor(Date.now() / 1000)
  const bbox = REGION.bbox

  for (const row of rawStates ?? []) {
    if (!Array.isArray(row) || row.length < 17) {
      continue
    }

    const longitude = row[5]
    const latitude = row[6]
    const lastContact = row[4]

    if (latitude == null || longitude == null || lastContact == null) {
      continue
    }

    if (
      latitude < bbox.lamin ||
      latitude > bbox.lamax ||
      longitude < bbox.lomin ||
      longitude > bbox.lomax
    ) {
      continue
    }

    const ageSeconds = currentTime - Number.parseInt(String(lastContact), 10)
    if (ageSeconds > MAX_STALENESS_SECONDS) {
      continue
    }

    const baroAltitude = row[7]
    const geoAltitude = row[13]
    const onGround = Boolean(row[8])
    const altitudeM = onGround ? 0 : Number(geoAltitude ?? baroAltitude ?? 0)
    const category = row.length > 17 && row[17] != null ? Number.parseInt(String(row[17]), 10) : null
    const categoryLabel =
      category == null ? "Category unavailable" : AIRCRAFT_CATEGORIES[category] ?? "Not published by feed"

    flights.push({
      icao24: row[0],
      callsign: typeof row[1] === "string" ? row[1].trim() : "",
      origin_country: row[2],
      last_contact: Number.parseInt(String(lastContact), 10),
      age_s: ageSeconds,
      lon: Number(longitude),
      lat: Number(latitude),
      baro_altitude_m: baroAltitude != null ? Number(baroAltitude) : null,
      geo_altitude_m: geoAltitude != null ? Number(geoAltitude) : null,
      altitude_m: altitudeM,
      on_ground: onGround,
      velocity_mps: row[9] != null ? Number(row[9]) : null,
      track_deg: row[10] != null ? Number(row[10]) : null,
      vertical_rate_mps: row[11] != null ? Number(row[11]) : null,
      squawk: row[14],
      position_source: row[16],
      category,
      category_label: categoryLabel,
      type_label: categoryLabel,
      aircraft_type_name: null,
      aircraft_type_code: null,
      manufacturer: null,
      registration: null,
      registered_owner: null,
      operator_flag_code: null,
      registry_source: null,
      code_display:
        typeof row[1] === "string" && row[1].trim() ? row[1].trim() : String(row[0]).toUpperCase()
    })
  }

  flights.sort((left, right) => {
    if (left.on_ground !== right.on_ground) {
      return Number(left.on_ground) - Number(right.on_ground)
    }

    return right.altitude_m - left.altitude_m
  })

  return flights
}

async function enrichFlightsWithRegistry(flights) {
  let remainingLookups = REGISTRY_LOOKUPS_PER_REQUEST

  for (const flight of flights) {
    const cached = REGISTRY.getCached(String(flight.icao24))
    let metadata = cached.payload

    if (!cached.hit && remainingLookups > 0) {
      metadata = await REGISTRY.lookup(String(flight.icao24))
      remainingLookups -= 1
    }

    if (metadata) {
      Object.assign(flight, metadata)
    }
  }

  return flights
}

function normalizeMetarCloudLayer(layer) {
  const cover = normalizeUpperText(layer?.cover)
  if (!cover) {
    return null
  }

  const baseFeet = normalizeNumber(layer?.base)

  return {
    cover,
    base_ft_agl: baseFeet == null ? null : Math.round(baseFeet),
    base_m_agl: baseFeet == null ? null : Math.round(feetToMeters(baseFeet))
  }
}

function normalizeMetarRecord(record) {
  const stationCode = normalizeUpperText(record?.icaoId)
  if (!stationCode) {
    return null
  }

  const clouds = Array.isArray(record?.clouds)
    ? record.clouds.map((layer) => normalizeMetarCloudLayer(layer)).filter(Boolean)
    : []

  return {
    station_code: stationCode,
    raw_text: cleanText(record?.rawOb),
    report_time_iso: cleanText(record?.reportTime) ?? cleanText(record?.receiptTime),
    observed_time_unix: normalizeNumber(record?.obsTime),
    flight_category: normalizeUpperText(record?.fltCat),
    cover: normalizeUpperText(record?.cover),
    visibility_sm: cleanText(record?.visib),
    wind_dir_deg: normalizeNumber(record?.wdir),
    wind_speed_kt: normalizeNumber(record?.wspd),
    temperature_c: normalizeNumber(record?.temp),
    dewpoint_c: normalizeNumber(record?.dewp),
    altimeter_in_hg: normalizeAltimeterInHg(record?.altim),
    weather_text: cleanText(record?.wxString),
    precip_in: normalizeNumber(record?.precip),
    clouds
  }
}

function attachAirportMetars(airports, metars) {
  return airports.map((airport) => ({
    ...airport,
    metar: metars.get(normalizeUpperText(airport.code)) ?? null
  }))
}

function buildTerrainSamplingPoints(region, rows, columns) {
  const latStep = (region.bbox.lamax - region.bbox.lamin) / Math.max(1, rows - 1)
  const lonStep = (region.bbox.lomax - region.bbox.lomin) / Math.max(1, columns - 1)
  const points = []

  for (let row = 0; row < rows; row += 1) {
    const lat = region.bbox.lamax - latStep * row

    for (let column = 0; column < columns; column += 1) {
      points.push({
        row,
        column,
        lat,
        lon: region.bbox.lomin + lonStep * column
      })
    }
  }

  return points
}

function fillMissingTerrainElevations(flatPoints, rowCount, columnCount) {
  const defaultElevation = averageNumbers(
    flatPoints.map((point) => point.elevation_m),
    0
  )

  for (let index = 0; index < flatPoints.length; index += 1) {
    if (Number.isFinite(flatPoints[index].elevation_m)) {
      continue
    }

    const row = Math.floor(index / columnCount)
    const column = index % columnCount
    const neighbors = []

    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        if (!rowOffset && !columnOffset) {
          continue
        }

        const nextRow = row + rowOffset
        const nextColumn = column + columnOffset
        if (
          nextRow < 0 ||
          nextRow >= rowCount ||
          nextColumn < 0 ||
          nextColumn >= columnCount
        ) {
          continue
        }

        const neighbor = flatPoints[nextRow * columnCount + nextColumn]?.elevation_m
        if (Number.isFinite(neighbor)) {
          neighbors.push(neighbor)
        }
      }
    }

    flatPoints[index].elevation_m = averageNumbers(neighbors, defaultElevation)
  }
}

function normalizeTerrainGrid(points, samples) {
  const sampleMap = new Map()

  for (const sample of Array.isArray(samples) ? samples : []) {
    const locationId = Number.parseInt(String(sample?.locationId ?? ""), 10)
    const value = normalizeNumber(sample?.value)

    if (Number.isInteger(locationId) && value != null) {
      sampleMap.set(locationId, value)
    }
  }

  const flatPoints = points.map((point, index) => ({
    lat: point.lat,
    lon: point.lon,
    row: point.row,
    column: point.column,
    elevation_m: sampleMap.get(index) ?? null
  }))

  fillMissingTerrainElevations(flatPoints, TERRAIN_GRID_ROWS, TERRAIN_GRID_COLUMNS)

  const elevations = flatPoints.map((point) => point.elevation_m)

  return {
    provider: "USGS 3DEP",
    rows: TERRAIN_GRID_ROWS,
    columns: TERRAIN_GRID_COLUMNS,
    min_elevation_m: Math.min(...elevations),
    max_elevation_m: Math.max(...elevations),
    points: flatPoints
  }
}

export async function buildFeedPayload() {
  const [{ payload: openskyPayload, headers }, metarSnapshot, terrainSnapshot] = await Promise.all([
    OPENSKY.fetchStates(),
    METAR.fetchLatest(AIRPORTS),
    TERRAIN.fetchRegion(REGION)
  ])
  const flights = await enrichFlightsWithRegistry(normalizeFlights(openskyPayload.states))
  const sourceLabel = OPENSKY.mode === "oauth" ? "OpenSky OAuth" : "OpenSky Anonymous"
  const airports = attachAirportMetars(AIRPORTS, metarSnapshot.metars)

  let warning = null
  if (OPENSKY.mode === "anonymous") {
    warning =
      "Using OpenSky anonymous mode. Public daily credit limits apply. Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET for better limits."
  }

  return {
    region: REGION,
    airports,
    runways: RUNWAY_DATA.runways,
    refresh_interval_ms: REFRESH_INTERVAL_MS,
    server_time: Math.floor(Date.now() / 1000),
    opensky_time: openskyPayload.time,
    flights,
    warning,
    weather_warning: metarSnapshot.warning,
    terrain: terrainSnapshot.terrain,
    terrain_warning: terrainSnapshot.warning,
    source: {
      provider: "OpenSky Network",
      mode: OPENSKY.mode,
      label: sourceLabel,
      rate_limit_remaining: headers["x-rate-limit-remaining"],
      registry_provider: "hexdb.io",
      weather_provider: "NOAA Aviation Weather Center",
      terrain_provider: "USGS 3DEP"
    }
  }
}
