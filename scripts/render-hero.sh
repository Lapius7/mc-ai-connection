#!/bin/sh
# ヒーロー画像を作る。uv と Python 3.11 が要る。bpy は初回に自動で取得する。
cd "$(dirname "$0")/.." && exec uv run --python 3.11 --with bpy --with pillow python scripts/render-hero.py
