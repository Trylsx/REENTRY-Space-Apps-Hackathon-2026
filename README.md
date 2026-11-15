# Interplanetary Survival Guide: Martian Map

**Marswalk 3D** is a Mars EVA (spacewalk) traverse planner that layers data from several NASA missions into one hyperlocal view. It was built for the NASA Space Apps Challenge 2026 *Marswalk* challenge.

Plan a route across real Martian terrain, steer around hazards, check whether the excursion fits inside suit limits, and see an AI forecast of the temperature and pressure the crew will face along the way.

## The Challenge

NASA asked for a map, tool or interface that a Mars astronaut could use on a surface excursion. It should combine data from multiple missions, put safety first, and show a route that helps the crew reach their science goals while avoiding obstacles. Existing tools such as Mars Trek are built for regional and global views. Astronauts need something focused on the small area of a single spacewalk.

## What It Does

**Traverse planning**
- Click the 2D map to place waypoints and draw circular hazard zones.
- The planner routes around every hazard automatically and picks the shorter side.
- Choose rover travel (10 km/h) or spacesuit EVA on foot (2.5 km/h), and toggle a return-to-start leg.
- Each science stop adds 20 minutes of work time.

**Clearance assessment**
- Total distance and EVA duration, checked against an 8-hour life-support limit.
- Estimated radiation dose for the traverse, based on the surface dose rate measured by Curiosity's RAD instrument.
- A solar particle event scenario to simulate a space-weather warning.
- A GO or caution verdict with the reasons behind it.

**Layered NASA data**
- **Optical:** Viking MDIM 2.1 color mosaic (232 m/px)
- **Topographic:** MGS MOLA elevation relief (463 m/px)
- **Thermal:** THEMIS infrared daytime mosaic (100 m/px)
- **Atmospheric:** Mars Climate Database pressure, density, wind and dust optical depth
- **Weather and imagery:** Curiosity REMS weather and raw camera images at Gale Crater
- **Radiation:** surface dose rate from Curiosity RAD, used in the dose estimate
- Opacity sliders let you blend layers, and Solo View isolates one.

**3D route view**
- The planned route is drawn over terrain built from MOLA elevation data (Three.js).
- Hazard zones appear as walls, and the route as a tube with a rover marker.
- Terrain is colored by AI-identified terrain patterns, such as rugged or smooth zones.

**Quantum Echo AI forecast**
- Switch to **Analyse** mode and click anywhere on Mars.
- Get predicted surface temperature, air temperature and pressure for a chosen season and local time.
- View a full-sol temperature curve.
- See terrain at that point: elevation, slope, roughness, terrain pattern and MOLA coverage.
- Every forecast includes the model's typical error and warns when the input is outside the training range or the terrain data is thin.

**Exploration extras**
- A preloaded Gale Crater science loop (Mount Sharp region)
- Teleport to coordinates or jump to a random location
- A 3D Mars globe
- Six landmarks, including Olympus Mons, Valles Marineris and Jezero Crater
- A history of 10 landing sites, from Viking 1 to Zhurong

## How Quantum Echo Works

Quantum Echo is a scikit-learn model trained to imitate the Mars Climate Database. It gives instant forecasts for any point on the planet without a round trip to the climate database.

- **Targets:** surface temperature, air temperature and pressure (the model is version 3).
- **Inputs:** latitude, longitude, season (solar longitude), local time, solar geometry and insolation features, and terrain elevation, slope and roughness from a 0.25-degree MOLA-derived grid.
- **Pressure model:** a Ridge regression baseline with an ExtraTrees model on the residuals.
- **Terrain patterns:** grid cells are clustered into terrain types, which drive the colored zones in the 3D view.
- **Season:** the current Martian solar longitude (Ls) is computed from the date, or you can set one manually.

## Safety and Honesty

This is a planning aid, not flight software.

- The AI forecast is an estimate that imitates the Mars Climate Database. It is not a measurement.
- The Mars Climate Database values come from model output at 1 m altitude with a fixed dust scenario. They are not live rover readings.
- Typical error is an average over held-out regions and seasons, so a single point can be off by more.
- The radiation dose uses one fixed surface dose rate, and the solar particle event is a simulated scenario. Neither is live space-weather data.
- Terrain in cells with little or no direct MOLA coverage may be interpolated, and the app warns when this happens.
- If Curiosity's live weather feed is unavailable, the telemetry panel falls back to a stored baseline and labels it as such.

## Tech Stack

| Layer | Tools |
|---|---|
| Frontend | React 19, Vite, Leaflet, Three.js |
| Backend | Python 3.11 or 3.12, FastAPI, uvicorn |
| ML and data | scikit-learn 1.6.1, NumPy, pandas, SciPy, joblib |
| NASA data | Mars Trek tiles, MOLA altimetry, Mars Climate Database, Curiosity REMS and RAD |
| Tests | pytest |

## Getting Started

### 1. Backend

The scikit-learn version must match the one used to save the model, so install from the requirements file. Run each command on its own, one at a time, and wait for it to finish before running the next.

Move into the backend folder:

```bash
cd backend
```

Create the virtual environment:

```bash
python -m venv .venv
```

Activate it. On Windows (PowerShell or the VS Code terminal):

```bash
.venv\Scripts\activate
```

On Mac or Linux:

```bash
source .venv/bin/activate
```

Your prompt should now start with `(.venv)`. Install the dependencies:

```bash
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn app.main:app --port 8000
```

If PowerShell blocks activation with a script-execution error, run this once and try again:

```bash
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 2. Frontend

In a second terminal from the repository root:

```bash
npm install
npm run dev
```

Open the local address Vite prints. It proxies `/api` to `http://127.0.0.1:8000`.

### 3. Try it

1. Click **Launch Mission Console** on the intro screen, or **Load Gale Crater Traverse** for the preset.
2. Use **+ Waypoint** to add stops and **Hazard Area** to draw no-go zones.
3. Read the Traverse Clearance Assessment, then open the 3D route view.
4. Switch to **Analyse** and click the map to get the AI forecast.

### Tests

With the backend environment active, from the `backend` folder:

```bash
pip install -r requirements-dev.txt
```

```bash
pytest
```

### Configuration

| Variable | Purpose |
|---|---|
| `QUANTUM_API_URL` | Backend address for the Vite proxy (default `http://127.0.0.1:8000`) |
| `VITE_QUANTUM_API_BASE` | Frontend API base URL, for deployments without the proxy |
| `QUANTUM_ECHO_DATA_DIR` | Folder containing the model and terrain data |
| `QUANTUM_ECHO_CORS_ORIGINS` | Comma-separated list of allowed origins |

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Model info, typical error and terrain grid details |
| `GET /api/season` | Current or requested Martian season (Ls) |
| `GET /api/analyse` | Forecast and terrain at a point (`lat`, `lon`, optional `ls`, `local_time`) |
| `GET /api/day-curve` | Temperature and pressure across one sol |
| `GET /api/environment` | Mars Climate Database atmosphere and dust values (returns 502 if the service is unreachable) |
| `GET /api/terrain-patch` | Elevation and terrain-pattern grid for the 3D view |

## Project Structure

```
backend/
  app/            FastAPI app, prediction engine, features, MCD client, season maths
  data/           Trained model and terrain layers
  tests/          API and MCD tests
src/
  App.jsx         Map, planner, clearance logic and layer controls
  components/     AI forecast, live conditions, 3D route view, globe, HUD
  api/            Backend client
  data/           Landing sites and landmarks
public/           Static assets
```

## Data Sources

- NASA / JPL [Mars Trek](https://trek.nasa.gov/mars/) for the Viking, MOLA and THEMIS map layers
- Mars Global Surveyor MOLA altimetry
- The [Mars Climate Database](https://www-mars.lmd.jussieu.fr/mcd_python/) (LMD, France, with partners)
- Curiosity REMS environmental data, via a public weather API built on CAB/CSIC-INTA and NASA JPL data
- Curiosity raw images from NASA
- Curiosity RAD surface dose measurements

## Built For

NASA Space Apps Challenge 2026, *Marswalk*.
