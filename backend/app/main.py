from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from .database import engine, Base
from .routers import auth, projects, build, queries

# Create DB tables on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="UAOS Dashboard", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(build.router)
app.include_router(queries.router)

# Serve frontend static files
_FRONTEND = Path(__file__).parent.parent.parent / "frontend"

if _FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND)), name="static")

    @app.get("/")
    def root():
        return FileResponse(str(_FRONTEND / "index.html"))

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        """Return index.html for all non-API routes (SPA client-side routing)."""
        if full_path.startswith("auth/") or full_path.startswith("projects/"):
            from fastapi import HTTPException
            raise HTTPException(404)
        return FileResponse(str(_FRONTEND / "index.html"))
