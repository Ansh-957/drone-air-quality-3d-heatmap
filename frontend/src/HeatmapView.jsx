/*
 * HeatmapView — 3D topographical air quality visualization
 *
 * Renders a smooth, continuous triangulated terrain mesh where:
 *   - X/Y = horizontal position (meters from center)
 *   - Z = air quality value (exaggerated for visibility)
 *   - Color = plasma colormap mapped to the same value
 *
 * Three viewing modes:
 *   MAP     — terrain mesh anchored to real geo-coordinates on a dark basemap
 *   3D LAB  — tilted orbit view, mesh centered at origin
 *   TOP 2D  — top-down orbit view
 *
 * Uses SimpleMeshLayer (not SolidPolygonLayer) to render a smooth surface
 * with per-vertex colors and smooth normals, eliminating the "Minecraft"
 * stepped-block appearance.
 */

import { useState, useEffect, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { OrbitView, COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import axios from "axios";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildTerrainMesh } from "./meshUtils";

// ─── View configurations ───

const MAP_INITIAL_VIEW = {
    longitude: -79.0225,
    latitude: 43.8561,
    zoom: 17,
    pitch: 60,
    bearing: -20,
};

const ORBIT_INITIAL_VIEW = {
    target: [0, 0, 0],
    rotationX: 55,
    rotationOrbit: -30,
    zoom: 1.5,
    minZoom: -2,
    maxZoom: 8,
};

// Top-down MapView: same center as MAP but looking straight down
const TOPDOWN_MAP_VIEW = {
    longitude: -79.0225,
    latitude: 43.8561,
    zoom: 17,
    pitch: 0,
    bearing: 0,
};

// Height exaggeration: (value - minVal) * SCALE = meters of Z displacement.
// The data range is ~21 units (PM2.5), so scale=5 → ~105m max height,
// which is visible but proportional over the ~150m horizontal extent.
const MAP_HEIGHT_SCALE = 5;
const ORBIT_HEIGHT_SCALE = 3;


export default function HeatmapView() {
    const [voxels, setVoxels] = useState([]);
    const [metric, setMetric] = useState("pm25");
    const [viewMode, setViewMode] = useState("map");
    const [altIndex, setAltIndex] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(true);
        axios.get(`http://localhost:8000/heatmap?metric=${metric}`)
            .then(r => {
                setVoxels(r.data.voxels || []);
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to fetch heatmap:", err);
                setLoading(false);
            });
    }, [metric]);

    // Build terrain mesh — positions in meters, centered at (0,0).
    // Map view uses a taller Z exaggeration since it's viewed at distance.
    const heightScale = viewMode === "map" ? MAP_HEIGHT_SCALE : ORBIT_HEIGHT_SCALE;
    const terrainData = useMemo(
        () => buildTerrainMesh(voxels, { altitudeIndex: altIndex, heightScale }),
        [voxels, altIndex, heightScale]
    );

    // Flat mesh for top-down view — heightScale=0 makes it perfectly flat,
    // so the camera sees a clean color map with no 3D relief distortion.
    const flatData = useMemo(
        () => buildTerrainMesh(voxels, { altitudeIndex: altIndex, heightScale: 0 }),
        [voxels, altIndex]
    );

    const { mesh, centerLon, centerLat, minVal, maxVal, alts, selectedAltIndex, triCount } = terrainData;

    // ─── MAP view layer ───
    // The mesh positions are meter offsets from center. SimpleMeshLayer with
    // LNGLAT coordinates places the instance at [lon, lat] and treats the mesh
    // vertex positions as meter offsets via project_size().
    const mapLayers = mesh ? [
        new SimpleMeshLayer({
            id: "terrain-map",
            data: [{ position: [centerLon, centerLat, 0] }],
            mesh: mesh,
            getPosition: d => d.position,
            getColor: [255, 255, 255, 255],
            material: {
                ambient: 0.35,
                diffuse: 0.7,
                shininess: 32,
                specularColor: [180, 180, 180],
            },
            pickable: true,
        }),
    ] : [];

    // ─── ORBIT view layer (3D Lab) ───
    // Same mesh, but positioned at origin in CARTESIAN coordinates.
    // OrbitView handles the camera; no geo-projection needed.
    const orbitLayers = mesh ? [
        new SimpleMeshLayer({
            id: "terrain-orbit",
            data: [{ position: [0, 0, 0] }],
            mesh: mesh,
            getPosition: d => d.position,
            getColor: [255, 255, 255, 255],
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            material: {
                ambient: 0.3,
                diffuse: 0.8,
                shininess: 40,
                specularColor: [200, 200, 200],
            },
            pickable: true,
        }),
    ] : [];

    // ─── TOP-DOWN view layer ───
    // Flat mesh (heightScale=0) georeferenced on the basemap with material:false
    // to disable phong lighting. Shows pure vertex colors as a satellite/EPA-style
    // heatmap overlaid on real street map, viewed from directly above.
    const topdownLayers = flatData.mesh ? [
        new SimpleMeshLayer({
            id: "terrain-topdown",
            data: [{ position: [flatData.centerLon, flatData.centerLat, 0] }],
            mesh: flatData.mesh,
            getPosition: d => d.position,
            getColor: [255, 255, 255, 255],
            material: false, // No lighting — pure vertex colors
            pickable: true,
        }),
    ] : [];

    // ─── Metric labels ───
    const metricUnits = { pm25: "µg/m³", pm10: "µg/m³", temp: "°C" };

    return (
        <div style={{ height: "100vh", width: "100vw", position: "relative" }}>

            {/* ─── Control Panel ─── */}
            <div style={{
                position: "absolute", zIndex: 10, top: 20, left: 20,
                background: "rgba(10, 10, 18, 0.92)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#ddd", padding: "18px 20px", borderRadius: "12px",
                fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
                fontSize: "12px", minWidth: "200px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}>
                <h3 style={{
                    margin: "0 0 14px 0", color: "#fff", fontSize: "13px",
                    letterSpacing: "2px", fontWeight: 600,
                }}>
                    ◈ TELEMETRY LINK
                </h3>

                {/* Metric selector */}
                <label style={{ fontSize: "10px", color: "#888", letterSpacing: "1px" }}>METRIC</label>
                <select
                    id="metric-select"
                    value={metric}
                    onChange={e => setMetric(e.target.value)}
                    style={{
                        width: "100%", padding: "8px 10px", marginBottom: "12px", marginTop: "4px",
                        background: "#111", color: "#0fc", border: "1px solid #333",
                        borderRadius: "6px", fontSize: "12px", cursor: "pointer",
                    }}
                >
                    <option value="pm25">PM2.5 (µg/m³)</option>
                    <option value="pm10">PM10 (µg/m³)</option>
                    <option value="temp">Temperature (°C)</option>
                </select>

                {/* View mode buttons */}
                <label style={{ fontSize: "10px", color: "#888", letterSpacing: "1px" }}>VIEW</label>
                <div style={{ display: "flex", gap: "4px", marginTop: "4px", marginBottom: "14px" }}>
                    {["map", "lab", "topdown"].map(mode => (
                        <button
                            key={mode}
                            id={`view-${mode}`}
                            onClick={() => setViewMode(mode)}
                            style={{
                                flex: 1, padding: "7px 0",
                                background: viewMode === mode
                                    ? "linear-gradient(135deg, #0fc, #0af)"
                                    : "rgba(255,255,255,0.04)",
                                color: viewMode === mode ? "#000" : "#aaa",
                                border: viewMode === mode ? "none" : "1px solid #333",
                                borderRadius: "6px", cursor: "pointer",
                                fontSize: "10px", fontWeight: 700, letterSpacing: "1px",
                                transition: "all 0.2s ease",
                            }}
                        >
                            {mode === "map" ? "MAP" : mode === "lab" ? "3D LAB" : "TOP 2D"}
                        </button>
                    ))}
                </div>

                {/* Altitude slider */}
                {alts.length > 1 && (
                    <>
                        <label style={{ fontSize: "10px", color: "#888", letterSpacing: "1px" }}>
                            ALTITUDE LAYER
                        </label>
                        <div style={{ marginTop: "4px", marginBottom: "4px" }}>
                            <input
                                id="altitude-slider"
                                type="range"
                                min={0}
                                max={alts.length - 1}
                                value={altIndex !== null ? altIndex : selectedAltIndex}
                                onChange={e => setAltIndex(Number(e.target.value))}
                                style={{ width: "100%", accentColor: "#0fc" }}
                            />
                            <div style={{
                                display: "flex", justifyContent: "space-between",
                                fontSize: "10px", color: "#666", marginTop: "2px",
                            }}>
                                <span>{alts[0]?.toFixed(1)}m</span>
                                <span style={{ color: "#0fc", fontWeight: 700 }}>
                                    {alts[altIndex !== null ? altIndex : selectedAltIndex]?.toFixed(1)}m
                                </span>
                                <span>{alts[alts.length - 1]?.toFixed(1)}m</span>
                            </div>
                        </div>
                    </>
                )}

                {/* Stats bar */}
                <div style={{
                    marginTop: "12px", paddingTop: "12px",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                    fontSize: "10px",
                }}>
                    <div>
                        <span style={{ color: "#666" }}>VOXELS </span>
                        <span style={{ color: "#0fc" }}>{voxels.length.toLocaleString()}</span>
                    </div>
                    <div>
                        <span style={{ color: "#666" }}>TRIS </span>
                        <span style={{ color: "#0fc" }}>{triCount}</span>
                    </div>
                    <div>
                        <span style={{ color: "#666" }}>MIN </span>
                        <span style={{ color: "#7c3aed" }}>{minVal.toFixed(1)}</span>
                    </div>
                    <div>
                        <span style={{ color: "#666" }}>MAX </span>
                        <span style={{ color: "#f59e0b" }}>{maxVal.toFixed(1)}</span>
                    </div>
                </div>

                {/* Color scale legend */}
                <div style={{
                    marginTop: "12px",
                    height: "8px", borderRadius: "4px",
                    background: "linear-gradient(90deg, #0d0887, #4b03a1, #8914a0, #c0366a, #e66137, #f9950a, #fcce25, #f0f921)",
                }} />
                <div style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: "9px", color: "#666", marginTop: "3px",
                }}>
                    <span>{minVal.toFixed(1)} {metricUnits[metric]}</span>
                    <span>{maxVal.toFixed(1)} {metricUnits[metric]}</span>
                </div>

                {loading && (
                    <div style={{
                        marginTop: "10px", textAlign: "center",
                        color: "#0fc", fontSize: "10px",
                        animation: "pulse 1.5s ease-in-out infinite",
                    }}>
                        ● INTERPOLATING…
                    </div>
                )}
            </div>

            {/* ─── Deck.gl Canvas ─── */}
            {viewMode === "map" ? (
                <DeckGL
                    key="deck-map"
                    initialViewState={MAP_INITIAL_VIEW}
                    controller={true}
                    layers={mapLayers}
                >
                    <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
                </DeckGL>
            ) : viewMode === "topdown" ? (
                <DeckGL
                    key="deck-topdown"
                    initialViewState={TOPDOWN_MAP_VIEW}
                    controller={true}
                    layers={topdownLayers}
                >
                    <Map mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" />
                </DeckGL>
            ) : (
                <DeckGL
                    key="deck-orbit"
                    views={new OrbitView()}
                    initialViewState={ORBIT_INITIAL_VIEW}
                    controller={true}
                    layers={orbitLayers}
                    style={{ background: "radial-gradient(ellipse at center, #0a0a12 0%, #000 100%)" }}
                />
            )}
        </div>
    );
}