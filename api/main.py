import os
import shlex
import subprocess
import sys
import time
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse


def _load_env_file(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                name, value = line.split("=", 1)
                name = name.strip()
                value = value.strip().strip('"')
                if name and name not in os.environ:
                    os.environ[name] = value
    except Exception:
        pass


# Load local .env if present
_load_env_file(os.getenv("ENV_FILE", ".env"))


app = FastAPI(title="PBFT Viz Test API (Minimal)")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise HTTPException(status_code=400, detail=f"Missing required env: {name}")
    return val


def build_ssh_command(remote: str, remote_cmd: str) -> List[str]:
    args: List[str] = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    proxy_jump = os.getenv("CLIENT_SSH_JUMP")
    if proxy_jump:
        args += ["-J", proxy_jump]
    args.append(remote)
    args.append(remote_cmd)
    return args


def _open_rpk_stream():
    rpk_bin = os.getenv("RPK_BIN", "rpk")
    topic = _require_env("REDPANDA_TOPIC")
    brokers = _require_env("REDPANDA_BROKERS")
    remote = os.getenv("RPK_SSH")  # e.g., "user@central-vm"
    remote_jump = os.getenv("RPK_SSH_JUMP")

    if remote:
        # Run rpk on the remote (central VM) via SSH
        remote_cmd = f"{shlex.quote(rpk_bin)} topic produce {shlex.quote(topic)} --brokers {shlex.quote(brokers)}"
        args = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
        ]
        if remote_jump:
            args += ["-J", remote_jump]
        args += [remote, remote_cmd]
        proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return proc

    # Run rpk locally
    try:
        proc = subprocess.Popen(
            [rpk_bin, "topic", "produce", topic, "--brokers", brokers],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return proc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="rpk not found; install Redpanda rpk or set RPK_SSH to run remotely") from exc


def stream_client_output():
    """Stream client stdout and forward each line to Redpanda via rpk."""
    remote = _require_env("CLIENT_SSH")
    client_cmd = _require_env("CLIENT_CMD")

    rpk_proc = _open_rpk_stream()

    cmd = build_ssh_command(remote, client_cmd)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    try:
        for line in proc.stdout:
            out = line if line.endswith("\n") else (line + "\n")
            if rpk_proc.stdin:
                rpk_proc.stdin.write(out)
                rpk_proc.stdin.flush()
            yield out
        proc.wait()
        if proc.returncode != 0:
            err = (proc.stderr.read() if proc.stderr else "").strip()
            raise HTTPException(status_code=502, detail=f"SSH/client failed: {err}")
    finally:
        if rpk_proc.stdin:
            try:
                rpk_proc.stdin.flush()
                rpk_proc.stdin.close()
            except Exception:
                pass
        try:
            rpk_proc.wait(timeout=2)
        except Exception:
            rpk_proc.kill()


@app.get("/health")
async def health():
    return {"status": "ok", "ts": _now_iso()}


@app.get("/client/run")
def client_run_stream():
    return StreamingResponse(stream_client_output(), media_type="text/plain")


if __name__ == "__main__":
    try:
        import uvicorn  # type: ignore
    except Exception:
        print("Install deps: pip install fastapi uvicorn", file=sys.stderr)
        raise SystemExit(1)
    uvicorn.run("api.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
