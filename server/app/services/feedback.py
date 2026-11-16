"""GitHub Issue 反馈：配置校验、建单与失败重试。"""

from __future__ import annotations

import re
from datetime import datetime

import httpx

from ..config import settings
from ..errors import ApiError
from ..models import FeedbackIntegration, FeedbackSubmission, utcnow
from ..utils import iso_z
from .encryption import decrypt_config, encrypt_config, mask

REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
KINDS = {"bug": "Bug 反馈", "feature": "需求建议"}
_API = "https://api.github.com"


class FeedbackSendError(Exception):
    pass


def valid_repo(repo: str | None) -> str:
    value = (repo or "").strip()
    if not REPO_RE.fullmatch(value) or ".." in value:
        raise ApiError("INVALID_REPO", "仓库格式应为 owner/repo", 422)
    return value


def clean_labels(labels: list | None) -> list[str]:
    result: list[str] = []
    for item in labels or []:
        value = str(item).strip()
        if value and value not in result:
            result.append(value[:50])
        if len(result) >= 10:
            break
    return result


def config_payload(config: FeedbackIntegration | None) -> dict:
    if config is None:
        return {
            "repo": "", "enabled": False, "labels": [], "configured": False,
            "masked_token": "", "last_test_ok": None, "last_test_message": None,
            "last_tested_at": None,
        }
    token = ""
    decrypt_error = None
    if config.encrypted_token:
        try:
            token = str(decrypt_config(config.encrypted_token).get("token") or "")
        except ApiError:
            decrypt_error = "已保存的令牌无法解密，请重新填写"
    return {
        "repo": config.repo or "",
        "enabled": bool(config.enabled),
        "labels": list(config.labels or []),
        "configured": bool(token),
        "masked_token": mask(token),
        "decrypt_error": decrypt_error,
        "last_test_ok": config.last_test_ok,
        "last_test_message": config.last_test_message,
        "last_tested_at": iso_z(config.last_tested_at),
    }


def save_config(
    config: FeedbackIntegration, *, repo: str | None, token: str | None,
    labels: list | None, enabled: bool | None,
) -> FeedbackIntegration:
    if repo is not None:
        config.repo = valid_repo(repo) if repo.strip() else None
    if token is not None and token.strip():
        config.encrypted_token = encrypt_config({"token": token.strip()})
    if labels is not None:
        config.labels = clean_labels(labels)
    if enabled is not None:
        config.enabled = enabled
    if config.enabled:
        if not config.repo:
            raise ApiError("FEEDBACK_INCOMPLETE", "启用前请填写 GitHub 仓库", 422)
        if not config.encrypted_token:
            raise ApiError("FEEDBACK_INCOMPLETE", "启用前请填写 GitHub 访问令牌", 422)
    return config


def submission_payload(row: FeedbackSubmission) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "kind_label": KINDS.get(row.kind, row.kind),
        "title": row.title,
        "body": row.body,
        "status": row.status,
        "issue_number": row.issue_number,
        "issue_url": row.issue_url,
        "error": row.error,
        "attempts": row.attempts,
        "environment": row.environment or {},
        "has_logs": bool(row.log_snapshot),
        "sent_at": iso_z(row.sent_at),
        "created_at": iso_z(row.created_at),
    }


def _token(config: FeedbackIntegration) -> str:
    if not config.encrypted_token:
        raise FeedbackSendError("尚未配置 GitHub 访问令牌")
    try:
        token = str(decrypt_config(config.encrypted_token).get("token") or "")
    except ApiError as error:
        raise FeedbackSendError(error.message) from error
    if not token:
        raise FeedbackSendError("尚未配置 GitHub 访问令牌")
    return token


def _request(method: str, url: str, token: str, **kwargs) -> httpx.Response:
    """单点出站调用，测试可以直接替换。"""
    return httpx.request(
        method,
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "workbench-feedback",
        },
        timeout=settings.feedback_timeout_seconds,
        follow_redirects=False,
        **kwargs,
    )


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
        detail = body.get("message") or ""
    except Exception:
        detail = (response.text or "")[:200]
    mapping = {
        401: "令牌无效或已过期",
        403: "令牌权限不足或触发 GitHub 限流",
        404: "仓库不存在，或令牌没有该仓库权限",
        410: "该仓库已关闭 Issue 功能",
        422: "GitHub 拒绝了这次提交，请检查仓库和标签设置",
    }
    base = mapping.get(response.status_code, f"GitHub 返回 {response.status_code}")
    return f"{base}：{detail}"[:1000] if detail else base


def test_connection(config: FeedbackIntegration) -> tuple[bool, str]:
    if not config.repo:
        return False, "请先填写仓库"
    token = _token(config)
    response = _request("GET", f"{_API}/repos/{config.repo}/issues", token, params={"per_page": 1, "state": "all"})
    if response.status_code in {200, 204}:
        return True, f"连接成功：{config.repo} 可读写 Issue"
    return False, _error_message(response)


def build_issue_body(
    *, body: str, kind: str, environment: dict, log_snapshot: str | None, submission_id: int,
) -> str:
    env = environment or {}
    lines = [
        body.strip() or "（未填写详细描述）",
        "",
        "---",
        "### 环境信息",
        f"- 类型：{KINDS.get(kind, kind)}",
        f"- 提交编号：#{submission_id}",
        f"- 时间：{env.get('submitted_at') or datetime.now().isoformat(timespec='seconds')}",
        f"- 页面：{env.get('route') or '-'}",
        f"- 地址：{env.get('url') or '-'}",
        f"- 浏览器：{env.get('user_agent') or '-'}",
        f"- 视口：{env.get('viewport') or '-'}",
        f"- 应用版本：{env.get('app_version') or '-'}",
        f"- 请求 ID：{env.get('request_id') or '-'}",
    ]
    if log_snapshot:
        lines += ["", "### 最近日志", "```text", log_snapshot.strip()[:12_000], "```"]
    else:
        lines += ["", "### 最近日志", "（未附加）"]
    return "\n".join(lines)[:60_000]


def create_issue(config: FeedbackIntegration, *, title: str, body: str, kind: str) -> tuple[int, str, str | None]:
    token = _token(config)
    labels = clean_labels(config.labels)
    payload: dict = {"title": title[:200], "body": body}
    if labels:
        payload["labels"] = labels
    response = _request("POST", f"{_API}/repos/{config.repo}/issues", token, json=payload)
    note = None
    if response.status_code == 422 and labels:
        payload.pop("labels", None)
        response = _request("POST", f"{_API}/repos/{config.repo}/issues", token, json=payload)
        note = "标签不存在，已忽略标签提交"
    if response.status_code != 201:
        raise FeedbackSendError(_error_message(response))
    try:
        data = response.json()
        number = int(data["number"])
        url = str(data["html_url"])
    except Exception as error:
        raise FeedbackSendError("GitHub 返回了无法识别的内容") from error
    return number, url, note


def send_submission(db, submission: FeedbackSubmission, config: FeedbackIntegration | None) -> FeedbackSubmission:
    if config is None or not config.enabled or not config.repo:
        submission.status = "failed"
        submission.error = "反馈发送未启用或缺少仓库配置"
        db.commit()
        return submission
    submission.attempts += 1
    body = build_issue_body(
        body=submission.body,
        kind=submission.kind,
        environment=submission.environment or {},
        log_snapshot=submission.log_snapshot,
        submission_id=submission.id,
    )
    prefix = "[Bug]" if submission.kind == "bug" else "[需求]"
    try:
        number, url, note = create_issue(
            config, title=f"{prefix} {submission.title}", body=body, kind=submission.kind,
        )
    except FeedbackSendError as error:
        submission.status = "failed"
        submission.error = str(error)[:1000]
    except Exception as error:
        submission.status = "failed"
        submission.error = f"发送失败：{type(error).__name__}"[:1000]
    else:
        submission.status = "sent"
        submission.issue_number = number
        submission.issue_url = url
        submission.error = note
        submission.sent_at = utcnow()
    db.commit()
    return submission
