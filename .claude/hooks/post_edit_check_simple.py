#!/usr/bin/env python3
"""Simple mode post-edit hook: syntax check + type check, report to primary agent.

No subagent spawning. Errors print to stdout so Claude sees them as hook output.
Resolves beagle tools via $PATH (after raco pkg install) or $BEAGLE_PATH.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time

BEAGLE_EXTENSIONS = frozenset({
    ".bgl", ".bclj", ".bcljs", ".bjs", ".bnix", ".bsql", ".bpy", ".rkt",
})

PORT_FILE = os.environ.get("BEAGLE_DAEMON_PORTFILE", "/var/tmp/beagle-daemon.port")


def find_tool(name):
    """Find a beagle tool binary. Checks sibling bin/, $BEAGLE_PATH/bin, then $PATH."""
    hook_dir = os.path.dirname(os.path.abspath(__file__))
    project_bin = os.path.join(hook_dir, "..", "..", "bin", name)
    if os.path.isfile(project_bin):
        return os.path.abspath(project_bin)
    bp = os.environ.get("BEAGLE_PATH")
    if bp:
        candidate = os.path.join(bp, "bin", name)
        if os.path.isfile(candidate):
            return candidate
    return shutil.which(name)


SYNTAX_BIN = find_tool("beagle-syntax")
DAEMON_BIN = find_tool("beagle-daemon")


def get_file_path(tool_input_json):
    try:
        d = json.loads(tool_input_json)
        return d.get("tool_input", {}).get("file_path", "")
    except Exception:
        return ""


def is_beagle_file(path):
    return any(path.endswith(ext) for ext in BEAGLE_EXTENSIONS)


def daemon_running():
    try:
        if not os.path.exists(PORT_FILE):
            return False
        port = int(open(PORT_FILE).read().strip())
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        sock.connect(("127.0.0.1", port))
        sock.send(b"ping\n")
        sock.recv(64)
        sock.close()
        return True
    except Exception:
        return False


def ensure_daemon():
    if daemon_running():
        return True
    if not DAEMON_BIN:
        return False
    try:
        subprocess.Popen(
            [DAEMON_BIN, "start"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1.0)
        return True
    except Exception:
        return False


def _syntax_json(file_path):
    """Run the structural check; return the error dict, or None if clean."""
    r = subprocess.run(
        [SYNTAX_BIN, "--json", file_path],
        capture_output=True, text=True, timeout=5,
    )
    if r.returncode == 0:
        return None
    try:
        data = json.loads(r.stdout or r.stderr)
    except Exception:
        return None
    return None if data.get("status") == "ok" else data


def syntax_check(file_path):
    if not SYNTAX_BIN:
        return None
    try:
        data = _syntax_json(file_path)
        if data is None:
            return None
        filename = os.path.basename(file_path)

        # Capture what the repair WOULD do (the indentation-reading) BEFORE any
        # write, so the change is never invisible.
        diff = subprocess.run(
            [SYNTAX_BIN, "--repair", "--diff", file_path],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()

        # Auto-apply ONLY a high-confidence APPEND (forgot trailing closers).
        # A RELOCATION — closers moved to match indentation, which may produce a
        # balanced-but-WRONG tree — is now 'medium and REFUSES, leaving the file
        # unchanged so the disagreement is surfaced, not silently committed.
        subprocess.run(
            [SYNTAX_BIN, "--repair", "--write", file_path],
            capture_output=True, text=True, timeout=5,
        )
        after = _syntax_json(file_path)

        # diff line 0 is "FILE: N edit(s), confidence: X"; the rest are edits.
        diff_edits = [ln.strip() for ln in diff.splitlines()[1:]] if diff else []

        if after is None:
            # A safe append was applied — SHOW it (never silent). Re-read to be sure.
            lines = [f"beagle-syntax: {filename} — auto-closed missing trailing "
                     f"delimiter(s) (high-confidence, re-verified). File updated — "
                     f"RE-READ before further edits. What was added:"]
            lines += ["    " + e for e in (diff_edits or ["(closers appended at end)"])]
            return "\n".join(lines)

        # Not auto-applied. Your explicit parens and your indentation imply
        # DIFFERENT trees (or there's an unclosed string). The file was NOT
        # changed. FAIL LOUD — do not trust either reading blindly.
        lines = [f"beagle-syntax: {filename} — AMBIGUOUS STRUCTURE — file NOT changed.",
                 "  Your explicit parens and your indentation disagree on the tree;",
                 "  the close-paren cannot be placed without guessing your intent."]
        if diff_edits:
            lines.append("  Indentation-reading would do (NOT necessarily what you meant):")
            lines += ["    " + e for e in diff_edits]
        for e in after.get("errors", []):
            lines.append(f"  error {e.get('line', 0)}:{e.get('col', 0)} {e.get('detail', '')}")
        counts = after.get("counts", {})
        for name, key in [("()", "parens"), ("[]", "brackets"), ("{}", "braces")]:
            c = counts.get(key, {})
            bal = c.get("balance", 0)
            if bal != 0:
                lines.append(f"  {name} open:{c.get('open',0)} close:{c.get('close',0)} balance:{bal:+d}")
        lines.append("  FIX: re-place the closer where your INTENT requires (extract a "
                     "named binding if the form is deep), then re-read. Do not hand-count.")
        return "\n".join(lines)
    except Exception:
        return None


def type_check(file_path):
    if not DAEMON_BIN:
        return None
    try:
        file_dir = os.path.dirname(file_path)
        subprocess.run(
            [DAEMON_BIN, "query", "watch", file_dir],
            capture_output=True, text=True, timeout=3,
        )
    except Exception:
        pass
    time.sleep(0.3)
    try:
        r = subprocess.run(
            [DAEMON_BIN, "query", "check-enriched", file_path],
            capture_output=True, text=True, timeout=8,
        )
        if r.returncode != 0:
            return None
        data = json.loads(r.stdout)
        result = data.get("result")
        if not result or result == "null":
            return None
        errors = result.get("error_count", 0)
        if errors == 0:
            return None

        auto = result.get("auto_fixable", 0)
        filename = os.path.basename(file_path)
        lines = [f"beagle-check: {filename} ({errors} error(s), {auto} auto-fixable)"]
        for e in result.get("errors", []):
            ln = e.get("line", 0)
            kind = e.get("kind", "?")
            msg = e.get("message", "")
            short = msg.split(": ")[-1] if ": " in msg else msg
            lines.append(f"  L{ln} [{kind}]: {short}")
            fp = e.get("fix_plan")
            if fp and isinstance(fp, dict):
                hint = fp.get("fix-hint", "")
                if hint:
                    lines.append(f"    -> {hint}")
        return "\n".join(lines)
    except Exception:
        return None


def log_event(project_dir, **kwargs):
    log_path = os.path.join(project_dir, ".beagle", "hook-log.jsonl")
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a") as f:
            f.write(json.dumps({"ts": time.time(), **kwargs}) + "\n")
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        sys.exit(0)

    file_path = get_file_path(sys.argv[1])
    if not file_path or not is_beagle_file(file_path):
        sys.exit(0)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    t0 = time.time()

    ensure_daemon()

    output = []
    syntax_errors = 0
    type_errors = 0

    syntax_msg = syntax_check(file_path)
    if syntax_msg:
        output.append(syntax_msg)
        syntax_errors = syntax_msg.count("\n")
    else:
        type_msg = type_check(file_path)
        if type_msg:
            output.append(type_msg)
            type_errors = type_msg.count("\n")

    wall_ms = int((time.time() - t0) * 1000)
    log_event(project_dir, event="check", file=os.path.basename(file_path),
              syntax_errors=syntax_errors, type_errors=type_errors, wall_ms=wall_ms)

    if output:
        print("\n".join(output))


if __name__ == "__main__":
    main()
