"""Tests for scripts/loop/ — goal_check routing + marathon_guard lock (AMM-001).

Each test builds a sandbox repo fixture (docs/loop/GOALS.md + copied scripts)
and drives the real scripts via subprocess, asserting exit codes and the
GOALS.md queue-rewrite behaviour.
"""

import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

SDK_ROOT = Path(__file__).resolve().parent.parent.parent
GOAL_CHECK = SDK_ROOT / "scripts" / "loop" / "goal_check"
MARATHON_GUARD = SDK_ROOT / "scripts" / "loop" / "marathon_guard"

GOALS_TEMPLATE = """# GOALS.md

```yaml
state: RUNNING
mode: OFF
current_action: >-
      test
done_condition: >-
      test
blocked_on: >-
      none
updated: 2026-09-19 (test)
```

## goal_queue

{queue_block}

## 推进规则
"""


def make_fixture(tmp_path: Path, queue_entries: str) -> Path:
    root = tmp_path / "repo"
    (root / "docs" / "loop").mkdir(parents=True)
    (root / "scripts" / "loop").mkdir(parents=True)
    queue_block = (
        "```yaml\ngoal_queue:\n" + queue_entries + "\n```"
        if queue_entries
        else "```yaml\ngoal_queue: []\n```"
    )
    (root / "docs" / "loop" / "GOALS.md").write_text(
        GOALS_TEMPLATE.format(queue_block=queue_block), encoding="utf-8"
    )
    shutil.copy(GOAL_CHECK, root / "scripts" / "loop" / "goal_check")
    shutil.copy(MARATHON_GUARD, root / "scripts" / "loop" / "marathon_guard")
    return root


def run_goal_check(root: Path):
    return subprocess.run(
        ["bash", str(root / "scripts" / "loop" / "goal_check")],
        capture_output=True, text=True, timeout=60,
    )


def entry(eid: str, check_cmd: str, track: str = "engineering") -> str:
    return textwrap.dedent(f"""\
        - id: {eid}
            track: {track}
            goal: 测试目标 {eid}
            done_condition: {eid} 完成
            check_cmd: {check_cmd}""")


def test_gate_red_when_gate_script_fails(tmp_path):
    root = make_fixture(tmp_path, entry("A", "true"))
    # 伪造一个必红的门禁脚本(goal_check 对存在的脚本非零退出判 GATE-RED)
    gate = root / "scripts" / "check_claims.py"
    gate.write_text("import sys; sys.exit(1)\n")
    r = run_goal_check(root)
    assert r.returncode == 4
    assert "GATE-RED" in r.stdout


def test_missing_gate_scripts_degrade_to_queue_routing(tmp_path):
    # 无门禁脚本(缺失而非红)→ 降级纯队列路由,不阻塞
    root = make_fixture(tmp_path, entry("A", "true"))
    r = run_goal_check(root)
    assert r.returncode == 0
    assert "ACHIEVED" in r.stdout
    assert "降级跳过" in r.stdout


def test_not_achieved_when_check_cmd_fails(tmp_path):
    root = make_fixture(tmp_path, entry("A", "false"))
    r = run_goal_check(root)
    assert r.returncode == 1
    assert "NOT-Achieved" in r.stdout
    # 队列未被弹出
    assert "- id: A" in (root / "docs" / "loop" / "GOALS.md").read_text()


def test_achieved_pops_top_and_promotes(tmp_path):
    two = entry("A", "true") + "\n" + entry("B", "true", track="governance")
    root = make_fixture(tmp_path, two)
    r = run_goal_check(root)
    assert r.returncode == 0
    goals = (root / "docs" / "loop" / "GOALS.md").read_text()
    assert "- id: A" not in goals, "已弹出的目标不得留在队列"
    assert "- id: B" in goals, "下一位应晋升"
    assert "晋升 B" in r.stdout


def test_queue_empty_exit_2(tmp_path):
    root = make_fixture(tmp_path, "")
    r = run_goal_check(root)
    assert r.returncode == 2
    assert "QUEUE-EMPTY" in r.stdout


def test_empty_check_cmd_guarded_as_not_achieved(tmp_path):
    # Physic 轮 62 教训:空 check_cmd ⇒ subprocess.call("") == 0 ⇒ 假阳性弹队。
    # 路由器必须按未达成处理。
    root = make_fixture(tmp_path, entry("A", ""))
    r = run_goal_check(root)
    assert r.returncode == 1
    assert "假阳性防护" in r.stdout
    assert "- id: A" in (root / "docs" / "loop" / "GOALS.md").read_text()


def test_marathon_guard_no_lock_allows(tmp_path):
    root = make_fixture(tmp_path, "")
    (root / "scripts" / "loop" / "goal_check").touch()  # 占位,不影响 guard
    r = subprocess.run(
        ["bash", str(root / "scripts" / "loop" / "marathon_guard")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0


def test_marathon_guard_fresh_lock_busy(tmp_path):
    root = make_fixture(tmp_path, "")
    lock = root / ".loop-lock"
    lock.write_text("0")
    r = subprocess.run(
        ["bash", str(root / "scripts" / "loop" / "marathon_guard")],
        capture_output=True, text=True,
    )
    assert r.returncode == 1
    assert "BUSY" in r.stdout


def test_real_repo_goal_check_runs_gate_green_queue_route():
    # 真仓冒烟:三 lint 应全绿 → 不触发 GATE-RED;队首目标是未完成的真实
    # 目标 → NOT-Achieved(1)。只验退出码语义,不改真仓 GOALS。
    r = subprocess.run(
        ["bash", str(GOAL_CHECK)], capture_output=True, text=True, timeout=120,
        cwd=SDK_ROOT,
    )
    assert r.returncode in (1, 2), (
        f"真仓应为 NOT-Achieved(1) 或 QUEUE-EMPTY(2);GATE-RED(4) 或其他 = 门禁/路由异常\n"
        f"stdout: {r.stdout}\nstderr: {r.stderr}"
    )
