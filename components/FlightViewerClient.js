"use client"

import { useEffect, useRef } from "react"

import { mountFlightViewer } from "../lib/flight-viewer-runtime"

export default function FlightViewerClient() {
  const canvasRef = useRef(null)
  const refreshButtonRef = useRef(null)
  const injectConflictButtonRef = useRef(null)
  const statusBadgeRef = useRef(null)
  const flightCountRef = useRef(null)
  const feedModeRef = useRef(null)
  const lastUpdatedRef = useRef(null)
  const sectorNameRef = useRef(null)
  const airportListRef = useRef(null)
  const flightListRef = useRef(null)
  const feedNoteRef = useRef(null)
  const flightSearchFormRef = useRef(null)
  const flightSearchInputRef = useRef(null)
  const hudPanelRef = useRef(null)
  const collapseButtonRef = useRef(null)
  const hoverDetailsToggleRef = useRef(null)
  const terrainToggleRef = useRef(null)
  const autoRefreshToggleRef = useRef(null)
  const autoRefreshRateInputRef = useRef(null)
  const hoverCardRef = useRef(null)
  const toastAlertRef = useRef(null)

  useEffect(() => {
    const cleanup = mountFlightViewer({
      canvas: canvasRef.current,
      refreshButton: refreshButtonRef.current,
      injectConflictButton: injectConflictButtonRef.current,
      statusBadge: statusBadgeRef.current,
      flightCount: flightCountRef.current,
      feedMode: feedModeRef.current,
      lastUpdated: lastUpdatedRef.current,
      sectorName: sectorNameRef.current,
      airportList: airportListRef.current,
      flightList: flightListRef.current,
      feedNote: feedNoteRef.current,
      flightSearchForm: flightSearchFormRef.current,
      flightSearchInput: flightSearchInputRef.current,
      hudPanel: hudPanelRef.current,
      collapseButton: collapseButtonRef.current,
      hoverDetailsToggle: hoverDetailsToggleRef.current,
      terrainToggle: terrainToggleRef.current,
      autoRefreshToggle: autoRefreshToggleRef.current,
      autoRefreshRateInput: autoRefreshRateInputRef.current,
      hoverCard: hoverCardRef.current,
      toastAlert: toastAlertRef.current
    })

    return cleanup
  }, [])

  return (
    <div className="app-shell">
      <form
        ref={flightSearchFormRef}
        id="flightSearchForm"
        className="flight-search"
        role="search"
      >
        <input
          ref={flightSearchInputRef}
          id="flightSearchInput"
          className="flight-search-input"
          type="search"
          placeholder="Search callsign or ICAO and press Enter"
          autoComplete="off"
          spellCheck="false"
          aria-label="Search for a flight in view"
        />
      </form>

      <canvas
        ref={canvasRef}
        id="sceneCanvas"
        aria-label="3D live Detroit-area flight viewer"
      />

      <aside ref={hudPanelRef} id="hudPanel" className="hud">
        <div className="hud-header">
          <div className="hud-title">
            <p className="eyebrow">Live ADS-B Sector</p>
            <h1>Michigan Airspace</h1>
          </div>
          <button
            ref={collapseButtonRef}
            id="collapseButton"
            className="collapse-button"
            type="button"
            aria-expanded="true"
          >
            Collapse
          </button>
        </div>

        <div id="hudContent" className="hud-content">
          <p className="description">
            Live aircraft inside a square sector covering KDET, KDTW, and KFNT.
            The X/Z plane is the Detroit-area map sector, and altitude is rendered
            upward in 3D. Runway layouts are mapped from FAA runway geometry.
          </p>

          <div className="action-row">
            <button
              ref={refreshButtonRef}
              id="refreshButton"
              className="primary-action"
              type="button"
            >
              Refresh
            </button>
            <button
              ref={injectConflictButtonRef}
              id="injectConflictButton"
              className="secondary-action"
              type="button"
            >
              Inject Conflict
            </button>
            <span
              ref={statusBadgeRef}
              id="statusBadge"
              className="status-badge status-pending"
            >
              Idle
            </span>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Tracked Aircraft</span>
              <strong ref={flightCountRef} id="flightCount" className="stat-value">
                0
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Feed Mode</span>
              <strong ref={feedModeRef} id="feedMode" className="stat-value">
                Waiting
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Last Update</span>
              <strong ref={lastUpdatedRef} id="lastUpdated" className="stat-value">
                Waiting
              </strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Sector</span>
              <strong ref={sectorNameRef} id="sectorName" className="stat-value">
                KDET · KDTW · KFNT
              </strong>
            </div>
          </div>

          <div className="panel-grid">
            <section className="panel" aria-labelledby="airports-heading">
              <h2 id="airports-heading">Airports</h2>
              <ul ref={airportListRef} id="airportList" className="airport-list" />
            </section>

            <section className="panel" aria-labelledby="controls-heading">
              <h2 id="controls-heading">Controls</h2>
              <ul className="control-list">
                <li>
                  <strong>Rotate:</strong> Left-drag, one-finger drag, or Left / Right arrows
                </li>
                <li>
                  <strong>Pan:</strong> Shift-drag, right-drag, two-finger drag, WASD, or Up / Down arrows. Use E / Q for camera up / down.
                </li>
                <li>
                  <strong>Zoom:</strong> Mouse wheel, pinch, or I / O
                </li>
              </ul>
            </section>

            <section className="panel" aria-labelledby="display-heading">
              <h2 id="display-heading">Display</h2>
              <label className="toggle-row">
                <input
                  ref={hoverDetailsToggleRef}
                  id="hoverDetailsToggle"
                  type="checkbox"
                  defaultChecked
                />
                Show aircraft hover details
              </label>
              <label className="toggle-row">
                <input
                  ref={terrainToggleRef}
                  id="terrainToggle"
                  type="checkbox"
                />
                Show terrain map
              </label>
              <label className="toggle-row">
                <input
                  ref={autoRefreshToggleRef}
                  id="autoRefreshToggle"
                  type="checkbox"
                />
                Enable auto refresh
              </label>
              <label className="setting-row" htmlFor="autoRefreshRateInput">
                <span className="setting-label">Refreshes / min</span>
                <input
                  ref={autoRefreshRateInputRef}
                  id="autoRefreshRateInput"
                  className="setting-input"
                  type="number"
                  min="1"
                  max="60"
                  step="1"
                  defaultValue="2"
                  inputMode="numeric"
                />
              </label>
            </section>

            <section className="panel panel-wide" aria-labelledby="aircraft-heading">
              <h2 id="aircraft-heading">Active Aircraft</h2>
              <ol ref={flightListRef} id="flightList" className="flight-list" />
            </section>

            <section className="panel panel-wide" aria-labelledby="notes-heading">
              <h2 id="notes-heading">Feed Notes</h2>
              <p ref={feedNoteRef} id="feedNote" className="feed-note">
                Press Refresh to load the first live traffic snapshot.
              </p>
            </section>
          </div>

          <p className="hint">
            Use Refresh for on-demand updates, or enable auto refresh from Display.
            The live feed is proxied through the Next.js server to avoid browser
            CORS issues.
          </p>
        </div>
      </aside>

      <div
        ref={hoverCardRef}
        id="hoverCard"
        className="hover-card hidden"
        aria-hidden="true"
      />
      <div
        ref={toastAlertRef}
        id="toastAlert"
        className="toast-alert severity-info hidden"
        aria-hidden="true"
      />
    </div>
  )
}
