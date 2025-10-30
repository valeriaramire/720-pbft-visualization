import argparse
import os
import subprocess
import sys


def build_ssh_command(target: str, jump: str | None, agent_forward: bool, identity: str | None) -> list[str]:
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
    if jump:
        # If identity provided, also apply to jump host by including -i here too.
        # OpenSSH applies -i to all hops, so the same -i above suffices.
        cmd += ["-J", jump]
    cmd += [target, "cat"]  # remote will echo stdin back
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(description="Send 'Hello World' to a remote over SSH and echo it back.")
    parser.add_argument("--target", default=os.getenv("SSH_TARGET", "daehan@client-1"), help="SSH target, e.g. user@host")
    parser.add_argument("--jump", default=os.getenv("SSH_JUMP", "daehan@206.12.94.249"), help="Optional jump host, e.g. user@jumphost")
    parser.add_argument("--no-agent-forward", action="store_true", help="Disable SSH agent forwarding (-A)")
    parser.add_argument("--message", default=os.getenv("SSH_MESSAGE", "Hello World"), help="Message to send")
    parser.add_argument("--identity", default=os.getenv("SSH_IDENTITY", ""), help="Path to private key (e.g., C:\\path\\to\\daehan_id)")
    parser.add_argument("--ssh-bin", default=os.getenv("SSH_BIN", "ssh"), help="Path to ssh binary")
    parser.add_argument("--timeout", type=int, default=int(os.getenv("SSH_TIMEOUT", "15")), help="Timeout seconds")
    args = parser.parse_args()

    # Allow overriding ssh binary
    if args.ssh_bin != "ssh":
        os.environ["PATH"] = os.pathsep.join([os.path.dirname(args.ssh_bin), os.environ.get("PATH", "")])

    identity = args.identity if args.identity else None
    cmd = build_ssh_command(args.target, args.jump or None, agent_forward=not args.no_agent_forward, identity=identity)

    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        print("ssh not found. Ensure OpenSSH client is installed and in PATH.", file=sys.stderr)
        return 127

    assert proc.stdin is not None and proc.stdout is not None
    try:
        proc.stdin.write(args.message + "\n")
        proc.stdin.flush()
        proc.stdin.close()
        stdout_data, stderr_data = proc.communicate(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        print("SSH command timed out", file=sys.stderr)
        return 124

    rc = proc.returncode
    if rc != 0:
        sys.stderr.write(stderr_data)
        print(f"SSH failed with code {rc}", file=sys.stderr)
        return rc

    # Print what the remote echoed back
    print(stdout_data, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
