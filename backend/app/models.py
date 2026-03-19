from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum

from .database import Base


class BuildStatus(str, enum.Enum):
    PENDING   = "pending"
    BUILDING  = "building"
    READY     = "ready"
    FAILED    = "failed"


class User(Base):
    __tablename__ = "users"

    id           = Column(Integer, primary_key=True, index=True)
    username     = Column(String, unique=True, index=True, nullable=False)
    email        = Column(String, unique=True, index=True, nullable=False)
    hashed_pw    = Column(String, nullable=False)
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String, nullable=False)
    slug         = Column(String, nullable=False)          # filesystem-safe name
    description  = Column(Text, default="")
    owner_id     = Column(Integer, ForeignKey("users.id"), nullable=False)
    status       = Column(Enum(BuildStatus), default=BuildStatus.PENDING)
    active_tabs  = Column(Text, default="")                # JSON list of tab ids with data
    project_dir  = Column(String, nullable=False)          # abs path to the project instance
    namespace    = Column(String, default="")              # parsed OML namespace base
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                          onupdate=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="projects")
