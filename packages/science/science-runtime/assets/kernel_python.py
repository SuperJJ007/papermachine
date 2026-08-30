#!/usr/bin/env python3
"""Persistent Science kernel driver for run_python. Executes source in one
long-lived process's module-level globals dict, so variables persist across
runs within a session. Python stdlib only — no third-party imports.

Invocation: python3 -B -u -X utf8 kernel_python.py <fifoPath>

Frame grammar (single line, tab-separated, newline-terminated):
  host -> kernel:  RUN\t<runId>\t<sourcePath>\t<cwd>\t<stdoutPath>\t<stderrPath>\t<artifactDir>\t<inputDir>
  host -> kernel:  CHART_EXTRACT\t<runId>\t<requestPath>\t<resultPath>
  host -> kernel:  CHART_APPLY\t<runId>\t<requestPath>\t<resultPath>
    The result path is caller-owned run scratch and may hold an ephemeral preview.
  host -> kernel:  EXIT
  kernel -> host:  READY\t<protocolVersion=2>\t<pid>
  kernel -> host:  DONE\t<runId>\t<status:ok|error|interrupted>\t<detail>\t<flags>
  kernel -> host:  CHART\t<runId>\t<status:ok|error>\t<detail>

flags is a possibly-empty comma-separated token list. This driver always
emits an empty flags field: its fd-level output redirection has no degraded-
capture case to report. The field is still present on every DONE frame for
arity parity with the R driver, which uses it to report degraded capture.
"""
import os
import importlib.util
import json
import signal
import site
import sys
import traceback

PROTOCOL_VERSION = 2

_chart_module = None
_dsh_charts = {}
_active_run_id = None


def _load_chart_module():
    global _chart_module
    if _chart_module is None:
        path = os.path.join(os.path.dirname(os.path.realpath(__file__)), "chart_matplotlib.py")
        spec = importlib.util.spec_from_file_location("_dsh_chart_matplotlib", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("chart adapter spec unavailable")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _chart_module = module
    return _chart_module


def _register_chart(relative_path, entry):
    if _active_run_id is None:
        return
    run_charts = _dsh_charts.setdefault(_active_run_id, {})
    try:
        run_charts[relative_path] = _load_chart_module().copy_chart(entry)
    except Exception as error:
        # A valid PNG remains capturable when a custom artist cannot be copied for editing.
        run_charts[relative_path] = {"error": str(error)}


def send(resp, frame):
    resp.write(frame + "\n")
    resp.flush()


def safe_flush(stream):
    # User code can close(), detach(), or otherwise break sys.stdout/stderr.
    # Flushing here is the driver's own bookkeeping and must never be allowed
    # to raise out of it and kill the kernel.
    try:
        stream.flush()
    except (ValueError, OSError, AttributeError):
        pass


def rebind_std_streams():
    # Re-create sys.stdout/sys.stderr as fresh, non-owning wrappers around
    # whatever fd 1/2 currently mean. closefd=False is load-bearing: it is
    # what keeps a later sys.stdout.close() by user code from taking fd 1
    # down with it.
    sys.stdout = os.fdopen(1, "w", encoding="utf-8", closefd=False)
    sys.stderr = os.fdopen(2, "w", encoding="utf-8", closefd=False)


def execute_run(global_ns, run_id, source_path, cwd, stdout_path, stderr_path, artifact_dir, input_dir):
    global _active_run_id
    orig_cwd = os.getcwd()
    orig_tmpdir = os.environ.get("TMPDIR")
    orig_artifact = os.environ.get("SCIENCE_ARTIFACT_DIR")
    orig_input = os.environ.get("SCIENCE_INPUT_DIR")

    os.chdir(cwd)
    os.environ["TMPDIR"] = cwd
    os.environ["SCIENCE_ARTIFACT_DIR"] = artifact_dir
    os.environ["SCIENCE_INPUT_DIR"] = input_dir
    _active_run_id = run_id
    _dsh_charts.setdefault(run_id, {})
    _load_chart_module().install_savefig_hook(_register_chart)

    stdout_fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    stderr_fd = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    saved_stdout_fd = os.dup(1)
    saved_stderr_fd = os.dup(2)

    safe_flush(sys.stdout)
    safe_flush(sys.stderr)
    os.dup2(stdout_fd, 1)
    os.dup2(stderr_fd, 2)
    os.close(stdout_fd)
    os.close(stderr_fd)
    rebind_std_streams()

    status = "ok"
    detail = ""

    # Idle SIGINT is ignored (installed by the caller before/after this call);
    # during exec, restore the default handler so KeyboardInterrupt is raised
    # into the running user code. The install is the try's first statement so
    # every path out of the interruptible window, including a failure inside
    # this line itself, unwinds through the matching finally below and
    # restores SIG_IGN.
    try:
        signal.signal(signal.SIGINT, signal.default_int_handler)
        with open(source_path, "r", encoding="utf-8") as f:
            source = f.read()
        code = compile(source, source_path, "exec")
        exec(code, global_ns)
    except KeyboardInterrupt:
        status = "interrupted"
        detail = ""
    except SystemExit as e:
        code_val = e.code
        if code_val is None or code_val == 0:
            status = "ok"
        else:
            status = "error"
            detail = "SystemExit:%s" % (code_val,)
    except BaseException as e:  # noqa: BLE001 - kernel must survive any user-code failure
        status = "error"
        detail = type(e).__name__
        traceback.print_exc()
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)

        safe_flush(sys.stdout)
        safe_flush(sys.stderr)
        os.dup2(saved_stdout_fd, 1)
        os.dup2(saved_stderr_fd, 2)
        os.close(saved_stdout_fd)
        os.close(saved_stderr_fd)
        rebind_std_streams()

        os.chdir(orig_cwd)
        if orig_tmpdir is None:
            os.environ.pop("TMPDIR", None)
        else:
            os.environ["TMPDIR"] = orig_tmpdir
        if orig_artifact is None:
            os.environ.pop("SCIENCE_ARTIFACT_DIR", None)
        else:
            os.environ["SCIENCE_ARTIFACT_DIR"] = orig_artifact
        if orig_input is None:
            os.environ.pop("SCIENCE_INPUT_DIR", None)
        else:
            os.environ["SCIENCE_INPUT_DIR"] = orig_input
        _active_run_id = None

    return status, detail


def extract_charts(run_id, request_path, result_path):
    """Extract registered charts for one run and prune strong references by run age."""
    with open(request_path, "r", encoding="utf-8") as stream:
        request = json.load(stream)
    artifact_dir = os.path.realpath(request["artifactDir"])
    allow = request["allow"]
    if allow is not None:
        allow = set(allow)
    retain_runs = int(request["retainRuns"])
    if retain_runs < 1:
        raise ValueError("retainRuns must be positive")
    charts = {}
    errors = {}
    adapter = _load_chart_module()
    for relative_path, entry in _dsh_charts.get(run_id, {}).items():
        if allow is not None and relative_path not in allow:
            continue
        target = os.path.realpath(os.path.join(artifact_dir, relative_path))
        try:
            if os.path.commonpath([target, artifact_dir]) != artifact_dir:
                continue
            if "error" in entry:
                raise ValueError(entry["error"])
            import matplotlib
            with matplotlib.rc_context(entry["rc"]):
                charts[relative_path] = adapter.extract_chart(adapter.copy_chart(entry), target)
        except Exception as error:
            errors[relative_path] = type(error).__name__
    while len(_dsh_charts) > retain_runs:
        del _dsh_charts[next(iter(_dsh_charts))]
    with open(result_path, "w", encoding="utf-8") as stream:
        json.dump({"charts": charts, "errors": errors}, stream, ensure_ascii=False, separators=(",", ":"))


def apply_chart(run_id, request_path, result_path):
    """Apply operations to one registered figure, export it, and re-extract its chart state."""
    with open(request_path, "r", encoding="utf-8") as stream:
        request = json.load(stream)
    entry = _dsh_charts.get(run_id, {}).get(request["figureKey"])
    if entry is None:
        return "not_registered"
    if "error" in entry:
        raise ValueError(entry["error"])
    adapter = _load_chart_module()
    entry = adapter.copy_chart(entry)
    output_path = request["outputPath"]
    import matplotlib
    with matplotlib.rc_context(entry["rc"]):
        failed = adapter.apply_ops(entry["fig"], request["ops"])
        exported = adapter.save_chart(entry["fig"], output_path, (), entry["save_options"])
        chart = adapter.extract_chart(exported, output_path)
    with open(result_path, "w", encoding="utf-8") as stream:
        json.dump({"chart": chart, "failedOps": failed}, stream, ensure_ascii=False, separators=(",", ":"))
    return None


def ensure_user_site_importable():
    # PYTHONUSERBASE is set only for this persistent kernel (never for an
    # interpreter probe): under sandbox confinement the Conda prefix's own
    # site-packages is read-only, so an inline `pip install` falls back to a
    # user-site install here. Python only adds the user site-packages
    # directory to sys.path once, during interpreter startup (site.py, before
    # this driver's own code ever runs), and only if the directory already
    # exists at that instant. Kernel spawn only creates PYTHONUSERBASE itself
    # (a Host scratch directory) -- the nested "lib/pythonX.Y/site-packages"
    # leaf pip actually installs into is created lazily by pip's own first
    # install, too late for that one-time startup scan. Create the leaf now
    # and add it explicitly so an install from any later RUN on this kernel
    # is importable without a kernel restart.
    if os.environ.get("PYTHONUSERBASE") and site.ENABLE_USER_SITE:
        user_site = site.getusersitepackages()
        os.makedirs(user_site, exist_ok=True)
        site.addsitedir(user_site)


def main():
    if len(sys.argv) != 2:
        print("usage: kernel_python.py <fifoPath>", file=sys.stderr)
        sys.exit(2)
    fifo_path = sys.argv[1]

    ensure_user_site_importable()

    # Idle SIGINT hardening: ignored except during exec (see execute_run).
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    # Open the response FIFO for writing. On POSIX this blocks until a
    # reader opens the other end.
    resp = open(fifo_path, "w", encoding="utf-8")

    send(resp, "READY\t%d\t%d" % (PROTOCOL_VERSION, os.getpid()))

    global_ns = {"__name__": "__main__"}
    stdin = sys.stdin

    while True:
        line = stdin.readline()
        if line == "":
            # EOF on stdin without EXIT: unexpected, but exit quietly rather
            # than hang forever.
            break
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        cmd = parts[0]
        if cmd == "EXIT":
            break
        if cmd == "RUN":
            run_id, source_path, cwd, stdout_path, stderr_path, artifact_dir, input_dir = parts[1:8]
            status, detail = execute_run(
                global_ns, run_id, source_path, cwd, stdout_path, stderr_path, artifact_dir, input_dir
            )
            send(resp, "DONE\t%s\t%s\t%s\t%s" % (run_id, status, detail, ""))
        if cmd == "CHART_EXTRACT":
            run_id, request_path, result_path = parts[1:4]
            try:
                extract_charts(run_id, request_path, result_path)
                send(resp, "CHART\t%s\tok\t" % run_id)
            except BaseException as error:  # noqa: BLE001 - extraction never kills the kernel
                send(resp, "CHART\t%s\terror\t%s" % (run_id, type(error).__name__))
        if cmd == "CHART_APPLY":
            run_id, request_path, result_path = parts[1:4]
            try:
                detail = apply_chart(run_id, request_path, result_path)
                send(resp, "CHART\t%s\t%s\t%s" % (run_id, "error" if detail else "ok", detail or ""))
            except Exception as error:
                send(resp, "CHART\t%s\terror\t%s" % (run_id, type(error).__name__))
        # Unknown commands are ignored, keeping the driver forward-tolerant
        # of later protocol additions the host may send.

    resp.close()
    sys.exit(0)


if __name__ == "__main__":
    main()
