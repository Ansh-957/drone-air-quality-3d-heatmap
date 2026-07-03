# Drone-Based Air Quality 3D Heatmap

A custom-built FPV drone carrying a purpose-engineered air quality sensing payload, feeding a full geostatistical interpolation pipeline and an interactive 3D visualization dashboard with three distinct viewing modes.

**Status:** Software pipeline complete and validated end-to-end against synthetic flight data. Sensing payload hardware has arrived and is in final integration; live flight testing with real sensor data is in progress. *This README will be updated with real flight data and demo footage once testing is complete.*

---

## Why This Project Exists

Air quality monitoring infrastructure is sparse and almost entirely ground-based or satellite-based. A handful of fixed monitoring stations can't capture how pollution actually behaves in three dimensions, how PM2.5 concentration changes with altitude near a busy road, how a localized source disperses across a neighborhood, or how air quality varies between ground level and rooftop height. Wildfire smoke, traffic corridors, and industrial sources all have vertical structure that ground sensors simply can't see.

This project builds a custom FPV drone carrying a dedicated air quality sensing payload thats a portable alternative and low in cost. It flies through a 3D volume of airspace and feeds the resulting sparse point-cloud data into a geostatistical interpolation pipeline that reconstructs a continuous, interactive 3D pollution field.

---

## Project Overview

| Phase | What it covers |
| :--- | :--- |
| **Phase 1: Airframe** | A custom 5" FPV drone built from individual components, not a pre-assembled kit |
| **Phase 2: Sensing Payload** | An ESP32-controlled air quality sensor payload with active propwash isolation |
| **Phase 3: Software Pipeline** | A full-stack data pipeline: ingestion, 3D RBF interpolation and an interactive multi-view 3D visualization dashboard |

---

## Phase 1: Airframe

### Build Specifications

| Component | Spec |
| :--- | :--- |
| **Frame** | 5" Carbon fibre |
| **Motors** | iFlight XING 2207 2450KV |
| **Flight controller / ESC** | DAKEFPV F405 FC + 6S 55A ESC stack |
| **Firmware** | Betaflight, DSHOT300 ESC protocol |
| **Battery** | Zeee 4S 1500mAh 120C LiPo |
| **Propellers** | 5140 tri-blade |
| **Receiver** | ELRS 2.4GHz |
| **Transmitter** | RadioMaster Pocket (ELRS) |


---

## Phase 2: Sensing Payload

### Hardware

| Component | Purpose |
| :--- | :--- |
| **ESP32** | Sensor polling, GPS tagging, telemetry transmission |
| **PMS5003** | PM2.5 / PM10 particulate sensor |
| **BME280** | Temperature, humidity & barometric pressure sensor|
| **HGLRC M100-5883 (M10)** | GPS positioning for geotagging each reading |
| **2x MG90S metal-gear servos** | Deployable sensor arm |
| **Matek BEC** | Dedicated power tap and reduced electrical noise from FC |

### Engineering Decisions Worth Noting
* **Propwash isolation via deployable arm:** Propeller wash directly over the sensor inlet would contaminate readings with localized turbulence rather than ambient air. The payload uses a two-servo arm to physically position the sensor package outside the rotor wash zone during sampling.
* **Power isolation:** Servos draw current in sharp, inductive spikes when moving. Powering them directly from the flight controller risks injecting electrical noise, a Matek BEC (Battery Eliminator Circuit) steps down high voltage to 5V & reduces noise.
---

## Phase 3: Software Pipeline

### Architecture

```text
ESP32 (sensor payload)
    │  JSON over WiFi (POST /telemetry)
    ▼
FastAPI backend
    │  scipy RBFInterpolator (3D, thin-plate-spline kernel)
    ▼
Interpolated 3D voxel grid (GET /heatmap)
    │  JSON
    ▼
React + deck.gl frontend
    │  Three view modes: Map / 3D Lab / Top 2D
    ▼
Interactive triangulated mesh visualization
```

### Backend
```text
Stack: FastAPI, scipy, NumPy
```

The backend ingests telemetry points (`{timestamp, lat, lon, alt, pm25, pm10, temp, humidity, pressure}`), stores them, and on request runs a full 3D spatial interpolation to reconstruct a continuous pollution field from sparse flight-path samples.

* **Algorithmic Pivot:** Replaced standard 3D Ordinary Kriging with a scipy.interpolate.RBFInterpolator (thin-plate-spline kernel) after diagnosing numerical instability and ill-conditioning caused by mismatched coordinate units.

* **Unit Normalization:** Implemented lat/lon to meter conversion scaling to ensure consistent physical units for robust handling of sparse, scattered 3D flight data.

### Frontend
```text
Stack: React, deck.gl, MapLibre GL, react-map-gl, axios
```

The dashboard renders the interpolated pollution field as a smooth, continuous triangulated mesh surface, height-mapped by pollutant concentration and colored with a plasma colormap, across three distinct view modes:

* **Map view:** the pollution surface rendered georeferenced over a real street map of the flight area, for understanding pollution in actual geographic context
* **3D Lab view:** a free-rotating, plain-background 3D plot (deck.gl OrbitView) for inspecting the data's spatial structure independent of geography, closer to a scientific visualization than a map
* **Top 2D view:** a flat, straight-down orthographic view with the real basemap still visible underneath, for at-a-glance reading of pollution intensity by location, similar to satellite-style pollution maps

Users can switch between PM2.5, PM10, and temperature as the active metric, and scrub through altitude layers via a slider to inspect how the pollution field changes with height.

---

## Repository Structure

```text
air-quality-dashboard/
├── README.md
├── backend/
│   ├── main.py                 # FastAPI app, /telemetry and /heatmap endpoints
│   ├── models.py               # Pydantic data models
│   ├── kriging.py              # 3D RBF interpolation pipeline
│   ├── synthetic_telemetry.py  # Synthetic flight data generator for testing
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── HeatmapView.jsx     # Main visualization component (3 view modes)
│   │   ├── meshUtils.js        # Grid-to-mesh triangulation + color mapping
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── firmware/
│   └── payload/                # ESP32 sensor payload firmware
├── hardware/
│   ├── airframe/               # Phase 1 build notes, parts list
│   └── payload/                # Phase 2 payload design notes, wiring diagrams
└── docs/
    └── images/                 # Screenshots, demo footage
```

---

## Running This Project

### Backend
```bash
cd backend
pip install -r requirements.txt
python synthetic_telemetry.py          # generate test flight data
python -m uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Loading test data
With the backend running, feed it synthetic flight data:
```bash
python -c "import json, requests; data = json.load(open('backend/synthetic_flight.json')); [requests.post('http://localhost:8000/telemetry', json=p) for p in data]; print('done')"
```

---


## Tech Stack Summary
* **Hardware:** ESP32, PMS5003, BME280, M10 GPS, MG90S servos, DAKEFPV F405 FC/ESC stack, iFlight XING motors
* **Backend:** Python, FastAPI, scipy (RBFInterpolator), NumPy, Pydantic
* **Frontend:** React, deck.gl, MapLibre GL, react-map-gl, Vite
* **Firmware:** Betaflight (flight controller), Arduino/C++ (ESP32 payload)
