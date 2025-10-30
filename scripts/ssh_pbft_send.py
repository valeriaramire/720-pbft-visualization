import argparse
import os
import shlex
import subprocess
import sys
import time


def build_ssh_cmd(target: str, jump: str | None, agent_forward: bool, force_tty: bool, remote_cmd: str, identity: str | None) -> list[str]:
    cmd: list[str] = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if agent_forward:
        cmd.append("-A")
    if identity:
        cmd += ["-i", identity]
    if force_tty:
        cmd.append("-tt")
    if jump:
        cmd += ["-J", jump]
    cmd += [target, remote_cmd]
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SSH to client-1 and send a PBFT request (e.g., 'Hello World') to ./pbft_demo client config-pbft-client-1.txt",
    )
    parser.add_argument("--target", default=os.getenv("PBFT_SSH_TARGET", "daehan@client-1"), help="SSH target, e.g. user@client-1")
    parser.add_argument("--jump", default=os.getenv("PBFT_SSH_JUMP", "daehan@206.12.94.249"), help="Optional jump, e.g. user@206.12.94.249")
    parser.add_argument("--no-agent-forward", action="store_true", help="Disable -A agent forwarding")
    parser.add_argument("--no-tty", action="store_true", help="Do not request a TTY (-tt)")
    parser.add_argument("--workdir", default=os.getenv("PBFT_WORKDIR", ""), help="Remote directory to cd into before running the command")
    parser.add_argument(
        "--command",
        default=os.getenv("PBFT_COMMAND", "./pbft_demo client config-pbft-client-1.txt"),
        help="Remote PBFT client command to run",
    )
    parser.add_argument("--request", default=os.getenv("PBFT_REQUEST", "Hello World"), help="Request string to send to PBFT client")
    parser.add_argument("--timeout", type=int, default=int(os.getenv("PBFT_TIMEOUT", "30")), help="Max seconds to wait before exiting")
    parser.add_argument("--identity", default=os.getenv("PBFT_SSH_IDENTITY", ""), help="Path to private key (e.g., C:\\path\\to\\daehan_id)")

    args = parser.parse_args()

    # Build remote command; include workdir if provided
    remote_cmd = args.command
    if args.workdir:
        remote_cmd = f"cd {shlex.quote(args.workdir)} && {remote_cmd}"

    identity = args.identity if args.identity else None
    ssh_cmd = build_ssh_cmd(
        target=args.target,
        jump=(args.jump or None),
        agent_forward=(not args.no_agent_forward),
        force_tty=(not args.no_tty),
        remote_cmd=remote_cmd,
        identity=identity,
    )

    print("Connecting:", " ".join(shlex.quote(p) for p in ssh_cmd), file=sys.stderr)

    try:
        proc = subprocess.Popen(
            ssh_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        print("ssh not found in PATH.", file=sys.stderr)
        return 127

    assert proc.stdin is not None and proc.stdout is not None

    # Send the request line with newline
    try:
        proc.stdin.write(args.request + "\n")
        proc.stdin.flush()
        # keep stdin open; some clients may accept more input or need it open
    except Exception as exc:
        print(f"failed to write to remote stdin: {exc}", file=sys.stderr)

    # Stream stdout lines up to timeout
    start = time.time()
    try:
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            print(line, end="")
            if (time.time() - start) > args.timeout:
                print("\n[info] timeout reached; closing session", file=sys.stderr)
                break
    finally:
        try:
            # Close stdin so remote can exit cleanly
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
        except Exception:
            pass
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # Print any remaining stderr
    try:
        err = proc.stderr.read() if proc.stderr else ""
        if err:
            print(err, file=sys.stderr, end="")
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
