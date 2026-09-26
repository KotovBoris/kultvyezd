# КультВыезд — частые команды. Запуск: make <цель>
.PHONY: help up down reset logs test test-fast shots doctor presentation lint

help:
	@echo "КультВыезд — доступные команды:"
	@echo "  make up            — поднять всё (docker compose up --build)"
	@echo "  make down          — остановить"
	@echo "  make reset         — сбросить демо-выезд к исходному состоянию"
	@echo "  make logs          — логи backend (поток)"
	@echo "  make test          — полный прогон (pytest+vitest+E2E+docker+UI)"
	@echo "  make test-fast     — быстрый прогон (без docker и UI)"
	@echo "  make shots         — скриншоты UI (Playwright) + копия в docs/screenshots"
	@echo "  make presentation  — собрать PDF-презентацию"
	@echo "  make doctor        — диагностика интеграции с MAX"

up:
	docker compose up -d --build
	@echo "mini-app: http://localhost:8080   Swagger: http://localhost:8080/docs"

down:
	docker compose down

reset:
	curl -s -X POST http://localhost:8080/api/v1/admin/reset-demo | python3 -m json.tool || true

logs:
	docker compose logs -f backend

test:
	./scripts/run_all_tests.sh

test-fast:
	./scripts/run_all_tests.sh --fast

shots:
	cd ui-e2e && (npx playwright install chromium >/dev/null 2>&1 || true) && npx playwright test --project=desktop
	@mkdir -p docs/screenshots
	@for f in ui-e2e/screenshots/*.png; do sips -Z 900 "$$f" --out "docs/screenshots/$$(basename $$f)" >/dev/null 2>&1 || cp "$$f" "docs/screenshots/"; done
	@echo "скриншоты обновлены в docs/screenshots/"

presentation:
	./backend/.venv313/bin/python scripts/build_presentation.py https://github.com/KotovBoris/kultvyezd

doctor:
	python3 scripts/doctor.py
