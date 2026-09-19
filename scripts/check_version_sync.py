#!/usr/bin/env python3
"""check_version_sync.py — 包版本与 CHANGELOG 最新发布节一致性 lint。

发布工程纪律（2026-09-08 版本漂移事故的守门）：包元数据里的 version 必须
等于其 CHANGELOG 最新「已发布」版本节——`## [Unreleased]` 允许存在于顶部
（未发布变更），但 `pyproject.toml`/`package.json` 的 version 只能指向
已发布节。违反即 exit 1：否则 publish 流水线会把新功能以旧版本号发出
（本次事故：pyproject 2.6.0 vs CHANGELOG 已发布 2.7.0）。

被检包对（存在才检）：python(python/pyproject.toml)、typescript、
local、openclaw、setup-cli、browser-extension(package.json)。

用法：python3 scripts/check_version_sync.py [--root PATH]
纯标准库。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# (标签, 元数据文件, 类型)
PACKAGES = (
    ("python", "python/pyproject.toml", "pyproject"),
    ("typescript", "typescript/package.json", "json"),
    ("local", "local/package.json", "json"),
    ("openclaw", "openclaw/package.json", "json"),
    ("setup-cli", "setup-cli/package.json", "json"),
    ("browser-extension", "browser-extension/package.json", "json"),
)

PYPROJECT_VER_RE = re.compile(r'^version\s*=\s*"([^"]+)"', re.M)
CHANGELOG_VER_RE = re.compile(r"^##\s*\[(\d+\.\d+\.\d+[^\]]*)\]")


def meta_version(path: Path, kind: str) -> str | None:
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    if kind == "pyproject":
        m = PYPROJECT_VER_RE.search(text)
    else:
        m = re.search(r'"version"\s*:\s*"([^"]+)"', text)
    return m.group(1) if m else None


def changelog_latest_release(path: Path) -> str | None:
    if not path.is_file():
        return None
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = CHANGELOG_VER_RE.match(ln)
        if m:
            return m.group(1).strip()
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="包版本 ↔ CHANGELOG 一致性 lint")
    ap.add_argument("--root", default=None)
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parent.parent

    failures: list[str] = []
    checked = 0
    for name, meta_rel, kind in PACKAGES:
        meta = root / meta_rel
        changelog = meta.parent / "CHANGELOG.md"
        ver = meta_version(meta, kind)
        rel = changelog_latest_release(changelog)
        if ver is None or rel is None:
            continue  # 无元数据或无 CHANGELOG 的包不检
        checked += 1
        if ver != rel:
            failures.append(f"{name}: 元数据 version={ver} ≠ CHANGELOG 最新发布 {rel}（{meta_rel}）")

    print(f"check_version_sync — 检查 {checked} 个包的版本 ↔ CHANGELOG 一致性")
    if failures:
        print("\n违规：")
        for msg in failures:
            print(f"  - {msg}")
        print("\n处理方式：对齐包元数据 version 与 CHANGELOG 最新发布节（先发布后 bump，"
              "或 bump 后补发布节）；`## [Unreleased]` 顶部节不参与比对。")
        return 1
    print("PASS: 全部包版本与 CHANGELOG 最新发布一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
