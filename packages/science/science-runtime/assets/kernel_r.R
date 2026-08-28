# Persistent Science kernel driver for run_r. Executes source in the global
# environment of one long-lived process, so variables persist across runs
# within a session. Base R only — no jsonlite, no third-party packages.
#
# Invocation: Rscript --vanilla --encoding=UTF-8 kernel_r.R <fifoPath>
#
# Frame grammar (single line, tab-separated, newline-terminated):
#   host -> kernel:  RUN\t<runId>\t<sourcePath>\t<cwd>\t<stdoutPath>\t<stderrPath>\t<artifactDir>\t<inputDir>
#   host -> kernel:  CHART_EXTRACT\t<runId>\t<requestPath>\t<resultPath>
#   host -> kernel:  EXIT
#   kernel -> host:  READY\t<protocolVersion=2>\t<pid>
#   kernel -> host:  DONE\t<runId>\t<status:ok|error|interrupted>\t<detail>\t<flags>
#   kernel -> host:  CHART\t<runId>\t<status:ok|error>\t<detail>
#
# CHART_APPLY is reserved for a later protocol revision and is not implemented.
#
# flags is a possibly-empty comma-separated token list. This driver emits the
# token capture-degraded when a run's output-capture unwind could not be
# fully restored (see execute_run); flags is empty otherwise.

PROTOCOL_VERSION <- 2L

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1) {
  stop("usage: kernel_r.R <fifoPath>")
}
fifo_path <- args[1]

.dsh_chart_env <- new.env(parent = baseenv())
.dsh_script_arg <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1])
sys.source(file.path(dirname(normalizePath(.dsh_script_arg)), "chart_ggplot2.R"), envir = .dsh_chart_env)

# Response FIFO. Opening for write blocks (on POSIX) until a reader opens
# the other end.
resp_con <- fifo(fifo_path, open = "w", blocking = TRUE)

send <- function(frame) {
  writeLines(frame, con = resp_con)
  flush(resp_con)
}

.dsh_charts <- new.env(parent = emptyenv())
.dsh_run_order <- character()
.dsh_active_run_id <- NULL

.dsh_resolve_dpi <- function(value) {
  if (is.character(value)) {
    aliases <- c(screen = 72, print = 300, retina = 320)
    value <- unname(aliases[[value]])
  }
  value <- as.numeric(value)[1]
  if (!is.finite(value) || value <= 0) stop("invalid ggsave dpi")
  value
}

.dsh_register_ggsave <- function(frame) {
  if (is.null(.dsh_active_run_id)) return(invisible(NULL))
  filename <- get0("filename", envir = frame, inherits = TRUE)
  plot <- get0("plot", envir = frame, inherits = TRUE)
  dpi <- get0("dpi", envir = frame, inherits = TRUE)
  artifact_dir <- Sys.getenv("SCIENCE_ARTIFACT_DIR", unset = "")
  if (!is.character(filename) || length(filename) != 1L || artifact_dir == "" || is.null(plot)) return(invisible(NULL))
  target <- normalizePath(filename, mustWork = FALSE)
  root <- normalizePath(artifact_dir, mustWork = FALSE)
  if (tolower(tools::file_ext(target)) != "png" || !.dsh_chart_env$.dsh_inside(target, root)) return(invisible(NULL))
  relative <- substring(target, nchar(root) + 2L)
  charts <- if (exists(.dsh_active_run_id, envir = .dsh_charts, inherits = FALSE)) {
    get(.dsh_active_run_id, envir = .dsh_charts, inherits = FALSE)
  } else list()
  charts[[relative]] <- list(plot = plot, dpi = .dsh_resolve_dpi(dpi))
  assign(.dsh_active_run_id, charts, envir = .dsh_charts)
  invisible(NULL)
}

.dsh_chart_env$install_ggsave_hook(.dsh_register_ggsave)

.dsh_json_string <- function(value) encodeString(enc2utf8(value), quote = '"', na.encode = FALSE)

.dsh_to_json <- function(value) {
  if (is.null(value)) return("null")
  if (is.list(value)) {
    names_value <- names(value)
    if (!is.null(names_value) && all(nzchar(names_value))) {
      fields <- vapply(seq_along(value), function(index) {
        paste0(.dsh_json_string(names_value[index]), ":", .dsh_to_json(value[[index]]))
      }, character(1))
      return(paste0("{", paste(fields, collapse = ","), "}"))
    }
    return(paste0("[", paste(vapply(value, .dsh_to_json, character(1)), collapse = ","), "]"))
  }
  if (length(value) != 1L) return(paste0("[", paste(vapply(as.list(value), .dsh_to_json, character(1)), collapse = ","), "]"))
  if (is.na(value)) return("null")
  if (is.character(value)) return(.dsh_json_string(value))
  if (is.logical(value)) return(if (value) "true" else "false")
  if (is.numeric(value)) return(if (is.finite(value)) format(value, scientific = FALSE, trim = TRUE, digits = 15) else "null")
  stop("unsupported chart JSON value")
}

.dsh_json_unescape <- function(value) {
  value <- gsub('\\\\"', '"', value, fixed = TRUE)
  value <- gsub("\\\\\\\\", "\\\\", value, fixed = TRUE)
  value
}

.dsh_parse_request <- function(path) {
  text <- paste(readLines(path, warn = FALSE, encoding = "UTF-8"), collapse = "")
  capture <- function(pattern) {
    match <- regexec(pattern, text, perl = TRUE)
    values <- regmatches(text, match)[[1]]
    if (length(values) < 2L) stop("invalid chart request JSON")
    values[2]
  }
  artifact_dir <- .dsh_json_unescape(capture('"artifactDir"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"'))
  retain_runs <- as.integer(capture('"retainRuns"\\s*:\\s*([0-9]+)'))
  allow_raw <- capture('"allow"\\s*:\\s*(null|\\[(?:[^]"\\\\]|"(?:\\\\.|[^"\\\\])*")*\\])')
  allow <- NULL
  if (allow_raw != "null") {
    strings <- gregexpr('"((?:\\\\.|[^"\\\\])*)"', allow_raw, perl = TRUE)
    tokens <- regmatches(allow_raw, strings)[[1]]
    allow <- vapply(tokens, function(token) .dsh_json_unescape(substring(token, 2L, nchar(token) - 1L)), character(1))
  }
  list(artifactDir = artifact_dir, allow = allow, retainRuns = retain_runs)
}

.dsh_extract_charts <- function(run_id, request_path, result_path) {
  request <- .dsh_parse_request(request_path)
  if (!is.finite(request$retainRuns) || request$retainRuns < 1L) stop("retainRuns must be positive")
  root <- normalizePath(request$artifactDir, mustWork = FALSE)
  registered <- if (exists(run_id, envir = .dsh_charts, inherits = FALSE)) get(run_id, envir = .dsh_charts) else list()
  charts <- list()
  errors <- list()
  for (relative in names(registered)) {
    if (!is.null(request$allow) && !(relative %in% request$allow)) next
    target <- normalizePath(file.path(root, relative), mustWork = FALSE)
    if (!.dsh_chart_env$.dsh_inside(target, root)) next
    outcome <- tryCatch(list(ok = TRUE, value = .dsh_chart_env$extract_chart(registered[[relative]], target)),
                        error = function(e) list(ok = FALSE, value = class(e)[1]))
    if (outcome$ok) charts[[relative]] <- outcome$value else errors[[relative]] <- outcome$value
  }
  while (length(.dsh_run_order) > request$retainRuns) {
    old <- .dsh_run_order[1]
    .dsh_run_order <<- .dsh_run_order[-1]
    if (exists(old, envir = .dsh_charts, inherits = FALSE)) rm(list = old, envir = .dsh_charts)
  }
  writeLines(.dsh_to_json(list(charts = charts, errors = errors)), con = result_path, useBytes = TRUE)
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

execute_run <- function(run_id, source_path, cwd, stdout_path, stderr_path, artifact_dir, input_dir) {
  .dsh_active_run_id <<- run_id
  if (!exists(run_id, envir = .dsh_charts, inherits = FALSE)) {
    assign(run_id, list(), envir = .dsh_charts)
    .dsh_run_order <<- c(.dsh_run_order, run_id)
  }
  orig_cwd <- getwd()
  orig_tmpdir <- Sys.getenv("TMPDIR", unset = NA)
  orig_artifact <- Sys.getenv("SCIENCE_ARTIFACT_DIR", unset = NA)
  orig_input <- Sys.getenv("SCIENCE_INPUT_DIR", unset = NA)

  setwd(cwd)
  Sys.setenv(TMPDIR = cwd, SCIENCE_ARTIFACT_DIR = artifact_dir, SCIENCE_INPUT_DIR = input_dir)
  # Safety net for an interrupt that unwinds through this function before
  # reaching the explicit restore near the end: on.exit
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
    if (is.na(orig_input)) {
      Sys.unsetenv("SCIENCE_INPUT_DIR")
    } else {
      Sys.setenv(SCIENCE_INPUT_DIR = orig_input)
    }
    .dsh_active_run_id <<- NULL
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
  # Safety net for an interrupt landing between here and the tryCatch below:
  # best-effort depth-only unwind so the sink stack and
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
  if (is.na(orig_input)) {
    Sys.unsetenv("SCIENCE_INPUT_DIR")
  } else {
    Sys.setenv(SCIENCE_INPUT_DIR = orig_input)
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
    input_dir <- parts[8]
    result <- execute_run(run_id, source_path, cwd, stdout_path, stderr_path, artifact_dir, input_dir)
    send(sprintf("DONE\t%s\t%s\t%s\t%s", run_id, result$status, result$detail, result$flags))
  }
  if (cmd == "CHART_EXTRACT") {
    run_id <- parts[2]
    request_path <- parts[3]
    result_path <- parts[4]
    outcome <- tryCatch({ .dsh_extract_charts(run_id, request_path, result_path); list(status = "ok", detail = "") },
                        error = function(e) list(status = "error", detail = class(e)[1]))
    send(sprintf("CHART\t%s\t%s\t%s", run_id, outcome$status, outcome$detail))
  }
  # Unknown commands are ignored, keeping the driver forward-tolerant of
  # later protocol additions the host may send.
}

close(resp_con)
quit(save = "no", status = 0L)
