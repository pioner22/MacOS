SHELL := /usr/bin/env bash
.SHELLFLAGS := -o pipefail -c

WEB_CLIENT_PORT ?= 5173
VITE_HOST ?= 0.0.0.0
WS_GATEWAY_HOST ?= 127.0.0.1
WS_GATEWAY_PORT ?= 8787
GATEWAY_URL ?= ws://$(WS_GATEWAY_HOST):$(WS_GATEWAY_PORT)/ws
SERVER_PORT ?= 7777

.PHONY: help deps dev typecheck test build preview desktop-dev desktop-build desktop-dist desktop-dist-mac desktop-dist-mac-unsigned desktop-dist-win desktop-dist-linux

help:
	@echo "Yagodka macOS/Electron client commands:"
	@echo "  make deps                         # npm install"
	@echo "  make dev                          # Vite dev server"
	@echo "  make typecheck                    # tsc --noEmit"
	@echo "  make test                         # node test runner"
	@echo "  make build                        # Vite/PWA assets"
	@echo "  make desktop-dev                  # Electron shell against local Vite URL"
	@echo "  make desktop-build                # unpacked Electron app"
	@echo "  make desktop-dist-mac-unsigned    # unsigned macOS ZIP + feed"

deps:
	npm install

dev: deps
	VITE_GATEWAY_URL="$(GATEWAY_URL)" npm run dev -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

typecheck: deps
	npm run typecheck

test: deps
	npm run test

build: deps
	npm run build

preview: deps
	npm run preview -- --host $(VITE_HOST) --port $(WEB_CLIENT_PORT)

desktop-dev: deps
	npm run desktop:dev

desktop-build: deps
	npm run desktop:build

desktop-dist: deps
	npm run desktop:dist

desktop-dist-mac: deps
	npm run desktop:dist:mac

desktop-dist-mac-unsigned: deps
	npm run desktop:dist:mac:unsigned

desktop-dist-win: deps
	npm run desktop:dist:win

desktop-dist-linux: deps
	npm run desktop:dist:linux
