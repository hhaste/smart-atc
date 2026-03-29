"use client"

import { useEffect, useRef, useState } from "react"

import { mountFlightViewer } from "../lib/flight-viewer-runtime"

const LIVE_ATC_STREAM_URL = "https://d.liveatc.net/kdtw_app"

export default function FlightViewerClient() {
  const canvasRef = useRef(null)
  const audioRef = useRef(null)
  const refreshButtonRef = useRef(null)
  const injectConflictButtonRef = useRef(null)
  const statusBadgeRef = useRef(null)
  const flightCountRef = useRef(null)
  const lastUpdatedRef = useRef(null)
  const flightListRef = useRef(null)
  const feedNoteRef = useRef(null)
  const flightSearchFormRef = useRef(null)
  const flightSearchInputRef = useRef(null)
  const hudPanelRef = useRef(null)
  const collapseButtonRef = useRef(null)
  const terrainToggleRef = useRef(null)
  const weatherToggleRef = useRef(null)
  const autoRefreshToggleRef = useRef(null)
  const autoRefreshRateInputRef = useRef(null)
  const hoverCardRef = useRef(null)
  const toastAlertRef = useRef(null)
  const [isAudioMuted, setIsAudioMuted] = useState(true)

  useEffect(() => {
    const cleanup = mountFlightViewer({
      canvas: canvasRef.current,
      refreshButton: refreshButtonRef.current,
      injectConflictButton: injectConflictButtonRef.current,
      statusBadge: statusBadgeRef.current,
      flightCount: flightCountRef.current,
      lastUpdated: lastUpdatedRef.current,
      flightList: flightListRef.current,
      feedNote: feedNoteRef.current,
      flightSearchForm: flightSearchFormRef.current,
      flightSearchInput: flightSearchInputRef.current,
      hudPanel: hudPanelRef.current,
      collapseButton: collapseButtonRef.current,
      terrainToggle: terrainToggleRef.current,
      weatherToggle: weatherToggleRef.current,
      autoRefreshToggle: autoRefreshToggleRef.current,
      autoRefreshRateInput: autoRefreshRateInputRef.current,
      hoverCard: hoverCardRef.current,
      toastAlert: toastAlertRef.current
    })

    return cleanup
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    audio.muted = true

    const playPromise = audio.play()
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {})
    }
  }, [])

  async function handleAudioToggle() {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    if (isAudioMuted) {
      audio.muted = false

      try {
        await audio.play()
        setIsAudioMuted(false)
      } catch {
        audio.muted = true
        setIsAudioMuted(true)
      }

      return
    }

    audio.muted = true
    setIsAudioMuted(true)
  }

  return (
    <div className="app-shell">
      <canvas
        ref={canvasRef}
        id="sceneCanvas"
        aria-label="3D live Detroit-area flight viewer"
      />

      <aside ref={hudPanelRef} id="hudPanel" className="hud">
        <div className="hud-header">
          <div className="hud-title">
            <p className="eyebrow">Live ADS-B Sector</p>
            <h1>Detroit Approach 134.3</h1>
          </div>
          <div className="hud-header-controls">
            <button
              className={`audio-toggle${isAudioMuted ? " is-muted" : ""}`}
              type="button"
              onClick={handleAudioToggle}
              aria-label={isAudioMuted ? "Unmute ATC audio" : "Mute ATC audio"}
              aria-pressed={!isAudioMuted}
              title={isAudioMuted ? "Unmute ATC audio" : "Mute ATC audio"}
            >
              {isAudioMuted ? "🔇" : "🔊"}
            </button>
            <button
              ref={collapseButtonRef}
              id="collapseButton"
              className="collapse-button"
              type="button"
              aria-expanded="true"
              aria-label="Collapse panel"
            >
              <span className="collapse-button-icon" aria-hidden="true">
                ⌃
              </span>
            </button>
          </div>
        </div>

        <form
          ref={flightSearchFormRef}
          id="flightSearchForm"
          className="flight-search"
          role="search"
        >
          <span className="flight-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            ref={flightSearchInputRef}
            id="flightSearchInput"
            className="flight-search-input"
            type="search"
            placeholder="Search for an aircraft"
            autoComplete="off"
            spellCheck="false"
            aria-label="Search for a flight in view"
          />
        </form>

        <div id="hudContent" className="hud-content">
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
              className="secondary-action danger-action"
              type="button"
            >
              Conflict
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
              <span className="stat-label">Last Update</span>
              <strong ref={lastUpdatedRef} id="lastUpdated" className="stat-value">
                Waiting
              </strong>
            </div>
          </div>

          <div className="panel-grid">
            <section className="panel" aria-labelledby="display-heading">
              <h2 id="display-heading">Display</h2>
              <label className="toggle-row">
                <input
                  ref={terrainToggleRef}
                  id="terrainToggle"
                  type="checkbox"
                />
                Terrain map
              </label>
              <label className="toggle-row">
                <input
                  ref={weatherToggleRef}
                  id="weatherToggle"
                  type="checkbox"
                  defaultChecked
                />
                Cloud cover
              </label>
              <label className="toggle-row">
                <input
                  ref={autoRefreshToggleRef}
                  id="autoRefreshToggle"
                  type="checkbox"
                />
                Auto refresh
              </label>
              <label className="setting-row" htmlFor="autoRefreshRateInput">
                <span className="setting-label">Interval</span>
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
      <audio
        ref={audioRef}
        src={LIVE_ATC_STREAM_URL}
        autoPlay
        muted
        playsInline
        preload="none"
        aria-hidden="true"
      />
    </div>
  )
}
