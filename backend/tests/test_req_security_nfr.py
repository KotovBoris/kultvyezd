"""Требования SEC-*, NFR-* (docs/REQUIREMENTS.md)."""
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import make_excursion

REPO = Path(__file__).resolve().parents[2]  # .../kultvyezd


def test_SEC_1_no_token_in_repo() -> None:
    """Токена нет в исходниках и данных. Локальный .env (gitignored) и кэш исключаются."""
    skip_names = {".env", ".env.local"}
    skip_dirs = {".git", "node_modules", "__pycache__", ".pytest_cache", ".venv", ".venv313", "data"}
    this_file = Path(__file__).name
    offending = []
    for p in REPO.rglob("*"):
        if not p.is_file():
            continue
        if p.name in skip_names or this_file in str(p) or p.name == ".gitignore":
            continue
        if any(part in skip_dirs or ".venv" in part for part in p.parts):
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".pdf", ".ico", ".zip", ".whl", ".pyc"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:  # noqa: BLE001
            continue
        if "f9LHodD0cOJSRhoZ" in text:
            offending.append(str(p.relative_to(REPO)))
    assert not offending, f"токен найден в файлах: {offending}"


def test_SEC_2_env_ignored() -> None:
    gi = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert re.search(r"^\.env$|^\.env\b", gi, re.M), ".env должен быть в .gitignore"


def test_SEC_3_env_example_without_secrets() -> None:
    example = (REPO / ".env.example").read_text(encoding="utf-8")
    assert "MAX_BOT_TOKEN=" in example
    token_line = next(l for l in example.splitlines() if l.startswith("MAX_BOT_TOKEN="))
    assert token_line.strip() == "MAX_BOT_TOKEN=", "в .env.example токена быть не должно"


def test_SEC_4_token_from_env_only() -> None:
    # В исходниках не должно быть литералов токена — только чтение из настроек.
    for f in (REPO / "backend" / "app").rglob("*.py"):
        text = f.read_text(encoding="utf-8")
        assert "f9LHodD0cOJSRhoZ" not in text, f"токен в коде: {f}"
    cfg = (REPO / "backend" / "app" / "config.py").read_text(encoding="utf-8")
    assert "getenv" in cfg or "BaseSettings" in cfg


def test_SEC_5_mock_data_declared(client: TestClient) -> None:
    meta = client.get("/api/v1/meta").json()
    assert meta["dataset"]["is_mock"] is True
    events = client.get("/api/v1/culture-events").json()
    assert all(e["source"] for e in events)


def test_SEC_6_errors_have_detail_no_traceback(client: TestClient) -> None:
    r = client.get("/api/v1/excursions/999999/dashboard")
    assert r.status_code == 404
    body = r.json()
    assert "detail" in body
    assert "Traceback" not in r.text


def test_SEC_7_dependencies_pinned() -> None:
    req = (REPO / "backend" / "requirements.txt").read_text(encoding="utf-8")
    pinned = [l for l in req.splitlines() if l.strip() and not l.startswith("#")]
    assert all("==" in l for l in pinned), "все зависимости должны быть с точной версией"
    pkg = (REPO / "miniapp" / "package.json").read_text(encoding="utf-8")
    assert '"react"' in pkg


# --------------------------------------------------------------- NFR
def test_NFR_3_repeat_scenario_stable(client: TestClient, first_class) -> None:
    for _ in range(2):
        exc = make_excursion(client, first_class)
        for s in first_class["students"][:3]:
            client.post(f"/api/v1/excursions/{exc['id']}/consent",
                        json={"student_id": s["id"], "status": "APPROVED"})
        assert client.get(f"/api/v1/excursions/{exc['id']}/dashboard").status_code == 200


def test_NFR_5_openapi_paths_reachable(client: TestClient) -> None:
    spec = client.get("/openapi.json").json()
    # все GET-пути без параметров должны отвечать не 404/405
    checked = 0
    for path, ops in spec["paths"].items():
        if "{" in path or "get" not in ops:
            continue
        r = client.get(path)
        assert r.status_code not in (404, 405), f"{path} -> {r.status_code}"
        checked += 1
    assert checked >= 5
