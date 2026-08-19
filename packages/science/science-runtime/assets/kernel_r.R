# Persistent Science kernel driver for run_r. Executes source in the global
# environment of one long-lived process, so variables persist across runs
# within a session. Base R only — no jsonlite, no third-party packages.
#
# Invocation: Rscript --vanilla --encoding=UTF-8 kernel_r.R <fifoPath>
#
# Frame grammar (single line, tab-separated, newline-terminated):
#   host -> kernel:  RUN\t<runId>\t<sourcePath>\t<cwd>\t<stdoutPath>\t<stderrPath>\t<artifactDir>
#   host -> kernel:  EXIT
#   kernel -> host:  READY\t<protocolVersion=1>\t<pid>
#   kernel -> host:  DONE\t<runId>\t<status:ok|error|interrupted>\t<detail>\t<flags>
#
# flags is a possibly-empty comma-separated token list. This driver emits the
# token capture-degraded when a run's output-capture unwind could not be
# fully restored (see execute_run); flags is empty otherwise.

PROTOCOL_VERSION <- 1L

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1) {
  stop("usage: kernel_r.R <fifoPath>")
}
fifo_path <- args[1]

# Response FIFO. Opening for write blocks (on POSIX) until a reader opens
# the other end.
resp_con <- fifo(fifo_path, open = "w", blocking = TRUE)

send <- function(frame) {
  writeLines(frame, con = resp_con)
  flush(resp_con)
}

send(sprintf("READY\t%d\t%d", PROTOCOL_VERSION, Sys.getpid()))

stdin_con <- file("stdin", open = "r")

# Idle-time interrupt handling: readLines() while blocked between requests
# can be hit by SIGINT. tryCatch(interrupt=) intercepts what it can and
# retries the read, but base R does not guarantee an idle-time interrupt is
# safely absorbed here: depending on this process's history, an idle signal
# can slip past this handler into R's own default handling (terminating the
# process) or surface later as a spurious interrupted status on an
# unrelated, subsequent run. Reliably absorbing that race is the caller's
# responsibility, not this driver's — it only ever sends SIGINT while a run
# is in flight, never while idle.
read_request_line <- function() {
  repeat {
    outcome <- tryCatch(
      list(kind = "line", value = readLines(con = stdin_con, n = 1)),
      interrupt = function(c) list(kind = "interrupt")
    )
    if (identical(outcome$kind, "interrupt")) {
      next
    }
    return(outcome$value) # character(0) on true EOF, else the request line
  }
}

execute_run <- function(source_path, cwd, stdout_path, stderr_path, artifact_dir) {
  orig_cwd <- getwd()
  orig_tmpdir <- Sys.getenv("TMPDIR", unset = NA)
  orig_artifact <- Sys.getenv("SCIENCE_ARTIFACT_DIR", unset = NA)

  setwd(cwd)
  Sys.setenv(TMPDIR = cwd, SCIENCE_ARTIFACT_DIR = artifact_dir)
  # Safety net for an interrupt that unwinds through this function before
  # reaching the explicit restore near the end (A1 finding 12): on.exit
  # runs on every exit path, including one no tryCatch below protects
  # because the interrupt landed before that tryCatch was entered.
  on.exit({
    setwd(orig_cwd)
    if (is.na(orig_tmpdir)) Sys.unsetenv("TMPDIR") else Sys.setenv(TMPDIR = orig_tmpdir)
    if (is.na(orig_artifact)) {
      Sys.unsetenv("SCIENCE_ARTIFACT_DIR")
    } else {
      Sys.setenv(SCIENCE_ARTIFACT_DIR = orig_artifact)
    }
  }, add = TRUE)

  # Record sink depth before pushing our own diversion so a run whose user
  # code calls sink() itself (push or pop, matched or not) can be unwound
  # deterministically afterwards.
  out_sink_before <- sink.number(type = "output")
  msg_sink_before <- sink.number(type = "message")

  out_con <- file(stdout_path, open = "wt")
  err_con <- file(stderr_path, open = "wt")
  sink(out_con, type = "output")
  sink(err_con, type = "message")
  # Safety net for an interrupt landing between here and the tryCatch below
  # (A1 finding 12): best-effort depth-only unwind so the sink stack and
  # these file connections never leak past this run. The explicit unwind
  # after the tryCatch is what a normally-returning run relies on for its
  # capture_degraded accounting; this duplicates it harmlessly there.
  on.exit({
    while (sink.number(type = "message") > msg_sink_before) {
      popped <- tryCatch({ sink(type = "message"); TRUE }, error = function(e) FALSE)
      if (!popped) break
    }
    while (sink.number(type = "output") > out_sink_before) {
      popped <- tryCatch({ sink(); TRUE }, error = function(e) FALSE)
      if (!popped) break
    }
    tryCatch(close(out_con), error = function(e) NULL)
    tryCatch(close(err_con), error = function(e) NULL)
  }, add = TRUE)

  result <- tryCatch(
    {
      source(source_path, local = .GlobalEnv, echo = FALSE, print.eval = TRUE)
      list(status = "ok", detail = "")
    },
    interrupt = function(c) {
      list(status = "interrupted", detail = "")
    },
    error = function(e) {
      cat(conditionMessage(e), "\n", file = stderr(), sep = "")
      list(status = "error", detail = class(e)[1])
    }
  )

  # Deterministic unwind: pop back down to the recorded depth regardless of
  # what the user code left on the sink stack (matched sink()/sink(x) pairs,
  # an extra unmatched push, or an unmatched pop that already restored us).
  # User code that closes R's special stdout()/stderr() connections corrupts
  # R's connection table in a way that makes a plain sink() pop throw
  # "invalid connection" once the stack unwinds back past our own diversion;
  # the loop breaks rather than looping forever or letting that propagate
  # and kill the kernel. capture_degraded records that this run's output
  # capture could not be fully restored, so the DONE frame can say so.
  capture_degraded <- FALSE
  while (sink.number(type = "message") > msg_sink_before) {
    popped <- tryCatch(
      {
        sink(type = "message")
        TRUE
      },
      error = function(e) FALSE
    )
    if (!popped) {
      capture_degraded <- TRUE
      break
    }
  }
  while (sink.number(type = "output") > out_sink_before) {
    popped <- tryCatch(
      {
        sink()
        TRUE
      },
      error = function(e) FALSE
    )
    if (!popped) {
      capture_degraded <- TRUE
      break
    }
  }

  tryCatch(close(out_con), error = function(e) NULL)
  tryCatch(close(err_con), error = function(e) NULL)

  setwd(orig_cwd)
  if (is.na(orig_tmpdir)) Sys.unsetenv("TMPDIR") else Sys.setenv(TMPDIR = orig_tmpdir)
  if (is.na(orig_artifact)) {
    Sys.unsetenv("SCIENCE_ARTIFACT_DIR")
  } else {
    Sys.setenv(SCIENCE_ARTIFACT_DIR = orig_artifact)
  }

  result$flags <- if (capture_degraded) "capture-degraded" else ""
  result
}

repeat {
  line <- read_request_line()
  if (length(line) == 0) break # true EOF on stdin without EXIT
  if (nchar(line) == 0) next
  parts <- strsplit(line, "\t", fixed = TRUE)[[1]]
  cmd <- parts[1]
  if (cmd == "EXIT") break
  if (cmd == "RUN") {
    run_id <- parts[2]
    source_path <- parts[3]
    cwd <- parts[4]
    stdout_path <- parts[5]
    stderr_path <- parts[6]
    artifact_dir <- parts[7]
    result <- execute_run(source_path, cwd, stdout_path, stderr_path, artifact_dir)
    send(sprintf("DONE\t%s\t%s\t%s\t%s", run_id, result$status, result$detail, result$flags))
  }
  # Unknown commands are ignored, keeping the driver forward-tolerant of
  # later protocol additions the host may send.
}

close(resp_con)
quit(save = "no", status = 0L)
