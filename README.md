# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Quantum Echo AI forecast

Backend (Python 3.11 or 3.12, scikit-learn 1.6.1 must match the pickle):

    cd backend
    python -m venv .venv
    .venv\Scripts\activate        (Windows)   or   source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --port 8000

Frontend (second terminal):

    npm install
    npm run dev

Open the app, choose **Analyse** in the Planner, click the map. Vite proxies `/api` to `127.0.0.1:8000`.
Tests: `pip install -r requirements-dev.txt && pytest` in `backend/`.

The AI forecast uses the trained v3 model for surface temperature, air temperature, and pressure.
The separate `/api/environment` endpoint queries the Mars Climate Database for atmospheric density,
wind, and dust optical-depth properties at the selected coordinate, season, and local time. These are
MCD model outputs at 1 m altitude using the notebook's fixed `dust=1` scenario, not live rover
measurements; the endpoint returns `502` if the external MCD service is unavailable.
