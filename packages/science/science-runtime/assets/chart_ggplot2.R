# Private ggplot2 save registration and chart extraction for the Science kernel.

.dsh_chart_state <- new.env(parent = emptyenv())
.dsh_chart_state$traced <- FALSE
.dsh_chart_state$png <- grDevices::png

.dsh_inside <- function(path, root) {
  target <- normalizePath(path, mustWork = FALSE)
  base <- normalizePath(root, mustWork = FALSE)
  identical(target, base) || startsWith(target, paste0(base, .Platform$file.sep))
}

install_ggsave_hook <- function(register, register_device) {
  install_now <- function(...) {
    if (.dsh_chart_state$traced || !("ggplot2" %in% loadedNamespaces())) return(invisible(NULL))
    target <- get("ggsave", envir = asNamespace("ggplot2"))
    expressions <- as.list(body(target))
    return_index <- which(vapply(expressions, function(value) {
      is.call(value) && identical(value[[1]], as.name("invisible")) && identical(value[[2]], as.name("filename"))
    }, logical(1)))
    if (length(return_index) != 1L) stop("ggsave return expression unavailable")
    register_exit <- substitute(callback(environment()), list(callback = register))
    # ggplot2 4 replaces the exit handler installed by trace(), so the final
    # expression tracer provides the same post-render registration there.
    # Repeated registration is harmless on releases whose exit tracer runs.
    trace("ggsave", tracer = register_exit, exit = register_exit, at = return_index,
          print = FALSE, where = asNamespace("ggplot2"))
    for (class_name in c("ggplot", "ggplot2::ggplot")) {
      original <- utils::getS3method("print", class_name, optional = TRUE)
      if (is.null(original)) next
      wrapped <- local({
        method <- original
        function(x, ...) {
          result <- withVisible(method(x, ...))
          .dsh_record_plot(x, list(...))
          if (result$visible) result$value else invisible(result$value)
        }
      })
      registerS3method("print", class_name, wrapped, envir = asNamespace("base"))
    }
    .dsh_chart_state$traced <- TRUE
    invisible(NULL)
  }
  setHook(packageEvent("ggplot2", "onLoad"), install_now, action = "append")
  install_now()
  .dsh_install_png_hook(register_device)
}

# Only one complete ggplot rendered on a tracked PNG device is addressable.
# Base graphics, viewport composition, and multi-page output retain raster editing.
.dsh_chart_state$devices <- new.env(parent = emptyenv())

.dsh_record_plot <- function(plot, args) {
  key <- as.character(grDevices::dev.cur())
  entry <- .dsh_chart_state$devices[[key]]
  if (is.null(entry)) return(invisible(NULL))
  entry$count <- entry$count + 1L
  if (entry$count == 1L && is.null(args$vp) && !identical(args$newpage, FALSE)) {
    entry$chart <- .dsh_chart_entry(plot, entry$dpi, entry$save_args)
  } else entry$chart <- NULL
  .dsh_chart_state$devices[[key]] <- entry
  invisible(NULL)
}

.dsh_install_png_hook <- function(register) {
  opened <- function(frame) {
    root <- Sys.getenv("SCIENCE_ARTIFACT_DIR", unset = "")
    filename <- get("filename", frame)
    if (root == "" || grepl("%", filename, fixed = TRUE) || !.dsh_inside(filename, root)) return(invisible(NULL))
    register(filename, NULL)
    resolution <- get("res", frame)
    dpi <- if (is.finite(resolution) && resolution > 0) resolution else 72
    geometry <- get("g", frame)
    size <- c(geometry$width, geometry$height) / dpi
    options <- get("d", frame)
    .dsh_chart_state$devices[[as.character(grDevices::dev.cur())]] <- list(
      filename = normalizePath(filename, mustWork = FALSE), root = root, count = 0L, dpi = dpi,
      save_args = list(device = eval(quote(function(filename, width, height, ...) {
        png_device(filename, round(width * resolution), round(height * resolution), units = "px", res = resolution, ...)
      }), list2env(list(resolution = dpi, png_device = .dsh_chart_state$png), parent = baseenv())), width = size[1], height = size[2], units = "in", dpi = dpi,
                       type = get("type", frame), family = options$family, antialias = options$antialias,
                       pointsize = get("pointsize", frame), bg = get("bg", frame)))
    invisible(NULL)
  }
  closed <- function(frame) {
    key <- as.character(get("which", frame))
    entry <- .dsh_chart_state$devices[[key]]
    if (is.null(entry)) return(invisible(NULL))
    rm(list = key, envir = .dsh_chart_state$devices)
    if (identical(entry$root, Sys.getenv("SCIENCE_ARTIFACT_DIR")) && !is.null(entry$chart)) {
      register(entry$filename, entry$chart)
    }
    invisible(NULL)
  }
  invalidate <- function() {
    key <- as.character(grDevices::dev.cur())
    entry <- .dsh_chart_state$devices[[key]]
    if (!is.null(entry)) {
      entry$count <- entry$count + 1L
      entry$chart <- NULL
      .dsh_chart_state$devices[[key]] <- entry
    }
    invisible(NULL)
  }
  for (where in list(asNamespace("grDevices"), as.environment("package:grDevices"))) {
    trace("png", exit = substitute(callback(environment()), list(callback = opened)), print = FALSE, where = where)
    trace("dev.off", exit = substitute(callback(environment()), list(callback = closed)), print = FALSE, where = where)
  }
  for (where in list(asNamespace("graphics"), as.environment("package:graphics"))) {
    trace("plot.new", tracer = substitute(callback(), list(callback = invalidate)), print = FALSE, where = where)
  }
  invisible(NULL)
}

.dsh_chart_entry <- function(plot, dpi, save_args) {
  tryCatch({
    plot <- plot + .dsh_theme_for(plot)
    list(snapshot = serialize(list(plot = plot, dpi = dpi, save_args = save_args), NULL))
  }, error = function(e) list(error = conditionMessage(e)))
}

.dsh_copy_chart <- function(entry) {
  if (!is.null(entry$error)) stop(entry$error)
  unserialize(entry$snapshot)
}

.dsh_theme_for <- function(plot) {
  theme <- ggplot2::theme_get()
  # `theme_get()` is the complete base theme; `plot$theme` is the plot's own
  # (incomplete) incremental `theme()` calls. `+.theme` resolves conflicting
  # elements from its right-hand operand, so the base must be the left
  # operand for plot-specific overrides (e.g. `set_legend_position`'s
  # `legend.position`) to actually take effect in the merged result.
  if (!is.null(plot$theme)) theme <- theme + plot$theme
  theme
}

.dsh_safe_add <- function(elements, value) {
  tryCatch({
    item <- force(value)
    elements[[length(elements) + 1L]] <- item
    elements
  }, error = function(e) elements)
}

.dsh_dedupe_element_ids <- function(elements) {
  # Append a stable `#N` suffix to id collisions, in first-occurrence order.
  # Distinct artists (for example, two annotation layers whose rendered value
  # matches) can generate the same catalog id; the host codec requires unique
  # element ids and rejects the entire chart otherwise.
  seen <- new.env(parent = emptyenv())
  for (index in seq_along(elements)) {
    base <- elements[[index]]$id
    count <- if (is.null(seen[[base]])) 1L else seen[[base]] + 1L
    seen[[base]] <- count
    if (count > 1L) elements[[index]]$id <- paste0(base, "#", count)
  }
  elements
}

extract_elements <- function(plot) {
  elements <- list()
  add <- function(id, kind, axes, label, current) {
    elements <<- .dsh_safe_add(elements, list(id = id, kind = kind, axes = axes, label = label, current = current))
  }
  built <- ggplot2::ggplot_build(plot)
  panel_params <- built$layout$panel_params
  panels <- length(panel_params)
  theme <- .dsh_theme_for(plot)
  if (!is.null(built$plot$labels$title)) add("title", "title", NULL, NULL, built$plot$labels$title)
  if (!is.null(built$plot$labels$subtitle)) add("subtitle", "subtitle", NULL, NULL, built$plot$labels$subtitle)
  if (!is.null(built$plot$labels$x)) add("x_label", "x_label", NULL, NULL, built$plot$labels$x)
  if (!is.null(built$plot$labels$y)) add("y_label", "y_label", NULL, NULL, built$plot$labels$y)
  axis_text <- tryCatch(ggplot2::calc_element("axis.text.x", theme), error = function(e) NULL)
  if (!is.null(axis_text)) add("tick_labels", "tick_labels", NULL, NULL,
                               list(size = axis_text$size, angle = axis_text$angle))
  scale <- built$plot$scales$get_scales("fill")
  if (is.null(scale)) scale <- built$plot$scales$get_scales("colour")
  if (!is.null(scale)) {
    position <- theme$legend.position
    position_value <- if (is.null(position)) "right" else position
    position_current <- if (identical(position_value, "inside")) {
      inside <- theme$legend.position.inside
      list(position = "inside", inside = if (is.null(inside)) list() else as.numeric(inside))
    } else {
      list(position = position_value)
    }
    add("legend", "legend", NULL, NULL,
        c(position_current,
          list(title = if (!is.null(built$plot$labels$fill)) built$plot$labels$fill else built$plot$labels$colour,
               visible = !identical(position_value, "none"))))
    labels <- scale$get_labels()
    breaks <- scale$get_breaks()
    colours <- tryCatch(scale$map(breaks), error = function(e) rep(NA_character_, length(labels)))
    for (index in seq_along(labels)) {
      add(paste0("series[", labels[index], "]"), "series", NULL, labels[index],
          list(color = unname(colours[index])))
    }
  }
  grid <- tryCatch(ggplot2::calc_element("panel.grid", theme), error = function(e) NULL)
  grid_visible <- !inherits(grid, "element_blank")
  if (panels == 1L) add("grid", "grid", NULL, NULL, grid_visible)
  for (index in seq_len(panels)) {
    panel <- panel_params[[index]]
    prefix <- if (panels > 1L) paste0("axes[", index - 1L, "].") else ""
    axes <- if (panels > 1L) index - 1L else NULL
    if (panels > 1L) add(paste0(prefix, "grid"), "grid", axes, NULL, grid_visible)
    add(paste0(prefix, "axis_range"), "axis_range", axes, NULL,
        list(x = as.numeric(panel$x$continuous_range), y = as.numeric(panel$y$continuous_range)))
    scale_name <- function(value) {
      tryCatch(value$get_transformation()$name, error = function(e) "discrete")
    }
    add(paste0(prefix, "axis_scale"), "axis_scale", axes, NULL,
        list(x = scale_name(panel$x), y = scale_name(panel$y)))
  }
  text <- tryCatch(ggplot2::calc_element("text", theme), error = function(e) NULL)
  if (!is.null(text)) {
    add("font", "font", NULL, NULL, list(family = text$family, size = text$size))
  }
  annotation_geoms <- c("GeomHline", "GeomVline", "GeomAbline", "GeomText", "GeomLabel", "GeomSegment", "GeomCurve")
  for (index in seq_along(plot$layers)) {
    geom <- class(plot$layers[[index]]$geom)[1]
    if (geom %in% annotation_geoms) {
      data <- built$data[[index]]
      labels <- unique(as.character(data$label))
      label <- if (length(labels) > 0L) paste(labels, collapse = " / ") else geom
      colours <- unique(as.character(data$colour))
      add(paste0("annotation[layer", index, ":", geom, "]"), "annotation", NULL, label,
          list(geom = geom, text = if (length(labels) > 0L) label else NULL,
               color = if (length(colours) == 1L) colours[1] else NULL,
               params = as.list(plot$layers[[index]]$aes_params)))
    }
  }
  .dsh_dedupe_element_ids(elements)
}

.dsh_read_png_size <- function(path) {
  con <- file(path, open = "rb")
  on.exit(close(con))
  bytes <- readBin(con, what = "raw", n = 24L)
  signature <- as.raw(c(137, 80, 78, 71, 13, 10, 26, 10))
  if (length(bytes) != 24L || !identical(bytes[1:8], signature) || rawToChar(bytes[13:16]) != "IHDR") {
    stop("not a PNG IHDR")
  }
  uint32 <- function(value) sum(as.numeric(value) * c(256^3, 256^2, 256, 1))
  c(width = uint32(bytes[17:20]), height = uint32(bytes[21:24]))
}

compute_hitmap <- function(plot, width_in, height_in, dpi, save_args) {
  result <- list()
  add <- function(id, bbox, z) {
    values <- pmax(c(0, 0, 0, 0), pmin(c(width_in * dpi, height_in * dpi, width_in * dpi, height_in * dpi), as.numeric(bbox)))
    if (all(is.finite(values)) && values[1] <= values[3] && values[2] <= values[4]) {
      result[[length(result) + 1L]] <<- list(id = id, bbox = unname(values), z = z)
    }
  }
  temp <- tempfile(fileext = ".png")
  on.exit(unlink(temp), add = TRUE)
  device_args <- save_args[!names(save_args) %in% c("device", "width", "height", "units", "dpi", "limitsize", "scale")]
  do.call(save_args$device, c(list(filename = temp, width = width_in, height = height_in), device_args))
  on.exit(grDevices::dev.off(), add = TRUE)
  table <- ggplot2::ggplotGrob(plot)
  layout <- table$layout
  grid::grid.newpage()
  grid::grid.draw(table)
  cell_bbox <- function(row) {
    grid::pushViewport(grid::viewport(layout = grid::grid.layout(
      nrow(table), ncol(table), widths = table$widths, heights = table$heights)))
    grid::pushViewport(grid::viewport(layout.pos.row = layout$t[row]:layout$b[row],
                                     layout.pos.col = layout$l[row]:layout$r[row]))
    top_left <- grid::deviceLoc(grid::unit(0, "npc"), grid::unit(1, "npc"), valueOnly = TRUE)
    bottom_right <- grid::deviceLoc(grid::unit(1, "npc"), grid::unit(0, "npc"), valueOnly = TRUE)
    grid::popViewport(2)
    c(top_left$x * dpi, (height_in - top_left$y) * dpi,
      bottom_right$x * dpi, (height_in - bottom_right$y) * dpi)
  }
  singleton <- function(pattern, id, z = 3) {
    rows <- grep(pattern, layout$name)
    for (row in rows) {
      if (!inherits(table$grobs[[row]], "zeroGrob")) add(id, cell_bbox(row), z)
    }
  }
  singleton("^title$", "title")
  singleton("^subtitle$", "subtitle")
  singleton("^xlab-b$", "x_label")
  singleton("^ylab-l$", "y_label")
  singleton("^guide-box-", "legend", 5)
  panels <- grep("^panel(-[0-9]+-[0-9]+)?$", layout$name)
  for (index in seq_along(panels)) {
    prefix <- if (length(panels) > 1L) paste0("axes[", index - 1L, "].") else ""
    add(paste0(prefix, "grid"), cell_bbox(panels[index]), -1000)
  }
  result
}

extract_chart <- function(entry, path) {
  if (!is.null(entry$snapshot)) entry <- .dsh_copy_chart(entry)
  size <- .dsh_read_png_size(path)
  width_in <- size[["width"]] / entry$dpi
  height_in <- size[["height"]] / entry$dpi
  elements <- extract_elements(entry$plot)
  hitmap <- tryCatch(compute_hitmap(entry$plot, width_in, height_in, entry$dpi, entry$save_args), error = function(e) NULL)
  if (!is.null(hitmap)) hitmap <- Filter(function(hit) hit$id %in% vapply(elements, function(item) item$id, character(1)), hitmap)
  list(runtime = "ggplot2",
       png = list(width = size[["width"]], height = size[["height"]], dpi = entry$dpi),
       elements = elements,
       hitmap = if (is.null(hitmap)) list() else hitmap,
       hitmapStatus = if (is.null(hitmap)) "unavailable" else "ok")
}

.dsh_axes_available <- function(plot, axes) {
  panels <- length(ggplot2::ggplot_build(plot)$layout$panel_params)
  is.null(axes) || (axes >= 0L && axes < panels)
}

# Deterministic mapping from the shared matplotlib-derived `position` enum to
# a ggplot2 legend placement. ggplot2 has no automatic-layout equivalent to
# matplotlib's "best", so it takes the same outside placement as "right"; a
# corner/edge/center value places the legend inside the panel at the matching
# normalized coordinate (ggplot2 4's `legend.position = "inside"` mechanism).
# An unmapped `position` is a codec-level bug, not a legal runtime input:
# `stop()` here surfaces as a failed op rather than silently dropping the
# legend the way passing an unrecognized string straight to
# `theme(legend.position = ...)` used to.
.dsh_legend_inside_coords <- list(
  "upper left" = c(0, 1), "upper right" = c(1, 1),
  "lower left" = c(0, 0), "lower right" = c(1, 0),
  "center left" = c(0, 0.5), "center right" = c(1, 0.5),
  "upper center" = c(0.5, 1), "lower center" = c(0.5, 0),
  "center" = c(0.5, 0.5)
)

set_legend_position <- function(plot, position) {
  if (position == "best" || position == "right") {
    return(plot + ggplot2::theme(legend.position = "right"))
  }
  coords <- .dsh_legend_inside_coords[[position]]
  if (is.null(coords)) stop("unknown_legend_position")
  plot + ggplot2::theme(legend.position = "inside", legend.position.inside = coords,
                         legend.justification.inside = coords)
}

.dsh_font_available <- function(family) {
  if (!requireNamespace("systemfonts", quietly = TRUE)) return(family %in% c("sans", "serif", "mono"))
  matched <- systemfonts::match_fonts(family)
  matched_family <- if ("family" %in% names(matched)) {
    as.character(matched$family[[1]])
  } else {
    info <- systemfonts::font_info(matched$path[[1]], matched$index[[1]])
    as.character(info$family[[1]])
  }
  identical(matched_family, family)
}

apply_ops <- function(plot, ops) {
  failed <- list()
  current <- plot
  for (index in seq_along(ops)) {
    operation <- ops[[index]]
    outcome <- tryCatch({
      if (!.dsh_axes_available(current, operation$axes)) stop("axes_not_found")
      name <- operation$op
      if (name == "set_title") {
        current <- current + ggplot2::labs(title = operation$text)
      } else if (name == "set_axis_label") {
        current <- if (operation$axis == "x") current + ggplot2::labs(x = operation$text) else current + ggplot2::labs(y = operation$text)
      } else if (name == "set_legend_position") {
        current <- set_legend_position(current, operation$position)
      } else if (name == "toggle_grid") {
        grid <- if (isTRUE(operation$visible)) ggplot2::element_line() else ggplot2::element_blank()
        current <- current + ggplot2::theme(panel.grid = grid)
      } else if (name == "set_font") {
        if (!.dsh_font_available(operation$family)) stop("font_not_found")
        current <- current + ggplot2::theme(text = ggplot2::element_text(family = operation$family, size = operation$size))
      } else stop("unknown_op")
      NULL
    }, error = function(error) conditionMessage(error))
    if (!is.null(outcome)) failed[[length(failed) + 1L]] <- list(index = index - 1L, reason = outcome)
  }
  list(plot = current, failedOps = failed)
}
