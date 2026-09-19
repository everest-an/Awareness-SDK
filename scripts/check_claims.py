#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_claims.py — GOVERNANCE §7 主张登记簿机械校验（claims-register linter）。

用途
----
把 GOVERNANCE.md §7「主张登记簿」的人眼纪律变成可机械执行的 lint（可挂 CI）：
扫描对外主张面 README 中的数字主张（百分比、分数/计数），逐条判定其是否
① 已登记于 §7 / CLAIMS.md（allowlist），或 ② 行内/表格上下文带出处标注。
两者皆无 → 违规。

F-073（CLAIMS.md 模式，2026-09-08 采纳）叠加的机械检查：
- **§7↔CLAIMS 对账**：§7 与 CLAIMS.md Active 区的数字集合必须一致（先登记
  后引用 = 两处同时登记；只改其一 exit 1）；
- **撤回复活检测**：CLAIMS.md Withdrawn/Superseded 区的数字再出现在对外
  README → exit 1（无论是否带出处，撤回纪律机械化）；
- **时效警告**：Active 主张「最后核实」超 90 天 → stale 警告（对标 eslint
  CLAIMS.md 的 verification-pending 横幅纪律）。

判定规则（逐行，仅扫描代码围栏外的正文/表格/HTML）
--------------------------------------------------
1. 主张识别：行内含百分比（``96.0%``，含徽章 URL 编码形式 ``96.0%25``）或
   分数/计数（``480/500``）即视为数字主张行。
2. 合规当且仅当（满足其一）：
   a. 行内数字全部登记于 §7 表格或 CLAIMS.md Active 行（数值等价集合）；
   b. 该行带出处标注：markdown 链接 ``[..](http..)``、非本机 URL、HTML href、
      或「出处」字样；
   c. 该行是 markdown 表格行，且行内出现第三方系统名（Mem0/Zep/MemPalace 等
      对比目标）——引用第三方评测数字的对比行本身就是引用；
   d. 该行所在表格块的相邻（±2 行）脚注/引言含链接（根 README 的 benchmark
      对比表即此形态：表尾 ``> Honest comparisons only — see [..](..)``）。
3. 豁免（有意为之，非放松）：
   - 代码围栏内（```` ``` ````）的行：ASCII 渲染的基准产物输出、示例命令/配置，
     不是作者行文主张；证据本体是 §7/CLAIMS 产物列指向的文件。--verbose 会列
     出围栏内识别到的数字以供审计。
   - 行内代码 span（`` `...` ``）与 HTML 布局属性（width/height/style）。
   - §7/CLAIMS 产物/依据列指向的文件本身整体豁免（它们就是证据）。
4. 退出码：0 = 全部合规；1 = 存在违规（未登记主张 / 撤回复活 / §7↔CLAIMS
   不一致）；2 = GOVERNANCE.md 或 CLAIMS.md 缺失、§7 标题/登记表不存在。

如何登记新主张
--------------
双登记：① 改 GOVERNANCE.md §7 表格新增一行；② 在 CLAIMS.md Active 区新增
C-xxx 行（数字列写全等价写法，附证据锚点/复现命令/最后核实日期）。两处数字
集合不一致 → 本脚本 exit 1。单字符数字（R@5 的 5、版本号、日期）不入
allowlist（碰撞面太大）。

用法
----
    python3 scripts/check_claims.py [--verbose] [--root PATH]

纯标准库，无第三方依赖。新增对外 README 时请同步加进 SCAN_TARGETS。
"""

from __future__ import annotations

import argparse
import fnmatch
import re
import sys
from pathlib import Path

# --------------------------------------------------------------- configuration

GOVERNANCE_FILENAME = "GOVERNANCE.md"
CLAIMS_FILENAME = "CLAIMS.md"
STALENESS_DAYS = 90  # eslint CLAIMS.md 模式：超 90 天未核实 = stale 警告

# 对外主张面（存在才扫）。新增对外 README 时在此登记。
SCAN_TARGETS = (
    "README.md",
    "python/README.md",
    "local/README.md",
    "typescript/README.md",
    "openclaw/README.md",
    "setup-cli/README.md",
    "claudecode/README.md",
    "opencode/README.md",
    "browser-extension/README.md",
)

# 第三方对比目标：markdown 表格行内出现这些名字时，行内数字视为已标注出处
# （对比第三方评测数字的行本身就是引用；出处的完整义务由表格脚注/对比文档承担）。
THIRD_PARTY_MARKERS = (
    "Mem0",
    "MemPalace",
    "Zep",
    "Graphiti",
    "OMEGA",
    "Mastra",
    "Supermemory",
    "GPT-4",
    "GPT-5",
)

# 主张模式：百分比（含徽章 URL 编码 96.0%25 中的 "96.0%"）与分数/计数。
PCT_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*%")
FRAC_RE = re.compile(r"(?<![\w./%])(\d+)\s*/\s*(\d+)(?![\w./])")

# 出处标记。
MD_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(https?://[^)\s]+)")
BARE_URL_RE = re.compile(r"(?<![(\[])https?://\S+")
LOCAL_URL_RE = re.compile(r"https?://(?:localhost|127\.0\.0\.1)\S*", re.IGNORECASE)
CITE_WORD = "出处"

# 提取 allowlist 前的清洗。
DATE_RE = re.compile(r"\d{4}-\d{1,2}-\d{1,2}")  # 2026-09-06 之类日期不是主张
TABLE_SEP_RE = re.compile(r"^\s*\|[\s:\-|]*\|\s*$")
STANDALONE_NUM_RE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)*)(?:[a-zA-Z]{1,3})?(?![\w.])")
PATHLIKE_RE = re.compile(r"[A-Za-z0-9_\-\./\*]+\.(?:md|json|jsonl|mjs|txt|log)")

# 扫描前剔除的非主张载体。
LAYOUT_ATTR_RE = re.compile(r"(?i)\b(?:width|height|style)\s*=\s*(?:\"[^\"]*\"|'[^']*')")
INLINE_CODE_RE = re.compile(r"`[^`\n]*`")
FENCE_RE = re.compile(r"^\s*(?:```|~~~)")

# §7 标题定位。
SECTION_HEADING_RE = re.compile(r"^#{1,6}\s+7\.\s+")
SECTION_HEADING_KEYWORD = "主张登记簿"


# ------------------------------------------------------------------- §7 解析

def extract_section7(text: str) -> list[str] | None:
    """返回 §7 小节的行列表；找不到标题返回 None。"""
    lines = text.splitlines()
    start = None
    for i, ln in enumerate(lines):
        if SECTION_HEADING_RE.match(ln) and SECTION_HEADING_KEYWORD in ln:
            start = i
            break
        if ln.startswith("#") and SECTION_HEADING_KEYWORD in ln:
            start = i
            break
    if start is None:
        return None
    body: list[str] = []
    for ln in lines[start + 1 :]:
        if re.match(r"^#{1,6}\s", ln) or re.match(r"^-{3,}\s*$", ln):
            break
        body.append(ln)
    return body


def extract_table_rows(section: list[str]) -> list[str]:
    rows = [ln for ln in section if ln.lstrip().startswith("|")]
    return [ln for ln in rows if not TABLE_SEP_RE.match(ln)]


def extract_allowlist(rows: list[str]) -> set[float]:
    """从 §7 表格行提取已登记数字（数值等价集合）。

    覆盖三类：百分比、a/b 分数（两侧分别登记）、独立数值（如 96.0 / 95.8 /
    500Q 的 500 / 0.2pp 的 0.2）。日期、版本号（两点以上）、前导零 ID（053/09）、
    单字符整数（R@5 的 5、差 1 题的 1）一律不入集，避免 allowlist 被稀释。
    """
    values: set[float] = set()
    for row in rows:
        cleaned = DATE_RE.sub(" ", row)
        for m in PCT_RE.finditer(cleaned):
            values.add(float(m.group(1)))
        for m in FRAC_RE.finditer(cleaned):
            values.add(float(m.group(1)))
            values.add(float(m.group(2)))
        for m in STANDALONE_NUM_RE.finditer(cleaned):
            tok = m.group(1)
            if "." in tok:
                if tok.count(".") >= 2:  # 版本号，如 transformers.js 3.8.1
                    continue
                values.add(float(tok))
            else:
                if len(tok) > 1 and tok.startswith("0"):  # 前导零 ID，如 f053 / 09
                    continue
                if float(tok) < 10:  # 单字符整数碰撞面太大（R@5、差 1 题）
                    continue
                values.add(float(tok))
    return values


def extract_product_paths(rows: list[str]) -> set[str]:
    """§7「产物/依据」列（第 4 列）指向的文件路径 → 整体豁免对象。"""
    paths: set[str] = set()
    for row in rows:
        cells = [c.strip() for c in row.split("|")]
        # split 后 cells[0] 为空串，产物列为第 4 列即 index 4。
        evidence = cells[4] if len(cells) > 4 else (cells[-1] if cells else "")
        for tok in PATHLIKE_RE.findall(evidence):
            paths.add(tok.strip("./"))
    return paths


# -------------------------------------------------------------- CLAIMS.md 解析（F-073）

CLAIM_ID_RE = re.compile(r"^C-\d{3,}$")
CLAIMS_SECTION_RE = re.compile(r"^##\s+(Active|Withdrawn|Superseded)\s*$")


def parse_claims_md(path: Path) -> dict:
    """解析 CLAIMS.md → {active/withdrawn/superseded: [row-dict]}。

    row-dict: {id, numbers:set[float], last_verified: date|None, raw}.
    占位行（id 非 C-xxx）与表头/分隔行自动跳过。
    """
    import datetime as _dt

    sections: dict[str, list[dict]] = {"Active": [], "Withdrawn": [], "Superseded": []}
    current: str | None = None
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = CLAIMS_SECTION_RE.match(ln)
        if m:
            current = m.group(1)
            continue
        if current is None or not ln.lstrip().startswith("|"):
            continue
        if TABLE_SEP_RE.match(ln):
            continue
        cells = [c.strip() for c in ln.split("|")]
        cid = cells[1].strip() if len(cells) > 1 else ""
        if not CLAIM_ID_RE.match(cid):
            continue  # 表头行 / （暂无）占位行
        dates = DATE_RE.findall(ln)
        last_verified = None
        if dates:
            y, mo, d = (int(x) for x in dates[-1].split("-"))
            last_verified = _dt.date(y, mo, d)
        sections[current].append(
            {
                "id": cid,
                "numbers": extract_allowlist([ln]),
                "last_verified": last_verified,
                "raw": ln,
            }
        )
    return sections


# -------------------------------------------------------------- 主张识别与判定

def detect_claims(line: str) -> list[dict]:
    claims: list[dict] = []
    for m in PCT_RE.finditer(line):
        claims.append({"kind": "percent", "text": m.group(0), "numbers": [float(m.group(1))]})
    for m in FRAC_RE.finditer(line):
        claims.append(
            {
                "kind": "fraction",
                "text": m.group(0),
                "numbers": [float(m.group(1)), float(m.group(2))],
            }
        )
    return claims


def has_citation(line: str) -> bool:
    """出处标记：markdown 链接（非本机）、裸 URL（非本机）、HTML href、「出处」。"""
    if CITE_WORD in line:
        return True
    for m in MD_LINK_RE.finditer(line):
        if not LOCAL_URL_RE.match(m.group(1)):
            return True
    without_local = LOCAL_URL_RE.sub(" ", line)
    if BARE_URL_RE.search(without_local):
        return True
    return False


def is_third_party_row(line: str) -> bool:
    return any(marker in line for marker in THIRD_PARTY_MARKERS)


def table_blocks(lines: list[str]) -> list[tuple[int, int]]:
    """连续的以 | 开头的行组成一个表格块（0-based 闭区间）。"""
    row_idx = [i for i, ln in enumerate(lines) if ln.lstrip().startswith("|")]
    blocks: list[tuple[int, int]] = []
    start = prev = None
    for i in row_idx:
        if prev is not None and i == prev + 1:
            prev = i
            continue
        if start is not None:
            blocks.append((start, prev))
        start = prev = i
    if start is not None:
        blocks.append((start, prev))
    return blocks


def block_is_sourced(lines: list[str], s: int, e: int) -> bool:
    """表格块自身或相邻 ±2 行（脚注/引言）含出处标记。"""
    for i in list(range(s, e + 1)) + [s - 1, s - 2, e + 1, e + 2]:
        if 0 <= i < len(lines) and has_citation(lines[i]):
            return True
    return False


def is_product_file(rel: str, products: set[str]) -> bool:
    rel_norm = rel.replace("\\", "/")
    for p in products:
        if rel_norm == p or rel_norm.endswith("/" + p):
            return True
        if "*" in p and (fnmatch.fnmatch(rel_norm, p) or fnmatch.fnmatch(rel_norm, "*/" + p)):
            return True
    return False


# --------------------------------------------------------------------- 扫描

def scan_file(
    path: Path, rel: str, allowlist: set[float], products: set[str],
    retracted: set[float] | None = None,
) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    blocks = table_blocks(lines)
    block_of: dict[int, tuple[int, int]] = {}
    for s, e in blocks:
        for i in range(s, e + 1):
            block_of[i] = (s, e)
    sourced = {bi: block_is_sourced(lines, s, e) for bi, (s, e) in enumerate(blocks)}
    block_index_of = {block: bi for bi, block in enumerate(blocks)}

    violations: list[dict] = []
    ledger: list[dict] = []  # 全部识别到的主张（--verbose 用）
    fenced_claims = 0

    in_fence = False
    for idx, raw in enumerate(lines):
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            continue

        work = LAYOUT_ATTR_RE.sub(" ", raw)
        work = INLINE_CODE_RE.sub(" ", work)
        claims = detect_claims(work)

        if in_fence:
            fenced_claims += len(claims)
            for c in claims:
                ledger.append(
                    {
                        "file": rel,
                        "lineno": idx + 1,
                        "raw": raw,
                        "claim": c,
                        "status": "SKIP-FENCE",
                        "reasons": ["代码围栏内（产物渲染/示例，按设计豁免）"],
                    }
                )
            continue

        if not claims:
            continue

        cited = has_citation(raw)
        third_party = is_third_party_row(raw)
        blk = block_of.get(idx)
        blk_sourced = sourced[block_index_of[blk]] if blk is not None else False
        is_table_row = blk is not None

        for c in claims:
            unregistered = [n for n in c["numbers"] if n not in allowlist]
            allowlisted = not unregistered
            revived = [n for n in c["numbers"] if retracted and n in retracted]
            reasons = []
            if allowlisted:
                reasons.append("已登记于 §7/CLAIMS")
            if cited:
                reasons.append("行内出处（链接/出处标记）")
            if third_party:
                reasons.append("第三方对比行")
            if blk_sourced:
                reasons.append("表格脚注出处")
            ok = allowlisted or cited or third_party or blk_sourced
            status = "OK" if ok else "FAIL"
            if not ok:
                violations.append(
                    {
                        "file": rel,
                        "lineno": idx + 1,
                        "raw": raw,
                        "claim": c,
                        "unregistered": unregistered,
                    }
                )
            if revived:
                # F-073 撤回复活：无论是否带出处，撤回数字不得再出现在对外 README
                violations.append(
                    {
                        "file": rel,
                        "lineno": idx + 1,
                        "raw": raw,
                        "claim": c,
                        "unregistered": [],
                        "retracted": revived,
                    }
                )
            ledger.append(
                {
                    "file": rel,
                    "lineno": idx + 1,
                    "raw": raw,
                    "claim": c,
                    "status": status,
                    "reasons": reasons,
                    "unregistered": unregistered,
                }
            )

    return {
        "file": rel,
        "violations": violations,
        "ledger": ledger,
        "fenced_claims": fenced_claims,
    }


# --------------------------------------------------------------------- 输出

def fmt_nums(nums: list[float]) -> str:
    out = []
    for n in nums:
        out.append(str(int(n)) if float(n).is_integer() else str(n))
    return ",".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="GOVERNANCE §7 主张登记簿机械校验：README 数字主张必须已登记或带出处。"
    )
    ap.add_argument("--verbose", action="store_true", help="列出全部识别到的主张及判定依据")
    ap.add_argument("--root", default=None, help="仓库根目录（默认：脚本所在目录的上一级）")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parent.parent
    gov_path = root / GOVERNANCE_FILENAME

    # ---- exit 2 分支：GOVERNANCE.md 缺失 / §7 表不存在
    if not gov_path.is_file():
        print(f"[FATAL] {gov_path} 不存在：无主张登记簿可校验", file=sys.stderr)
        return 2
    section = extract_section7(gov_path.read_text(encoding="utf-8"))
    if section is None:
        print("[FATAL] GOVERNANCE.md 中未找到 §7 主张登记簿标题", file=sys.stderr)
        return 2
    rows = extract_table_rows(section)
    if not rows:
        print("[FATAL] §7 主张登记簿下没有登记表格行", file=sys.stderr)
        return 2

    allowlist = extract_allowlist(rows)
    products = extract_product_paths(rows)

    # ---- F-073: CLAIMS.md 解析与 §7↔CLAIMS 对账
    claims_path = root / CLAIMS_FILENAME
    if not claims_path.is_file():
        print(f"[FATAL] {claims_path} 不存在：F-073 已采纳，主张-证据映射文件为必需品", file=sys.stderr)
        return 2
    claims = parse_claims_md(claims_path)

    all_ids = [r["id"] for sec in claims.values() for r in sec]
    dupes = sorted({i for i in all_ids if all_ids.count(i) > 1})
    s7_numbers = allowlist
    claims_active_numbers: set[float] = set()
    for r in claims["Active"]:
        claims_active_numbers |= r["numbers"]
    claims_all_numbers: set[float] = set()
    for sec in claims.values():
        for r in sec:
            claims_all_numbers |= r["numbers"]

    consistency_failures: list[str] = []
    if dupes:
        consistency_failures.append(f"claim-id 重复: {dupes}")
    missing_in_claims = sorted(s7_numbers - claims_all_numbers)
    if missing_in_claims:
        consistency_failures.append(
            f"§7 数字未映射到 CLAIMS.md（双登记缺失）: {fmt_nums(missing_in_claims)}"
        )
    missing_in_s7 = sorted(claims_active_numbers - s7_numbers)
    if missing_in_s7:
        consistency_failures.append(
            f"CLAIMS Active 数字未登记于 §7（双登记缺失）: {fmt_nums(missing_in_s7)}"
        )

    # 撤回复活检测集：Withdrawn/Superseded 的数字（扣除仍 Active 的——同数字
    # 被新主张重新登记时不再视为撤回面）
    retracted = claims_all_numbers - claims_active_numbers

    print("check_claims — GOVERNANCE §7 + CLAIMS.md 主张登记机械校验（F-070/F-073）")
    print(f"  登记簿: {gov_path} （{len(rows)} 行登记）")
    active_n = len(claims["Active"])
    wd_n, sp_n = len(claims["Withdrawn"]), len(claims["Superseded"])
    print(f"  CLAIMS: {claims_path} （active {active_n} / withdrawn {wd_n} / superseded {sp_n}）")
    print(f"  allowlist: {sorted(allowlist)}")
    if products:
        print(f"  产物豁免: {sorted(products)}")

    # ---- F-073: 90 天时效警告（不阻断，对标 eslint verification-pending 横幅）
    import datetime as _dt
    today = _dt.date.today()
    for r in claims["Active"]:
        lv = r["last_verified"]
        if lv is not None and (today - lv).days > STALENESS_DAYS:
            print(f"  [STALE] {r['id']} 最后核实 {lv}（{(today - lv).days} 天前）"
                  f"——引用前必须复跑复现命令刷新")

    results = []
    for rel in SCAN_TARGETS:
        f = root / rel
        if not f.is_file():
            print(f"  [skip] {rel}（不存在）")
            continue
        if is_product_file(rel, products):
            print(f"  [skip] {rel}（§7 产物/依据指向的文件，整体豁免）")
            continue
        results.append(scan_file(f, rel, allowlist, products, retracted=retracted))

    total_claims = sum(len(r["ledger"]) for r in results)
    total_fail = sum(len(r["violations"]) for r in results)
    total_fenced = sum(r["fenced_claims"] for r in results)

    if args.verbose:
        print("\n-- 主张明细（--verbose）--")
        for r in results:
            for item in r["ledger"]:
                c = item["claim"]
                head = f"{item['file']}:{item['lineno']}  {c['kind']} \"{c['text']}\""
                if item["status"] == "SKIP-FENCE":
                    print(f"  [SKIP-FENCE] {head}  {'; '.join(item['reasons'])}")
                elif item["status"] == "OK":
                    print(f"  [OK]         {head}  → {'; '.join(item['reasons'])}")
                else:
                    missed = fmt_nums(item["unregistered"])
                    print(f"  [FAIL]       {head}  → 未登记数字 {missed}，且无出处标注")
        print(f"  （另有 {total_fenced} 条数字位于代码围栏内，按设计豁免，已列入审计明细）")

    print(f"\n扫描 {len(results)} 个主张面文件，识别主张 {total_claims} 条。")

    if consistency_failures:
        print("\n§7↔CLAIMS 一致性违规（F-073 双登记）：")
        for msg in consistency_failures:
            print(f"  - {msg}")
        print("\n处理方式：在 GOVERNANCE.md §7 与 CLAIMS.md Active 区同时登记"
              "（数字列写全等价写法），或从两处同时移除。")
        return 1

    if total_fail:
        unreg = [v for r in results for v in r["violations"] if "retracted" not in v]
        revived = [v for r in results for v in r["violations"] if "retracted" in v]
        if unreg:
            print(f"\n违规 {len(unreg)} 条（未登记于 §7/CLAIMS 且无出处）：")
            for r in results:
                for v in r["violations"]:
                    if "retracted" in v:
                        continue
                    c = v["claim"]
                    print(f"  {v['file']}:{v['lineno']}  {c['kind']} \"{c['text']}\""
                          f"（未登记数字: {fmt_nums(v['unregistered'])}）")
                    print(f"      | {v['raw'].strip()[:120]}")
        if revived:
            print(f"\n撤回主张复活 {len(revived)} 条（F-073：Withdrawn/Superseded 数字"
                  "不得再出现在对外 README）：")
            for r in results:
                for v in r["violations"]:
                    if "retracted" not in v:
                        continue
                    c = v["claim"]
                    print(f"  {v['file']}:{v['lineno']}  {c['kind']} \"{c['text']}\""
                          f"（撤回数字: {fmt_nums(v['retracted'])}）")
                    print(f"      | {v['raw'].strip()[:120]}")
        print("\n处理方式：将数字双登记进 GOVERNANCE.md §7 与 CLAIMS.md（附复现命令"
              "与产物），或删除该主张，或补充出处链接。撤回复活类：删除文案或走正式"
              "撤回/替代流程后重新引用。")
        return 1

    print("PASS: 全部数字主张已登记（§7+CLAIMS 双登记一致），无撤回复活。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
