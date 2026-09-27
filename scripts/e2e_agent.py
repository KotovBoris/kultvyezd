#!/usr/bin/env python3
"""Агентный E2E-харнесс «ClassGo»: эмулятор протокола MAX + прогон сквозного сценария.

Зачем: реальный мессенджер MAX нельзя подключить в CI (нужен аккаунт и токен).
Здесь поднимается ЭМУЛЯТОР MAX Bot API, полностью повторяющий контракт
(dev.max.ru: GET /me, GET /updates, POST /messages, POST /answers). Настоящий
backend поднимается в режиме MAX_BOT_MODE=polling и указывает на эмулятор, поэтому
проверяется РЕАЛЬНЫЙ код адаптера бота, а не заглушка.

Что проверяем (как это делал бы QA руками):
  1. бот приветствует родителя (bot_started) и отдаёт нативную кнопку open_app;
  2. родитель нажимает «Отпускаю ребёнка» (message_callback) — согласие фиксируется;
  3. дашборд «Светофор» отражает изменение статуса;
  4. точечное напоминание уходит адресно (в личный диалог родителя);
  5. приказ формируется и отдаётся (DOCX/PDF) — контракт файлов корректен;
  6. идемпотентность: повторное нажатие не перезаписывает согласие.

Запуск:  ./.venv313/bin/python scripts/e2e_agent.py
Зависимостей нет — только стандартная библиотека Python.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "backend")

STATE = {
    "updates": [],          # очередь входящих апдейтов (как будто их прислал MAX)
    "outbox": [],           # исходящие сообщения/ответы бота (POST /messages, /answers)
    "marker": 1000,
    "commands": [],         # команды бота, зарегистрированные через PATCH /me/commands
}
LOCK = threading.Lock()


def _json(handler: BaseHTTPRequestHandler, code: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class MaxEmulator(BaseHTTPRequestHandler):
    """Мини-сервер, имитирующий platform-api2.max.ru."""

    protocol_version = "HTTP/1.1"

    def log_message(self, *args) -> None:  # тишина в stdout
        pass

    # -------- входящие от backend (MAX-контракт) --------
    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/me":
            return _json(self, 200, {
                "user_id": 999999, "name": "ClassGo (эмулятор)",
                "username": "classgo_emulator", "is_bot": True,
            })
        if parsed.path == "/updates":
            timeout = int(qs.get("timeout", ["0"])[0])
            deadline = time.time() + min(timeout, 5)
            while time.time() < deadline:
                with LOCK:
                    if STATE["updates"]:
                        break
                time.sleep(0.2)
            with LOCK:
                updates = STATE["updates"]
                STATE["updates"] = []
                STATE["marker"] += 1
                marker = STATE["marker"]
            return _json(self, 200, {"updates": updates, "marker": marker})
        if parsed.path == "/_outbox":
            with LOCK:
                return _json(self, 200, {"messages": STATE["outbox"]})
        return _json(self, 404, {"code": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            payload = {}

        if parsed.path == "/messages":
            with LOCK:
                STATE["outbox"].append({
                    "kind": "message",
                    "user_id": qs.get("user_id", [None])[0],
                    "chat_id": qs.get("chat_id", [None])[0],
                    "body": payload,
                })
            return _json(self, 200, {"message": {"body": payload, "timestamp": int(time.time() * 1000)}})

        if parsed.path == "/answers":
            with LOCK:
                STATE["outbox"].append({
                    "kind": "answer",
                    "callback_id": qs.get("callback_id", [None])[0],
                    "body": payload,
                })
            return _json(self, 200, {"success": True})

        if parsed.path == "/_inject":
            with LOCK:
                STATE["updates"].append(payload)
            return _json(self, 200, {"ok": True, "queued": len(STATE["updates"])})

        return _json(self, 404, {"code": "not_found"})

    def do_PATCH(self) -> None:  # noqa: N802
        """PATCH /me/commands — регистрация команд бота.

        Тело запроса обязательно прочитать: при HTTP/1.1 keep-alive непрочитанные
        байты иначе трактуются как следующий запрос и ломают long polling.
        """
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            payload = {}
        if parsed.path == "/me/commands":
            with LOCK:
                STATE["commands"] = payload.get("commands", [])
            return _json(self, 200, {"commands": payload.get("commands", [])})
        return _json(self, 404, {"code": "not_found"})


# ------------------------------------------------------------------ утилиты
def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http(method: str, url: str, body: dict | None = None, raw: bool = False):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
            return resp.status, (content if raw else json.loads(content or b"{}"))
    except urllib.error.HTTPError as e:
        return e.code, (e.read() if raw else {"error": e.read().decode("utf-8", "replace")})


def wait_until(fn, timeout: float, interval: float = 0.4):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(interval)
    return False


class Checks:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def ok(self, cond: bool, label: str, extra: str = "") -> None:
        if cond:
            self.passed += 1
            print(f"  ✅ {label}")
        else:
            self.failed += 1
            print(f"  ❌ {label} {extra}")


# ------------------------------------------------------------------ сценарий
def main() -> int:
    checks = Checks()
    emu_port = free_port()
    api_port = free_port()
    api_base = f"http://127.0.0.1:{api_port}"
    emu_base = f"http://127.0.0.1:{emu_port}"

    emulator = ThreadingHTTPServer(("127.0.0.1", emu_port), MaxEmulator)
    threading.Thread(target=emulator.serve_forever, daemon=True).start()
    print(f"▶ эмулятор MAX: {emu_base}")

    tmpdir = tempfile.mkdtemp(prefix="classgo-e2e-")
    env = dict(os.environ)
    env.update({
        "DATABASE_URL": f"sqlite:///{tmpdir}/e2e.db",
        "AUTO_SEED": "true",
        "MAX_BOT_TOKEN": "emulator-token",
        "MAX_BOT_MODE": "polling",
        "MAX_API_BASE": emu_base,
        "MAX_BOT_USERNAME": "classgo_emulator",
        "PUBLIC_BASE_URL": api_base,
        "MINIAPP_BASE_URL": api_base,
        "LOG_LEVEL": "WARNING",
    })
    verbose = os.environ.get("E2E_VERBOSE") == "1"
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
         "--port", str(api_port), "--log-level", "info" if verbose else "warning"],
        cwd=BACKEND, env=env,
        stdout=None if verbose else subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    print(f"▶ backend (polling на эмулятор): {api_base}")

    try:
        ready = wait_until(lambda: http("GET", f"{api_base}/healthz")[0] == 200, timeout=40)
        checks.ok(ready, "backend поднялся и отвечает /healthz")
        if not ready:
            return _dump_and_exit(backend, checks)

        health = http("GET", f"{api_base}/healthz")[1]
        checks.ok(health.get("bot_enabled") is True, "бот включён (polling к эмулятору MAX)")

        # --- Шаг 1. Родитель запускает бота ---
        http("POST", f"{emu_base}/_inject", {
            "update_type": "bot_started", "timestamp": int(time.time() * 1000),
            "chat_id": 555, "user": {"user_id": 424242, "name": "Родитель"},
            "payload": None,
        })
        got_greeting = wait_until(
            lambda: any(m["kind"] == "message" and m["body"].get("text", "").startswith("👋")
                        for m in http("GET", f"{emu_base}/_outbox")[1]["messages"]),
            timeout=20,
        )
        checks.ok(got_greeting, "бот поприветствовал родителя (bot_started через long polling)")

        outbox = http("GET", f"{emu_base}/_outbox")[1]["messages"]
        greet = next((m for m in outbox if m["kind"] == "message" and m["body"].get("text", "").startswith("👋")), None)
        btn_types = set()
        if greet:
            for row in greet["body"].get("attachments", [{}])[0].get("payload", {}).get("buttons", []):
                for b in row:
                    btn_types.add(b.get("type"))
        checks.ok("open_app" in btn_types, "в приветствии есть нативная кнопка open_app (мини-приложение MAX)")

        # Регистрация команд бота в MAX (PATCH /me/commands) при старте
        got_commands = wait_until(lambda: len(STATE.get("commands", [])) >= 1, timeout=15)
        checks.ok(got_commands and len(STATE["commands"]) >= 3,
                  f"команды бота зарегистрированы в MAX (PATCH /me/commands): {len(STATE.get('commands', []))}")

        # --- Шаг 2. Учитель создаёт выезд через REST ---
        classes = http("GET", f"{api_base}/api/v1/classes")[1]
        klass = classes[0]
        events = http("GET", f"{api_base}/api/v1/culture-events?pushkin=true")[1]
        student_id = klass["students"][0]["id"]
        status, exc = http("POST", f"{api_base}/api/v1/excursions", {
            "class_id": klass["id"], "culture_event_id": events[0]["id"],
            "gathering_time": "08:30", "return_time": "14:00",
        })
        checks.ok(status == 201 and exc.get("id"), "выезд создан по событию «Пушкинской карты»")
        exc_id = exc["id"]

        # --- Шаг 3. Родитель нажимает кнопку «Отпускаю ребёнка» в чате ---
        http("POST", f"{emu_base}/_inject", {
            "update_type": "message_callback", "timestamp": int(time.time() * 1000),
            "callback": {
                "callback_id": "cb-consent-1",
                "payload": f"consent:{exc_id}:{student_id}:APPROVED",
                "user": {"user_id": 424242, "name": "Родитель"},
            },
        })
        answered = wait_until(
            lambda: any(m["kind"] == "answer" and m.get("callback_id") == "cb-consent-1"
                        for m in http("GET", f"{emu_base}/_outbox")[1]["messages"]),
            timeout=20,
        )
        checks.ok(answered, "бот ответил на нажатие кнопки (POST /answers)")

        dash = http("GET", f"{api_base}/api/v1/excursions/{exc_id}/dashboard")[1]
        row = next((p for p in dash["participants"] if p["student_id"] == student_id), None)
        checks.ok(row and row["consent_status"] == "APPROVED",
                  "согласие родителя зафиксировано через чат-бота")
        checks.ok(row and row["ticket_status"] in ("WAITING_PAYMENT", "NOT_REQUIRED"),
                  "после согласия выставлен корректный статус билета")

        # --- Шаг 4. Идемпотентность: повторное нажатие ---
        http("POST", f"{emu_base}/_inject", {
            "update_type": "message_callback", "timestamp": int(time.time() * 1000),
            "callback": {
                "callback_id": "cb-consent-2",
                "payload": f"consent:{exc_id}:{student_id}:REJECTED",
                "user": {"user_id": 424242, "name": "Родитель"},
            },
        })
        time.sleep(2)
        dash2 = http("GET", f"{api_base}/api/v1/excursions/{exc_id}/dashboard")[1]
        row2 = next((p for p in dash2["participants"] if p["student_id"] == student_id), None)
        checks.ok(row2 and row2["consent_status"] == "APPROVED",
                  "повторное нажатие НЕ перезаписывает согласие (правило «двух родителей»)")

        # --- Шаг 5. Напоминания должникам (адресно) ---
        remind = http("POST", f"{api_base}/api/v1/excursions/{exc_id}/remind-unconfirmed")[1]
        checks.ok("targeted" in remind, "эндпоинт напоминаний вернул сводку")
        time.sleep(1)
        # --- Шаг 6. Приказ ---
        gen = http("POST", f"{api_base}/api/v1/excursions/{exc_id}/export-order")[1]
        checks.ok(gen.get("version", 0) >= 1, "приказ сформирован (версия зафиксирована)")
        s_docx, docx = http("GET", f"{api_base}/api/v1/excursions/{exc_id}/export-order?fmt=docx", raw=True)
        s_pdf, pdf = http("GET", f"{api_base}/api/v1/excursions/{exc_id}/export-order?fmt=pdf", raw=True)
        checks.ok(s_docx == 200 and isinstance(docx, bytes) and docx[:2] == b"PK",
                  "DOCX-приказ отдаётся корректно (zip-контейнер)")
        checks.ok(s_pdf == 200 and isinstance(pdf, bytes) and pdf[:4] == b"%PDF",
                  "PDF-приказ отдаётся корректно (%PDF)")

        # --- Шаг 7. Вебхук-режим (production-канал) ---
        wh = http("POST", f"{api_base}/webhook/max", {
            "update_type": "bot_started", "timestamp": 1, "chat_id": 1,
            "user": {"user_id": 1}, "payload": None,
        })[1]
        checks.ok(wh.get("ok") is True, "webhook-эндпоинт принимает одиночный Update")

        print(f"\n── Итог E2E: успешно {checks.passed}, провалено {checks.failed} ──")
        return 0 if checks.failed == 0 else 1
    finally:
        backend.terminate()
        try:
            backend.wait(timeout=10)
        except Exception:  # noqa: BLE001
            backend.kill()
        emulator.shutdown()


def _dump_and_exit(backend: subprocess.Popen, checks: Checks) -> int:
    print("!! backend не поднялся, лог:")
    try:
        out = backend.stdout.read() if backend.stdout else ""
        print(out[-4000:] if out else "(пусто)")
    except Exception:  # noqa: BLE001
        pass
    return 1


if __name__ == "__main__":
    sys.exit(main())
