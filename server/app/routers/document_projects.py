"""Document workbench project metadata and attachment references."""
from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..errors import ApiError
from ..models import DocumentProject, FileObject, FileRef, User, utcnow
from ..utils import iso_z

router = APIRouter(tags=["document-projects"], dependencies=[Depends(get_current_user)])

KINDS = {"pdf", "sheet", "document"}
MAX_STATE_BYTES = 5_000_000


class ProjectIn(BaseModel):
    kind: str = Field(min_length=1, max_length=16)
    title: str = Field(default="未命名项目", min_length=1, max_length=200)
    state: dict = Field(default_factory=dict)
    attachment_ids: list[int] = Field(default_factory=list, max_length=100)
    version: int | None = Field(default=None, ge=1)


def _check_kind(kind: str) -> str:
    if kind not in KINDS:
        raise ApiError("PROJECT_KIND_INVALID", "项目类型不正确", 422)
    return kind


def _check_state(state: dict) -> None:
    try:
        size = len(json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError):
        raise ApiError("PROJECT_STATE_INVALID", "项目状态无法序列化", 422)
    if size > MAX_STATE_BYTES:
        raise ApiError("PROJECT_TOO_LARGE", "项目状态超过 5 MB，请减少内嵌内容后再保存", 413)


def _attachments(db: Session, project_id: int, user: User) -> list[FileObject]:
    refs = db.scalars(
        select(FileRef).where(FileRef.owner_type == "document_project", FileRef.owner_id == project_id).order_by(FileRef.id)
    ).all()
    ids = [ref.file_id for ref in refs]
    if not ids:
        return []
    files = {file.id: file for file in db.scalars(select(FileObject).where(FileObject.id.in_(ids))).all()}
    # Existing files are only exposed when a project owns a reference. The
    # single-user Nexus deployment still checks the project owner here.
    project = db.get(DocumentProject, project_id)
    if not project or project.user_id != user.id:
        return []
    return [files[file_id] for file_id in ids if file_id in files]


def _file_payload(file: FileObject) -> dict:
    return {
        "id": file.id,
        "name": file.original_name,
        "content_type": file.content_type,
        "size": file.size,
        "url": f"/api/v1/files/{file.id}/content",
        "download_url": f"/api/v1/files/{file.id}/download",
    }


def _payload(db: Session, project: DocumentProject, user: User, detail: bool = False) -> dict:
    files = _attachments(db, project.id, user)
    payload = {
        "id": project.id,
        "kind": project.kind,
        "title": project.title,
        "version": project.version,
        "attachment_ids": [file.id for file in files],
        "attachments": [_file_payload(file) for file in files],
        "created_at": iso_z(project.created_at),
        "updated_at": iso_z(project.updated_at),
    }
    if detail:
        payload["state"] = project.state or {}
    return payload


def _sync_refs(db: Session, project: DocumentProject, attachment_ids: list[int]) -> None:
    ids: list[int] = []
    for value in attachment_ids:
        if value not in ids:
            ids.append(value)
    files = {file.id: file for file in db.scalars(select(FileObject).where(FileObject.id.in_(ids))).all()} if ids else {}
    missing = [value for value in ids if value not in files]
    if missing:
        raise ApiError("ATTACHMENT_NOT_FOUND", "附件不存在或已被清理", 422, {"missing": missing[:10]})
    refs = db.scalars(
        select(FileRef).where(FileRef.owner_type == "document_project", FileRef.owner_id == project.id)
    ).all()
    current = {ref.file_id for ref in refs}
    all_refs = db.scalars(select(FileRef).where(FileRef.file_id.in_(ids))).all() if ids else []
    referenced_by: dict[int, list[FileRef]] = {}
    for ref in all_refs:
        referenced_by.setdefault(ref.file_id, []).append(ref)
    for file_id in ids:
        if file_id in current:
            continue
        existing = referenced_by.get(file_id) or []
        if existing:
            # A project may share an attachment with another project owned by the
            # same account (for example "save as a new project" after a version
            # conflict). Attachments owned by notes, tables or another account
            # must never be claimed.
            valid = all(
                ref.owner_type == "document_project"
                and (project_row := db.get(DocumentProject, ref.owner_id)) is not None
                and project_row.user_id == project.user_id
                for ref in existing
            )
            if not valid:
                raise ApiError("ATTACHMENT_IN_USE", "附件已被其他内容引用，不能复用", 422)
            continue
        file = files[file_id]
        if file.owner_id is not None and file.owner_id != project.user_id:
            raise ApiError("ATTACHMENT_IN_USE", "附件已被其他内容引用，不能复用", 422)
        if file.status != "staged" or (file.expires_at is not None and file.expires_at <= utcnow()):
            raise ApiError("ATTACHMENT_UNAVAILABLE", "附件已过期或不可用于新项目", 422)
    for ref in refs:
        if ref.file_id not in ids:
            db.delete(ref)
    db.flush()
    for file_id in ids:
        if file_id not in current:
            db.add(FileRef(file_id=file_id, owner_type="document_project", owner_id=project.id))
        file = files[file_id]
        file.status = "bound"
        file.expires_at = None
    for file_id in current - set(ids):
        _release_unreferenced(db, file_id)


def _release_unreferenced(db: Session, file_id: int) -> None:
    remaining = db.scalar(select(FileRef.id).where(FileRef.file_id == file_id).limit(1))
    if remaining:
        return
    file = db.get(FileObject, file_id)
    if file and file.status == "bound":
        file.status = "staged"
        file.expires_at = utcnow() + timedelta(hours=settings.staged_ttl_hours)


def _get(db: Session, project_id: int, user: User, lock: bool = False) -> DocumentProject:
    stmt = select(DocumentProject).where(DocumentProject.id == project_id)
    project = db.scalar(stmt.with_for_update() if lock else stmt)
    if not project or project.user_id != user.id:
        raise ApiError("NOT_FOUND", "项目不存在", 404)
    return project


@router.get("/document-projects")
def list_projects(
    kind: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(DocumentProject).where(DocumentProject.user_id == user.id)
    if kind:
        stmt = stmt.where(DocumentProject.kind == _check_kind(kind))
    rows = db.scalars(stmt.order_by(DocumentProject.updated_at.desc(), DocumentProject.id.desc())).all()
    return {"items": [_payload(db, project, user) for project in rows]}


@router.get("/document-projects/{project_id}")
def read_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _payload(db, _get(db, project_id, user), user, detail=True)


@router.post("/document-projects", status_code=201)
def create_project(payload: ProjectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    kind = _check_kind(payload.kind)
    _check_state(payload.state)
    project = DocumentProject(
        user_id=user.id,
        kind=kind,
        title=payload.title.strip()[:200] or "未命名项目",
        state=payload.state,
        version=1,
    )
    db.add(project)
    db.flush()
    _sync_refs(db, project, payload.attachment_ids)
    db.commit()
    db.refresh(project)
    return _payload(db, project, user, detail=True)


@router.put("/document-projects/{project_id}")
def update_project(
    project_id: int, payload: ProjectIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    project = _get(db, project_id, user)
    if payload.kind != project.kind:
        raise ApiError("PROJECT_KIND_IMMUTABLE", "项目类型不能修改", 422)
    if payload.version is None:
        raise ApiError("VERSION_REQUIRED", "保存项目时必须提供当前版本", 422)
    _check_state(payload.state)
    title = payload.title.strip()[:200] or "未命名项目"
    result = db.execute(
        update(DocumentProject)
        .where(
            DocumentProject.id == project_id,
            DocumentProject.user_id == user.id,
            DocumentProject.version == payload.version,
        )
        .values(
            title=title,
            state=payload.state,
            version=DocumentProject.version + 1,
            updated_at=utcnow(),
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        current = db.scalar(select(DocumentProject.version).where(
            DocumentProject.id == project_id, DocumentProject.user_id == user.id,
        ))
        raise ApiError(
            "VERSION_CONFLICT", "项目已在其他标签页更新，请重新打开后再保存",
            409, {"current_version": current},
        )
    db.flush()
    db.expire_all()
    project = _get(db, project_id, user)
    _sync_refs(db, project, payload.attachment_ids)
    db.commit()
    db.refresh(project)
    return _payload(db, project, user, detail=True)


@router.delete("/document-projects/{project_id}")
def delete_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get(db, project_id, user)
    refs = db.scalars(
        select(FileRef).where(FileRef.owner_type == "document_project", FileRef.owner_id == project.id)
    ).all()
    file_ids = [ref.file_id for ref in refs]
    for ref in refs:
        db.delete(ref)
    db.delete(project)
    db.flush()
    for file_id in file_ids:
        _release_unreferenced(db, file_id)
    db.commit()
    return {"deleted": True}
