#!/usr/bin/env python3
"""check_adr_index.py — docs/decisions/README.md 索引与 ADR 文件一致性 lint。

治理谱系的机械校验（对标 check_claims 的思路：索引不许说谎）：
1. docs/decisions/ 下每个 F-xxx-*.md 文件必须在索引表中有一行；
2. 索引表每一行必须指向真实存在的文件；
3. 索引行的「状态」必须与文件头部的「**状态**:」行一致（防索引说谎——
   F-071 事故中索引与文件状态曾短暂不一致）。

退出码：0 = 一致；1 = 存在缺失/多余/状态不一致；2 = 索引或目录不存在。

用法：python3 scripts/check_adr_index.py [--root PATH]
纯标准库。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ADR_FILE_RE = re.compile(r"^(?:F|ADR)-\d{3}-[a-z0-9\-]+\.md$")
INDEX_ROW_RE = re.compile(r"^\|\s*\[?((?:F|ADR)-\d{3})\]?\(([^)]+)\)\s*\|")
STATUS_LINE_RE = re.compile(r"-\s*\*\*状态\*\*:\s*(.+)")


def parse_index(path: Path) -> dict[str, dict]:
    """索引表 → {F-id: {file, status}}。"""
    out: dict[str, dict] = {}
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = INDEX_ROW_RE.match(ln)
        if not m:
            continue
        fid, fname = m.group(1), m.group(2).strip()
        status = ""
        cells = [c.strip() for c in ln.split("|")]
        if len(cells) >= 4:
            status = cells[3]
        out[fid] = {"file": fname, "status": status}
    return out


def parse_file_status(path: Path) -> str:
    for ln in path.read_text(encoding="utf-8").splitlines()[:12]:
        m = STATUS_LINE_RE.search(ln)
        if m:
            return m.group(1).strip()
    return ""


def normalize_status(s: str) -> str:
    """索引与文件状态按首个词归一（Accepted/Proposed/Superseded/Deprecated/Discontinued）。"""
    head = s.split("（")[0].split("(")[0].strip()
    return head.rstrip("。；;").strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="ADR 索引一致性 lint")
    ap.add_argument("--root", default=None)
    args = ap.parse_args(argv)
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parent.parent
    index_path = root / "docs" / "decisions" / "README.md"
    dir_path = root / "docs" / "decisions"
    if not index_path.is_file() or not dir_path.is_dir():
        print("[FATAL] docs/decisions/README.md 或目录不存在", file=sys.stderr)
        return 2

    index = parse_index(index_path)
    files = sorted(p.name for p in dir_path.glob("*.md") if ADR_FILE_RE.match(p.name))

    failures: list[str] = []
    for fid, entry in sorted(index.items()):
        f = dir_path / entry["file"]
        if not f.is_file():
            failures.append(f"{fid}: 索引指向的文件不存在: {entry['file']}")
            continue
        fstatus = parse_file_status(f)
        istatus = normalize_status(entry["status"])
        fstatus_n = normalize_status(fstatus)
        if istatus and fstatus_n and istatus != fstatus_n:
            failures.append(
                f"{fid}: 状态不一致 — 索引「{istatus}」vs 文件「{fstatus_n}」"
            )
    indexed_files = {e["file"] for e in index.values()}
    for fname in files:
        if fname not in indexed_files:
            failures.append(f"{fname}: 文件存在但索引缺失一行")

    print(f"check_adr_index — {len(index)} 行索引 / {len(files)} 个 ADR 文件")
    if failures:
        print("\n违规：")
        for msg in failures:
            print(f"  - {msg}")
        print("\n处理方式：同步索引与文件（状态行/文件名/索引行三者一致）。")
        return 1
    print("PASS: 索引与 ADR 文件完全一致（存在性 + 状态）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
