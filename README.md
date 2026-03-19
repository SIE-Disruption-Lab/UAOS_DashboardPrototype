# UAOS Dashboard Prototype

A web-based dashboard for uploading [OpenCaesar OML](https://github.com/opencaesar/oml) description projects, compiling them against the University of Arizona Ontology Stack (UAOS), and visualising SPARQL query results across interactive tabs.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Python** | 3.10+ | [python.org](https://www.python.org/downloads/) |
| **Java** | 11+ (17 or 21 recommended) | [adoptium.net](https://adoptium.net/) — must be on your `PATH` |

Verify both are available before continuing:

```
python --version
java -version
```

**Internet access** is required on the first build — Gradle downloads itself (~150 MB) and the OpenCaesar build plugins from Maven Central automatically.

---

## Quick Start

### Windows

```
Double-click  run.bat
```

### macOS / Linux

```bash
chmod +x run.sh
./run.sh
```

The script will:
1. Create a Python virtual environment (`venv/`)
2. Install all Python dependencies from `requirements.txt`
3. Start the server on `http://localhost:8000`
4. Open the dashboard in your default browser automatically

---

## First Use

1. **Register** — create a local account on the login screen (credentials are stored only on your machine)
2. **New Project** — click **New Project**, give it a name, and upload one or more `.oml` description files
3. **Build & Run** — click **Build & Run** to compile the OML, start an Apache Jena Fuseki SPARQL endpoint, load the reasoned ontology, and run all queries
4. **Explore** — once the build completes, active dashboard tabs appear automatically based on what data is present in the model

---

## Dashboard Tabs

| Tab | Description |
|-----|-------------|
| Kill Chain Coverage | Which performers can execute which kill chain steps |
| MET Architecture | Mission Engineering Thread capability allocations |
| MOP Trade-Space | Baseline vs alternative MOP comparison with thresholds |
| Capability Traceability | Capability requirements → satisfied capabilities → systems |
| Requirements & Tests | Requirement allocation and test verification gaps |
| Test & Milestone Traceability | Test-to-milestone traceability with confidence scores |
| Interface Type Mismatches | Incompatible interface type connections |
| Dead Functions | Functions with no mode availability |
| Unverified Requirements | Requirements with no verification activity assigned |
| Mode–Function Matrix | Function availability by operational mode |
| Requirements Traceability | Full RTM with verification activities |
| State Machine Completeness | Modes with no entry transition |
| Bayesian Network | Interactive DAG — click observable nodes to propagate beliefs |
| MOE Calculations | MOE values computed from parameter measurements, with historical timeline and Bayesian-derived estimates |

---

## Project Structure

```
uaos_dashboard/
├── backend/
│   ├── app/                  # FastAPI application
│   │   ├── routers/          # API endpoints (auth, projects, build, queries)
│   │   └── services/         # Gradle, Fuseki, OML processing logic
│   ├── local_maven_repo/     # Bundled UAOS ontology ZIPs (no internet needed)
│   ├── sparql/               # Master SPARQL query library
│   └── template_project/     # Gradle wrapper + build.gradle copied to each new project
├── frontend/
│   ├── index.html            # Single-page application shell
│   ├── app.js                # All dashboard logic
│   └── style.css
├── requirements.txt
├── run.bat                   # Windows launcher
└── run.sh                    # macOS/Linux launcher
```

---

## Subsequent Runs

Just run `run.bat` / `run.sh` again. The virtual environment and database are preserved between sessions. Each user's projects persist in `backend/user_data/` (excluded from version control).

---

## Re-querying Without a Full Rebuild

If Fuseki is still running from a previous build session, use the **Re-query** button on the project dashboard to re-run all SPARQL queries instantly without repeating the Gradle compilation step.

---

## Updating OML Files

To update the OML source for an existing project:

1. Click **Re-upload** on the project dashboard
2. Select the updated `.oml` files
3. Click **Build & Run**

---

## Notes

- Each project gets its own isolated Gradle build and Fuseki instance — only one project's Fuseki server runs at a time (port 3030)
- The UAOS ontology layers (TopLevel, Core, Domain, Libraries) are bundled in `local_maven_repo/` and do not require the UAOS workspace to be present on the machine
- The `bundle.oml` file is generated automatically from uploaded files — do not include it in uploads
