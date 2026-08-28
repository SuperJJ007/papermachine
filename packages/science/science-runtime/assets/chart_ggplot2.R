# Private ggplot2 save registration and chart extraction for the Science kernel.

.dsh_chart_state <- new.env(parent = emptyenv())
.dsh_chart_state$traced <- FALSE

.dsh_inside <- function(path, root) {
  target <- normalizePath(path, mustWork = FALSE)
  base <- normalizePath(root, mustWork = FALSE)
  identical(target, base) || startsWith(target, paste0(base, .Platform$file.sep))
}

install_ggsave_hook <- function(register) {
  install_now <- function(...) {
    if (.dsh_chart_state$traced || !("ggplot2" %in% loadedNamespaces())) return(invisible(NULL))
    register_exit <- function() register(parent.frame())
    trace("ggsave", exit = register_exit, print = FALSE, where = asNamespace("ggplot2"))
    .dsh_chart_state$traced <- TRUE
    invisible(NULL)
  }
  setHook(packageEvent("ggplot2", "onLoad"), install_now, action = "append")
  install_now()
}

.dsh_theme_for <- function(plot) {
  theme <- ggplot2::theme_get()
  if (!is.null(plot$theme)) theme <- plot$theme + theme
  theme
}

.dsh_safe_add <- function(elements, value) {
  tryCatch({
    item <- force(value)
    elements[[length(elements) + 1L]] <- item
    elements
  }, error = function(e) elements)
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
  if (!is.null(plot$labels$title)) add("title", "title", NULL, NULL, plot$labels$title)
  if (!is.null(plot$labels$subtitle)) add("subtitle", "subtitle", NULL, NULL, plot$labels$subtitle)
  if (!is.null(plot$labels$x)) add("x_label", "x_label", NULL, NULL, plot$labels$x)
  if (!is.null(plot$labels$y)) add("y_label", "y_label", NULL, NULL, plot$labels$y)
  axis_text <- tryCatch(ggplot2::calc_element("axis.text.x", theme), error = function(e) NULL)
  if (!is.null(axis_text)) add("tick_labels", "tick_labels", NULL, NULL,
                               list(size = axis_text$size, angle = axis_text$angle))
  scale <- built$plot$scales$get_scales("fill")
  if (is.null(scale)) scale <- built$plot$scales$get_scales("colour")
  if (!is.null(scale)) {
    position <- theme$legend.position
    add("legend", "legend", NULL, NULL,
        list(position = if (is.null(position)) "right" else position,
             title = if (!is.null(plot$labels$fill)) plot$labels$fill else plot$labels$colour,
             visible = !identical(position, "none")))
    labels <- scale$get_labels()
    breaks <- scale$get_breaks()
    colours <- tryCatch(scale$map(breaks), error = function(e) rep(NA_character_, length(labels)))
    for (index in seq_along(labels)) {
      add(paste0("series[", labels[index], "]"), "series", NULL, labels[index],
          list(color = unname(colours[index])))
    }
  }
  grid <- tryCatch(ggplot2::calc_element("panel.grid", theme), error = function(e) NULL)
  add("grid", "grid", NULL, NULL, !inherits(grid, "element_blank"))
  for (index in seq_len(panels)) {
    panel <- panel_params[[index]]
    prefix <- if (panels > 1L) paste0("axes[", index - 1L, "].") else ""
    axes <- if (panels > 1L) index - 1L else NULL
    add(paste0(prefix, "axis_range"), "axis_range", axes, NULL,
        list(x = as.numeric(panel$x$continuous_range), y = as.numeric(panel$y$continuous_range)))
    scale_name <- function(value) {
      tryCatch(value$get_transformation()$name, error = function(e) "discrete")
    }
    add(paste0(prefix, "axis_scale"), "axis_scale", axes, NULL,
        list(x = scale_name(panel$x), y = scale_name(panel$y)))
  }
  add("figure_size", "figure_size", NULL, NULL, NULL)
  text <- tryCatch(ggplot2::calc_element("text", theme), error = function(e) NULL)
  if (!is.null(text)) add("font", "font", NULL, NULL, list(family = text$family, size = text$size))
  annotation_geoms <- c("GeomHline", "GeomVline", "GeomAbline", "GeomText", "GeomLabel", "GeomSegment", "GeomCurve")
  for (index in seq_along(plot$layers)) {
    geom <- class(plot$layers[[index]]$geom)[1]
    if (geom %in% annotation_geoms) {
      add(paste0("annotation[layer", index, ":", geom, "]"), "annotation", NULL, NULL,
          list(geom = geom, params = as.list(plot$layers[[index]]$aes_params)))
    }
  }
  elements
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

compute_hitmap <- function(plot, width_in, height_in, dpi) {
  table <- ggplot2::ggplotGrob(plot)
  layout <- table$layout
  result <- list()
  add <- function(id, bbox, z) {
    values <- pmax(c(0, 0, 0, 0), pmin(c(width_in * dpi, height_in * dpi, width_in * dpi, height_in * dpi), as.numeric(bbox)))
    if (all(is.finite(values)) && values[1] <= values[3] && values[2] <= values[4]) {
      result[[length(result) + 1L]] <<- list(id = id, bbox = unname(values), z = z)
    }
  }
  temp <- tempfile(fileext = ".png")
  on.exit(unlink(temp), add = TRUE)
  grDevices::png(temp, width = width_in, height = height_in, units = "in", res = dpi)
  on.exit(grDevices::dev.off(), add = TRUE)
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
  size <- .dsh_read_png_size(path)
  width_in <- size[["width"]] / entry$dpi
  height_in <- size[["height"]] / entry$dpi
  elements <- extract_elements(entry$plot)
  hitmap <- tryCatch(compute_hitmap(entry$plot, width_in, height_in, entry$dpi), error = function(e) NULL)
  list(runtime = "ggplot2",
       png = list(width = size[["width"]], height = size[["height"]], dpi = entry$dpi),
       elements = elements,
       hitmap = if (is.null(hitmap)) list() else hitmap,
       hitmapStatus = if (is.null(hitmap)) "unavailable" else "ok")
}
