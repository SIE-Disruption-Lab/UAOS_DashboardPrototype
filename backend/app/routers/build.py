"""
Build router: trigger the full Gradle pipeline for a project.
Runs synchronously in a thread pool so the endpoint doesn't block the event loop.
"""
import json
import threading
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import User, Project, BuildStatus
from ..routers.auth import get_current_user
from ..services.gradle_service import run_full_pipeline
from ..services.fuseki_service import load_result_file, count_result_rows

router = APIRouter(prefix="/projects", tags=["build"])

# Map query filename stem → tab id (must match frontend tab definitions)
QUERY_TAB_MAP = {
    # Mission Engineering
    "kill_chain_coverage":       "kill_chain",
    "met_architecture":          "met_architecture",
    "mop_comparison":            "mop_tradeoff",
    "capability_traceability":   "capability",
    "requirements_to_tests":     "requirements",
    "test_milestone_findings":   "test_milestones",
    # System Architecture
    "interface-type-mismatch":   "interface_mismatch",
    "dead-functions":            "dead_functions",
    "unverified-requirements":   "unverified_requirements",
    "mode-function-matrix":      "mode_function_matrix",
    "requirements-traceability": "requirements_traceability",
    "state-machine-completeness": "state_machine",
    # Bayesian Network
    "bayesian_network":           "bayesian_network",
    # MOE Calculations
    "moe_calculation":            "moe_calculations",
}

_LOCAL_MAVEN_DIR = Path(__file__).parent.parent.parent / "local_maven_repo"


def _detect_active_tabs(project_dir: str) -> list[str]:
    """Return list of tab ids whose query returned at least one result row."""
    results_dir = Path(project_dir) / "build" / "results"
    active = []
    for stem, tab_id in QUERY_TAB_MAP.items():
        result = load_result_file(str(results_dir), stem)
        if result and count_result_rows(result) > 0:
            active.append(tab_id)
    return active


def _run_pipeline_bg(project_id: int):
    """Background thread: run pipeline and update DB on completion."""
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return

        # Determine rootIri from namespace
        root_iri = f"{project.namespace}/bundle"

        success, log = run_full_pipeline(
            project_dir=project.project_dir,
            dataset_name=project.slug,
            root_iri=root_iri,
            local_maven_repo=str(_LOCAL_MAVEN_DIR),
        )

        if success:
            active_tabs = _detect_active_tabs(project.project_dir)
            project.status = BuildStatus.READY
            project.active_tabs = json.dumps(active_tabs)
        else:
            project.status = BuildStatus.FAILED

        # Save build log
        log_path = Path(project.project_dir) / "build" / "build.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(log, encoding='utf-8')

        db.commit()
    finally:
        db.close()


@router.post("/{project_id}/build")
def trigger_build(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if project.status == BuildStatus.BUILDING:
        raise HTTPException(409, "Build already in progress")

    project.status = BuildStatus.BUILDING
    db.commit()

    # Run in background thread (not a FastAPI BackgroundTask — uses its own DB session)
    t = threading.Thread(target=_run_pipeline_bg, args=(project_id,), daemon=True)
    t.start()

    return {"message": "Build started", "project_id": project_id}


@router.get("/{project_id}/build/log")
def get_build_log(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")

    log_path = Path(project.project_dir) / "build" / "build.log"
    if not log_path.exists():
        return {"log": "No build log yet."}
    return {"log": log_path.read_text(encoding='utf-8')}


@router.get("/{project_id}/status")
def get_status(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project or project.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")

    db.refresh(project)
    return {
        "status":      project.status.value,
        "active_tabs": json.loads(project.active_tabs) if project.active_tabs else [],
    }
