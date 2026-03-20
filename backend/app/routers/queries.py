"""
Queries router: serve dashboard tab results.
Results are served from cached JSON files (build/results/) for instant load.
A /requery endpoint re-runs queries directly against Fuseki via HTTP (fast, no Gradle).
"""
import json
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import User, Project, BuildStatus
from ..routers.auth import get_current_user
from ..services.fuseki_service import load_result_file, sparql_query, is_fuseki_running, count_result_rows

router = APIRouter(prefix="/projects", tags=["queries"])

_SPARQL_DIR = Path(__file__).parent.parent.parent / "sparql"

TABS = [
    # ── Mission Engineering (DesertStorm-class projects) ──────────────────────
    {
        "id":          "kill_chain",
        "label":       "Kill Chain Coverage",
        "description": "Which performers can execute which kill chain steps?",
        "query_file":  "kill_chain_coverage",
    },
    {
        "id":          "met_architecture",
        "label":       "MET Architecture",
        "description": "Mission Engineering Thread comparison — capability allocations per MET.",
        "query_file":  "met_architecture",
    },
    {
        "id":          "mop_tradeoff",
        "label":       "MOP Trade-Space",
        "description": "Baseline vs alternative MOP comparison with constraints.",
        "query_file":  "mop_comparison",
    },
    {
        "id":          "capability",
        "label":       "Capability Traceability",
        "description": "Capability requirements → satisfied capabilities → bearing systems.",
        "query_file":  "capability_traceability",
    },
    {
        "id":          "requirements",
        "label":       "Requirements & Tests",
        "description": "Requirement allocation and test verification — gap detection.",
        "query_file":  "requirements_to_tests",
    },
    {
        "id":          "test_milestones",
        "label":       "Test & Milestone Traceability",
        "description": "Test-to-milestone traceability with assessment findings and confidence scores.",
        "query_file":  "test_milestone_findings",
    },
    # ── System Architecture (CarExample-class projects) ───────────────────────
    {
        "id":          "interface_mismatch",
        "label":       "Interface Type Mismatches",
        "description": "ConnectsTo links where ports are prescribed by incompatible interface types.",
        "query_file":  "interface-type-mismatch",
    },
    {
        "id":          "dead_functions",
        "label":       "Dead Functions",
        "description": "Functions with no mode availability — can never execute in any system state.",
        "query_file":  "dead-functions",
    },
    {
        "id":          "unverified_requirements",
        "label":       "Unverified Requirements",
        "description": "Requirements with no assigned verification activity — coverage gaps.",
        "query_file":  "unverified-requirements",
    },
    {
        "id":          "mode_function_matrix",
        "label":       "Mode–Function Matrix",
        "description": "Which functions are available in which operational modes.",
        "query_file":  "mode-function-matrix",
    },
    {
        "id":          "requirements_traceability",
        "label":       "Requirements Traceability",
        "description": "Full RTM: requirement allocation to systems and verification activities.",
        "query_file":  "requirements-traceability",
    },
    {
        "id":          "state_machine",
        "label":       "State Machine Completeness",
        "description": "Modes with no entry transition — potential reachability errors.",
        "query_file":  "state-machine-completeness",
    },
    # ── Bayesian Network ──────────────────────────────────────────────────────
    {
        "id":          "bayesian_network",
        "label":       "Bayesian Network",
        "description": "Interactive Bayesian network — click observable nodes to toggle Pass/Fail and propagate beliefs across the network.",
        "query_file":  "bayesian_network",
    },
    # ── MOE Calculations ──────────────────────────────────────────────────────
    {
        "id":          "moe_calculations",
        "label":       "MOE Calculations",
        "description": "MOE values calculated as the product of input parameter measurements, with historical timeline.",
        "query_file":  "moe_calculation",
    },
    # ── Test Strategy (BerserkerVerification) ────────────────────────────────
    {
        "id":          "test_strategy",
        "label":       "Test Strategy",
        "description": "OFT schedule Gantt view — planned execution windows, required actors and infrastructure, and resource conflict detection.",
        "query_file":  "test_strategy",
    },
    # ── Risk Matrices ─────────────────────────────────────────────────────────
    {
        "id":          "risk_matrix",
        "label":       "Risk Matrices",
        "description": "DoD 5×5 risk matrices — system performance risks (informed by DT) and operational risks (informed by OT). Likelihood derived from Bayesian network posteriors; severity on DoD consequence scale.",
        "query_file":  "risk_matrix",
    },
    # Supplementary data for the risk_matrix tab — no UI tab button (not in frontend TABS).
    # Derives DT→OT influence via 3-hop measurand dependency chain.
    {
        "id":          "risk_influence",
        "label":       "Risk Influence",
        "description": "Supplementary: DT→OT risk influence derived from measurand calculatedUsing chain.",
        "query_file":  "risk_influence",
    },
]

_TAB_BY_ID = {t["id"]: t for t in TABS}


def _load_result(results_dir: str, query_file: str) -> dict:
    result = load_result_file(results_dir, query_file)
    if result is None:
        return {"vars": [], "bindings": []}
    return {
        "vars":     result.get("head", {}).get("vars", []),
        "bindings": result.get("results", {}).get("bindings", []),
    }


@router.get("/{project_id}/results/{tab_id}")
def get_tab_results(
    project_id: int,
    tab_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if p.status != BuildStatus.READY:
        raise HTTPException(409, "Project build not complete")
    tab = _TAB_BY_ID.get(tab_id)
    if not tab:
        raise HTTPException(404, "Unknown tab id")
    results_dir = str(Path(p.project_dir) / "build" / "results")
    return _load_result(results_dir, tab["query_file"])


@router.get("/{project_id}/results")
def get_all_results(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all tab results from cached JSON files — instant load."""
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if p.status != BuildStatus.READY:
        raise HTTPException(409, "Project build not complete")
    results_dir = str(Path(p.project_dir) / "build" / "results")
    return {tab["id"]: _load_result(results_dir, tab["query_file"]) for tab in TABS}


def _run_requery_bg(project_id: int, project_dir: str, slug: str):
    """Background thread: run all SPARQL queries in parallel, update DB."""
    db = SessionLocal()
    try:
        results_dir = Path(project_dir) / "build" / "results"
        results_dir.mkdir(parents=True, exist_ok=True)

        work = []
        for tab in TABS:
            sparql_file = _SPARQL_DIR / f"{tab['query_file']}.sparql"
            if sparql_file.exists():
                work.append((tab, sparql_file.read_text(encoding="utf-8")))

        results_map = {}
        errors = {}

        def _run_one(tab, query):
            return tab, sparql_query(slug, query, timeout=12)

        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(_run_one, tab, query): tab for tab, query in work}
            for future in as_completed(futures):
                tab = futures[future]
                try:
                    _, result = future.result()
                    results_map[tab["id"]] = (tab, result)
                except Exception as e:
                    errors[tab["id"]] = str(e)

        active_tabs = []
        for tab_id, (tab, result) in results_map.items():
            out_file = results_dir / f"{tab['query_file']}.json"
            out_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
            if count_result_rows(result) > 0:
                active_tabs.append(tab["id"])

        p = db.get(Project, project_id)
        if p:
            p.active_tabs = json.dumps(active_tabs)
            p.status = BuildStatus.READY
            db.commit()
    finally:
        db.close()


@router.post("/{project_id}/requery")
def requery(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Re-run all SPARQL queries in parallel against Fuseki — returns immediately.
    Queries run in background; poll GET /projects/{id} for status change to READY.
    """
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if not is_fuseki_running(p.slug):
        raise HTTPException(409, "Fuseki is not running for this project. Run a full Build first.")

    p.status = BuildStatus.BUILDING
    db.commit()

    t = threading.Thread(
        target=_run_requery_bg,
        args=(project_id, p.project_dir, p.slug),
        daemon=True,
    )
    t.start()

    return {"message": "Re-query started in background."}
