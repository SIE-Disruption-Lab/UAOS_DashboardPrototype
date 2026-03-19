import os
import shutil
import stat
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Project, BuildStatus
from ..routers.auth import get_current_user
from ..services.oml_service import setup_project_instance

router = APIRouter(prefix="/projects", tags=["projects"])

_BACKEND_DIR     = Path(__file__).parent.parent.parent
_TEMPLATE_DIR    = _BACKEND_DIR / "template_project"
_SPARQL_DIR      = _BACKEND_DIR / "sparql"
_USER_DATA_DIR   = _BACKEND_DIR / "user_data"
_LOCAL_MAVEN_DIR = _BACKEND_DIR / "local_maven_repo"


def _to_out(p: Project) -> dict:
    return {
        "id":          p.id,
        "name":        p.name,
        "slug":        p.slug,
        "description": p.description or "",
        "status":      p.status.value,
        "active_tabs": json.loads(p.active_tabs) if p.active_tabs else [],
        "namespace":   p.namespace or "",
        "project_dir": p.project_dir,
    }


def _safe_slug(name: str) -> str:
    import re
    return re.sub(r'[^a-zA-Z0-9_-]', '_', name.strip())[:64]


def _make_project_dir(user_id: int, slug: str) -> Path:
    p = _USER_DATA_DIR / str(user_id) / slug
    p.mkdir(parents=True, exist_ok=True)
    return p


def _copy_template(project_dir: Path):
    for item in ["gradlew", "gradlew.bat", "settings.gradle", "build.gradle"]:
        src = _TEMPLATE_DIR / item
        if src.is_file():
            shutil.copy2(src, project_dir / item)
    # Explicitly copy gradle/wrapper files one by one (copytree unreliable on Windows)
    wrapper_src = _TEMPLATE_DIR / "gradle" / "wrapper"
    wrapper_dst = project_dir / "gradle" / "wrapper"
    wrapper_dst.mkdir(parents=True, exist_ok=True)
    for fname in ["gradle-wrapper.jar", "gradle-wrapper.properties"]:
        s = wrapper_src / fname
        d = wrapper_dst / fname
        if not s.exists():
            raise RuntimeError(f"Template missing: {s}")
        shutil.copy2(s, d)
        if not d.exists():
            raise RuntimeError(f"Failed to copy {fname} to {d}")
    gw = project_dir / "gradlew"
    if gw.exists():
        gw.chmod(0o755)
    # Seed build/oml/ from the template (always sync so it's never stale/partial).
    template_oml = _TEMPLATE_DIR / "build" / "oml"
    dest_oml = project_dir / "build" / "oml"
    if template_oml.is_dir():
        dest_oml.mkdir(parents=True, exist_ok=True)
        shutil.copytree(str(template_oml), str(dest_oml), dirs_exist_ok=True)


# ── List / Create ─────────────────────────────────────────────────────────────
@router.get("/", response_model=list)
def list_projects(current_user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.owner_id == current_user.id).all()
    return [_to_out(p) for p in projects]


@router.post("/", status_code=201)
def create_project(
    name: str = Form(...),
    description: str = Form(""),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    slug = _safe_slug(name)
    if db.query(Project).filter(Project.owner_id == current_user.id,
                                Project.slug == slug).first():
        raise HTTPException(400, f"A project named '{slug}' already exists.")

    project_dir = _make_project_dir(current_user.id, slug)
    _copy_template(project_dir)

    oml_files = []
    for f in files:
        if not f.filename.endswith('.oml'):
            raise HTTPException(400, f"Only .oml files accepted (got {f.filename})")
        oml_files.append((f.filename, f.file.read()))

    meta = setup_project_instance(
        project_dir=str(project_dir),
        oml_files=oml_files,
        template_dir=str(_TEMPLATE_DIR),
        sparql_dir=str(_SPARQL_DIR),
        local_maven_repo=str(_LOCAL_MAVEN_DIR),
        dataset_name=slug,
    )

    project = Project(
        name=name, slug=slug, description=description,
        owner_id=current_user.id, status=BuildStatus.PENDING,
        project_dir=str(project_dir), namespace=meta["namespace_base"],
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_out(project)


# ── Get / Update / Delete ─────────────────────────────────────────────────────
@router.get("/{project_id}")
def get_project(project_id: int,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    return _to_out(p)


@router.patch("/{project_id}")
def update_project(
    project_id: int,
    name: str = Form(None),
    description: str = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if name is not None:
        p.name = name
    if description is not None:
        p.description = description
    db.commit()
    db.refresh(p)
    return _to_out(p)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int,
                   current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    from ..services.gradle_service import run_stop_fuseki
    run_stop_fuseki(p.project_dir)
    shutil.rmtree(p.project_dir, ignore_errors=True)
    db.delete(p)
    db.commit()


# ── Re-upload OML files ───────────────────────────────────────────────────────
@router.post("/{project_id}/upload")
def reupload_files(
    project_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace OML files and reset project to pending (ready for rebuild)."""
    p = db.get(Project, project_id)
    if not p or p.owner_id != current_user.id:
        raise HTTPException(404, "Project not found")
    if p.status == BuildStatus.BUILDING:
        raise HTTPException(409, "Cannot re-upload while build is in progress")

    oml_files = []
    for f in files:
        if not f.filename.endswith('.oml'):
            raise HTTPException(400, f"Only .oml files accepted (got {f.filename})")
        oml_files.append((f.filename, f.file.read()))

    def _force_rmtree(path):
        """rmtree that clears read-only flags on Windows before retrying."""
        def onerror(func, p, _):
            try:
                os.chmod(p, stat.S_IWRITE)
                func(p)
            except Exception:
                pass
        shutil.rmtree(path, onerror=onerror)

    # Wipe old OML src directory
    project_dir = Path(p.project_dir)
    oml_src = project_dir / "src" / "oml"
    if oml_src.exists():
        _force_rmtree(oml_src)

    # Wipe only Gradle output subdirs (owl, results, reports) — leave build/oml/ alone.
    build_dir = project_dir / "build"
    for sub in ["owl", "results", "reports"]:
        target = build_dir / sub
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)

    # Sync build/oml/ from the template (adds any new vocabs like UAOS_Risk,
    # creates the directory if it doesn't exist yet).
    template_oml = _TEMPLATE_DIR / "build" / "oml"
    dest_oml = build_dir / "oml"
    if template_oml.is_dir():
        dest_oml.mkdir(parents=True, exist_ok=True)
        shutil.copytree(str(template_oml), str(dest_oml), dirs_exist_ok=True)

    meta = setup_project_instance(
        project_dir=str(project_dir),
        oml_files=oml_files,
        template_dir=str(_TEMPLATE_DIR),
        sparql_dir=str(_SPARQL_DIR),
        local_maven_repo=str(_LOCAL_MAVEN_DIR),
        dataset_name=p.slug,
    )

    p.status = BuildStatus.PENDING
    p.active_tabs = "[]"
    p.namespace = meta["namespace_base"]
    db.commit()
    return _to_out(p)
