"""
Gradle service: run Gradle wrapper tasks as subprocesses.
All tasks run synchronously and stream output; the caller decides
whether to run in a thread/background task.
"""
import subprocess
import shutil
import sys
import time
from pathlib import Path


def _gradlew(project_dir: str) -> str:
    """Return the path to gradlew (or gradlew.bat on Windows)."""
    if sys.platform == "win32":
        return str(Path(project_dir) / "gradlew.bat")
    return str(Path(project_dir) / "gradlew")


def _run(project_dir: str, task: str, extra_props: dict | None = None,
         timeout: int = 600, extra_args: list | None = None) -> tuple[int, str]:
    """
    Run `./gradlew <task> [-P...] [extra_args]` in project_dir.
    Returns (returncode, combined stdout+stderr output).
    """
    cmd = [_gradlew(project_dir), task]
    if extra_props:
        for k, v in extra_props.items():
            cmd.append(f"-P{k}={v}")
    if extra_args:
        cmd.extend(extra_args)

    try:
        result = subprocess.run(
            cmd,
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = result.stdout + result.stderr
        return result.returncode, output
    except subprocess.TimeoutExpired as e:
        output = (e.stdout or b"").decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        return 124, f"TIMEOUT after {timeout}s\n{output}"


def _build_props(project_dir: str, dataset_name: str, root_iri: str,
                 local_maven_repo: str) -> dict:
    return {
        "datasetName":    dataset_name,
        "rootIri":        root_iri,
        "localMavenRepo": local_maven_repo,
        "projectTitle":   dataset_name,
        "projectName":    dataset_name,
    }


def _kill_port_3030() -> str:
    """Force-kill any process listening on port 3030. Returns a log line."""
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["cmd", "/c", "netstat -ano"],
                capture_output=True, text=True, timeout=10
            )
            pids = set()
            for line in result.stdout.splitlines():
                if ":3030" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if parts:
                        pids.add(parts[-1])
            for pid in pids:
                subprocess.run(["cmd", "/c", f"taskkill /F /PID {pid}"],
                               capture_output=True, timeout=10)
            if pids:
                time.sleep(2)  # wait for OS to release the port
                return f"Killed PIDs on port 3030: {pids}"
            return "Port 3030 was already free."
        else:
            result = subprocess.run(
                ["lsof", "-ti", "tcp:3030"],
                capture_output=True, text=True, timeout=10
            )
            pids = result.stdout.strip().split()
            for pid in pids:
                subprocess.run(["kill", "-9", pid], capture_output=True, timeout=10)
            if pids:
                time.sleep(2)
                return f"Killed PIDs on port 3030: {pids}"
            return "Port 3030 was already free."
    except Exception as e:
        return f"Warning: could not clear port 3030: {e}"


def _wait_for_fuseki(dataset_name: str, retries: int = 10, delay: float = 2.0) -> bool:
    """Poll until Fuseki responds on the expected dataset endpoint."""
    import urllib.request
    import urllib.error
    url = f"http://localhost:3030/{dataset_name}/sparql?query=ASK%7B%7D"
    for _ in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status < 500:
                    return True
        except urllib.error.HTTPError as e:
            if e.code < 500:
                return True  # 400/405 still means Fuseki is up
        except Exception:
            pass
        time.sleep(delay)
    return False


def run_build(project_dir: str, dataset_name: str, root_iri: str,
              local_maven_repo: str) -> tuple[bool, str]:
    """Run omlToOwl + owlReason (validates OML against UAOS). Returns (success, log)."""
    props = _build_props(project_dir, dataset_name, root_iri, local_maven_repo)
    code, log = _run(project_dir, "owlReason", props, timeout=300)
    return code == 0, log


def run_stop_fuseki(project_dir: str) -> tuple[bool, str]:
    """Stop Fuseki."""
    code, log = _run(project_dir, "stopFuseki", timeout=30)
    return code == 0, log


def run_full_pipeline(project_dir: str, dataset_name: str, root_iri: str,
                      local_maven_repo: str) -> tuple[bool, str]:
    """
    Full pipeline: owlReason → startFuseki → owlQuery.
    build/oml/ is pre-seeded from the template so downloadDependencies is always
    UP-TO-DATE — no re-download, no pre-clean needed.
    Returns (success, combined_log).
    """
    props = _build_props(project_dir, dataset_name, root_iri, local_maven_repo)
    full_log = []

    # Kill any running Fuseki so port 3030 is free for startFuseki.
    # (Fuseki holds the TDB dataset lock, not build/oml — no need to touch build/oml.)
    kill_log = _kill_port_3030()
    full_log.append(f"=== PORT CLEANUP ===\n{kill_log}")

    # Pre-clean Gradle output dirs (owl, reports) from any previous run.
    # build/oml is intentionally left alone — it's the pre-seeded UAOS stack.
    # Use rename as fallback if rmdir fails due to Windows file locks.
    build_dir = Path(project_dir) / "build"
    for sub in ["owl", "reports"]:
        target = build_dir / sub
        if not target.exists():
            continue
        try:
            if sys.platform == "win32":
                subprocess.run(["cmd", "/c", f"rmdir /s /q \"{target}\""],
                               capture_output=True, timeout=15)
            else:
                shutil.rmtree(target)
        except Exception:
            pass
        if target.exists():
            # Rename fallback — atomic on Windows even with locked children
            try:
                target.rename(build_dir / f"{sub}_old_{int(time.time())}")
            except Exception as e:
                full_log.append(f"=== PRE-CLEAN WARNING ===\nCould not clear {sub}/: {e}")

    # Step 1: Validate + reason.
    # build/oml/ is pre-seeded from the template so we explicitly exclude
    # downloadDependencies from the task graph — it is never needed.
    code, log = _run(project_dir, "owlReason", props, timeout=300,
                     extra_args=["-x", "downloadDependencies"])
    full_log.append("=== BUILD ===\n" + log)
    if code != 0:
        return False, "\n".join(full_log)

    # Step 2: Start Fuseki
    code, log = _run(project_dir, "startFuseki", props, timeout=60)
    full_log.append("=== START FUSEKI ===\n" + log)
    if code != 0:
        return False, "\n".join(full_log)

    # Step 3: Wait for Fuseki to be ready
    ready = _wait_for_fuseki(dataset_name, retries=15, delay=2.0)
    full_log.append(f"=== FUSEKI READY CHECK ===\n{'Ready' if ready else 'Timed out waiting'}")
    if not ready:
        return False, "\n".join(full_log)

    # Step 4: Load + Query
    code, log = _run(project_dir, "owlQuery", props, timeout=300,
                     extra_args=["-x", "downloadDependencies"])
    full_log.append("=== LOAD + QUERY ===\n" + log)
    return code == 0, "\n".join(full_log)
