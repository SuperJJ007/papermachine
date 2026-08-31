"""Private matplotlib save registration and chart extraction for the Science kernel."""

import copy
import importlib.abc
import importlib.machinery
import math
import os
import struct
import sys


def _inside(path, root):
    try:
        return os.path.commonpath([os.path.realpath(path), os.path.realpath(root)]) == os.path.realpath(root)
    except (OSError, ValueError):
        return False


def _wrap_figure_savefig(register):
    module = sys.modules.get("matplotlib.figure")
    if module is None:
        return False
    figure = module.Figure
    original = figure.savefig
    if getattr(original, "_dsh_chart_hook", False):
        return True

    def savefig(self, fname, *args, **kwargs):
        artifact_dir = os.environ.get("SCIENCE_ARTIFACT_DIR")
        tracked = (artifact_dir and isinstance(fname, (str, os.PathLike))
                   and os.fspath(fname).lower().endswith(".png") and _inside(fname, artifact_dir))
        if not tracked:
            return original(self, fname, *args, **kwargs)
        entry = save_chart(self, fname, args, kwargs, original)
        register(os.path.relpath(os.path.realpath(fname), os.path.realpath(artifact_dir)).replace(os.sep, "/"), entry)

    savefig._dsh_chart_hook = True
    savefig._dsh_original = original
    figure.savefig = savefig
    return True


def copy_chart(entry):
    """Clone the figure and related save artists without registering another pyplot manager."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg

    canvas = entry["fig"].canvas
    manager = canvas.manager
    try:
        canvas.manager = None
        copied = copy.deepcopy(entry)
    finally:
        canvas.manager = manager
    # Figure serialization restores logical DPI but retains the display's pixel transform.
    copied["fig"].dpi_scale_trans.clear().scale(copied["fig"].dpi)
    FigureCanvasAgg(copied["fig"])
    return copied


class _FigureLoader(importlib.abc.Loader):
    def __init__(self, loader, finder, register):
        self._loader = loader
        self._finder = finder
        self._register = register

    def create_module(self, spec):
        creator = getattr(self._loader, "create_module", None)
        return None if creator is None else creator(spec)

    def exec_module(self, module):
        self._loader.exec_module(module)
        _wrap_figure_savefig(self._register)
        try:
            sys.meta_path.remove(self._finder)
        except ValueError:
            pass


class _FigureFinder(importlib.abc.MetaPathFinder):
    def __init__(self, register):
        self._register = register

    def find_spec(self, fullname, path=None, target=None):
        if fullname != "matplotlib.figure":
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path, target)
        if spec is not None and spec.loader is not None:
            spec.loader = _FigureLoader(spec.loader, self, self._register)
        return spec


def install_savefig_hook(register):
    """Install the idempotent Figure.savefig hook without importing matplotlib eagerly."""
    if _wrap_figure_savefig(register):
        return
    if not any(isinstance(finder, _FigureFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, _FigureFinder(register))


def _axid(index, count, name):
    return "axes[%d].%s" % (index, name) if count > 1 else name


def _safe_add(elements, factory):
    try:
        value = factory()
        if value is not None:
            elements.append(value)
    except Exception:
        pass


def _labeled_artists(axis):
    for artist in list(axis.lines) + list(axis.containers):
        try:
            label = artist.get_label()
            if label and not label.startswith("_"):
                yield label, artist
        except Exception:
            continue


def _series_color(matplotlib, artist):
    patches = getattr(artist, "patches", None)
    if patches:
        return matplotlib.colors.to_hex(patches[0].get_facecolor())
    getter = getattr(artist, "get_color", None)
    return matplotlib.colors.to_hex(getter()) if getter is not None else None


def _dedupe_element_ids(elements):
    """Append a stable `#N` suffix to id collisions, in first-occurrence order.

    Distinct artists (for example, two ``ax.annotate`` calls whose text rounds
    to the same displayed value) can generate the same catalog id; the host
    codec requires unique element ids and rejects the entire chart otherwise.
    """
    seen = {}
    for element in elements:
        base = element["id"]
        count = seen.get(base, 0) + 1
        seen[base] = count
        if count > 1:
            element["id"] = "%s#%d" % (base, count)
    return elements


def extract_elements(fig):
    """Extract isolated, JSON-safe catalog entries from one live Figure."""
    import matplotlib

    elements = []
    axes = fig.get_axes()
    count = len(axes)
    suptitle = getattr(fig, "_suptitle", None)
    has_suptitle = suptitle is not None and bool(suptitle.get_text())
    if has_suptitle:
        _safe_add(elements, lambda: {"id": "title", "kind": "title", "axes": None, "label": None,
                                     "current": suptitle.get_text()})
    _safe_add(elements, lambda: {"id": "figure_size", "kind": "figure_size", "axes": None, "label": None,
                                 "current": [float(value) for value in fig.get_size_inches()]})
    def font_current():
        from matplotlib.text import Text

        if axes:
            text = axes[0].title
        else:
            texts = fig.findobj(match=Text)
            text = texts[0] if texts else None
        if text is None:
            return {"family": list(matplotlib.rcParams["font.family"]),
                    "size": float(matplotlib.rcParams["font.size"])}
        return {"family": list(text.get_fontfamily()), "size": float(text.get_fontsize())}
    _safe_add(elements, lambda: {"id": "font", "kind": "font", "axes": None, "label": None,
                                 "current": font_current()})
    for index, axis in enumerate(axes):
        title = axis.get_title()
        if title:
            # A single axes with no suptitle is the ordinary one-panel figure:
            # its own title reads as the figure's title, not a "subtitle" with
            # no title above it. A suptitle or multiple axes keep the axes
            # title subordinate (subtitle for the sole axes under a suptitle,
            # title-per-axes when there is more than one).
            if count == 1:
                kind = "subtitle" if has_suptitle else "title"
            else:
                kind = "title"
            _safe_add(elements, lambda title=title, kind=kind: {
                "id": _axid(index, count, kind), "kind": kind, "axes": index, "label": None, "current": title})
        for kind, getter in (("x_label", axis.get_xlabel), ("y_label", axis.get_ylabel)):
            label = getter()
            if label:
                _safe_add(elements, lambda label=label, kind=kind: {
                    "id": _axid(index, count, kind), "kind": kind, "axes": index,
                    "label": None, "current": label})
        labels = axis.get_xticklabels()
        if labels:
            _safe_add(elements, lambda: {
                "id": _axid(index, count, "tick_labels"), "kind": "tick_labels", "axes": index,
                "label": None, "current": {"fontsize": float(labels[0].get_fontsize()),
                                            "rotation": float(labels[0].get_rotation())}})
        legend = axis.get_legend()
        if legend is not None:
            _safe_add(elements, lambda: {
                "id": _axid(index, count, "legend"), "kind": "legend", "axes": index, "label": None,
                "current": {"loc": getattr(legend, "_loc", None),
                            "title": legend.get_title().get_text() or None,
                            "visible": bool(legend.get_visible())}})
        for label, artist in _labeled_artists(axis):
            _safe_add(elements, lambda label=label, artist=artist: {
                "id": _axid(index, count, "series[%s]" % label), "kind": "series", "axes": index,
                "label": label, "current": {"color": _series_color(matplotlib, artist)}})
        gridlines = axis.get_xgridlines() + axis.get_ygridlines()
        _safe_add(elements, lambda: {
            "id": _axid(index, count, "grid"), "kind": "grid", "axes": index, "label": None,
            "current": any(line.get_visible() for line in gridlines)})
        _safe_add(elements, lambda: {
            "id": _axid(index, count, "axis_range"), "kind": "axis_range", "axes": index, "label": None,
            "current": {"x": [float(value) for value in axis.get_xlim()],
                        "y": [float(value) for value in axis.get_ylim()]}})
        _safe_add(elements, lambda: {
            "id": _axid(index, count, "axis_scale"), "kind": "axis_scale", "axes": index, "label": None,
            "current": {"x": axis.get_xscale(), "y": axis.get_yscale()}})
        for text in axis.texts:
            _safe_add(elements, lambda text=text: {
                "id": _axid(index, count, "annotation[text:%s]" % text.get_text()[:20]),
                "kind": "annotation", "axes": index, "label": text.get_text(),
                "current": {"type": "text", "text": text.get_text(), "color": matplotlib.colors.to_hex(text.get_color())}})
    return _dedupe_element_ids(elements)


def _artist_for(fig, element):
    axes = fig.get_axes()
    index = element["axes"]
    axis = axes[index] if index is not None else None
    kind = element["kind"]
    if kind == "title" and index is None:
        return getattr(fig, "_suptitle", None)
    if kind in ("title", "subtitle"):
        return axis.title
    if kind == "x_label":
        return axis.xaxis.label
    if kind == "y_label":
        return axis.yaxis.label
    if kind == "tick_labels":
        return [axis.get_xticklabels(), axis.get_yticklabels()]
    if kind == "legend":
        return axis.get_legend() if axis is not None else (fig.legends[0] if fig.legends else None)
    if kind == "series":
        matches = [artist for label, artist in _labeled_artists(axis) if label == element["label"]]
        occurrence = int(element["id"].rsplit("#", 1)[1]) - 1 if "]#" in element["id"] else 0
        return matches[occurrence] if occurrence < len(matches) else None
    if kind == "grid":
        return axis.patch
    if kind == "annotation":
        matches = [text for text in axis.texts if "text:%s]" % text.get_text()[:20] in element["id"]]
        occurrence = int(element["id"].rsplit("#", 1)[1]) - 1 if "]#" in element["id"] else 0
        return matches[occurrence] if occurrence < len(matches) else None
    return None


def _bbox(artists, renderer):
    from matplotlib.transforms import Bbox

    boxes = []
    for artist in artists:
        patches = getattr(artist, "patches", None)
        if patches is not None:
            boxes.extend(patch.get_window_extent(renderer) for patch in patches)
        else:
            boxes.append(artist.get_window_extent(renderer))
    return None if not boxes else Bbox.union(boxes)


def compute_hitmap(fig, elements, dpi, width, height):
    """Compute bounded top-left pixel targets against the saved PNG grid."""
    fig.set_dpi(dpi)
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    return _renderer_hitmap(fig, elements, renderer, width, height)


def _renderer_hitmap(fig, elements, renderer, width, height):
    result = []
    for element in elements:
        try:
            artist = _artist_for(fig, element)
            if artist is None:
                continue
            groups = artist if (element["kind"] == "tick_labels") else [[artist]]
            for group in groups:
                artists = group if isinstance(group, list) else [group]
                box = _bbox(artists, renderer)
                if box is None:
                    continue
                coords = [max(0.0, min(float(width), float(box.x0))),
                          max(0.0, min(float(height), float(height - box.y1))),
                          max(0.0, min(float(width), float(box.x1))),
                          max(0.0, min(float(height), float(height - box.y0)))]
                if all(math.isfinite(value) for value in coords) and coords[0] <= coords[2] and coords[1] <= coords[3]:
                    zorder = -1000.0 if element["kind"] == "grid" else float(getattr(artist, "get_zorder", lambda: 0)())
                    result.append({"id": element["id"], "bbox": coords, "z": zorder})
        except Exception:
            continue
    return result


def save_chart(fig, path, args, kwargs, savefig=None):
    """Capture geometry from the final export draw, including tight-bbox cropping."""
    import matplotlib

    options = dict(kwargs)
    requested = options.get("dpi")
    if requested is None:
        requested = matplotlib.rcParams["savefig.dpi"]
    dpi = float(getattr(fig, "_original_dpi", fig.dpi) if requested == "figure" else requested)
    options["dpi"] = dpi
    for key in ("bbox_inches", "pad_inches", "facecolor", "edgecolor", "transparent"):
        if options.get(key) is None:
            setting = "bbox" if key == "bbox_inches" else key
            options[key] = matplotlib.rcParams["savefig." + setting]
    if options["transparent"]:
        for key in ("facecolor", "edgecolor"):
            if key not in kwargs:
                options[key] = "none"
    captured = {}
    canvas = fig.canvas

    def on_draw(event):
        # The final draw occurs while matplotlib's export transform is active.
        # An earlier layout draw can precede it; only the last one is retained.
        try:
            width, height = int(event.renderer.width), int(event.renderer.height)
            elements = extract_elements(fig)
            captured.update(elements=elements, raster_size=(width, height),
                            hitmap=_renderer_hitmap(fig, elements, event.renderer, width, height))
        except Exception:
            # Custom renderers may not expose pixel geometry. Keep raster editing.
            captured.clear()

    subscription = canvas.mpl_connect("draw_event", on_draw)
    try:
        if savefig is None:
            method = type(fig).savefig
            getattr(method, "_dsh_original", method)(fig, path, *args, **options)
        else:
            savefig(fig, path, *args, **options)
    finally:
        canvas.mpl_disconnect(subscription)
    elements = captured.get("elements", extract_elements(fig))
    return {"fig": fig, "dpi": dpi, "save_options": options, "rc": dict(matplotlib.rcParams),
            "elements": elements, "raster_size": captured.get("raster_size"),
            "hitmap": captured.get("hitmap", [])}


def read_png_size(path):
    """Read the exact PNG IHDR dimensions without an image dependency."""
    with open(path, "rb") as stream:
        header = stream.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("not a PNG IHDR")
    return struct.unpack(">II", header[16:24])


def extract_chart(entry, path):
    """Extract one registered figure while preserving the catalog on raster mismatch."""
    width, height = read_png_size(path)
    elements = entry["elements"]
    available = entry["raster_size"] == (width, height)
    hitmap = entry["hitmap"] if available else []
    return {"runtime": "matplotlib", "png": {"width": width, "height": height, "dpi": entry["dpi"]},
            "elements": elements, "hitmap": hitmap,
            "hitmapStatus": "ok" if available else "unavailable"}


def _selected_axes(fig, index):
    axes = fig.get_axes()
    if index is None:
        return axes
    if index >= len(axes):
        raise LookupError("axes_not_found")
    return [axes[index]]


def _set_legend_position(axis, position):
    legend = axis.get_legend()
    if legend is None:
        return False
    handles = getattr(legend, "legend_handles", None) or getattr(legend, "legendHandles", None)
    labels = [text.get_text() for text in legend.get_texts()]
    title = legend.get_title().get_text()
    legend.remove()
    axis.legend(handles, labels, title=title or None, loc=position)
    return True


def apply_ops(fig, ops):
    """Apply validated operations and return indices that could not resolve a target."""
    failed = []
    for index, operation in enumerate(ops):
        try:
            name = operation["op"]
            axes = _selected_axes(fig, operation["axes"])
            applied = False
            if name == "set_title":
                if operation["axes"] is None:
                    if fig._suptitle is None:
                        fig.suptitle(operation["text"])
                    else:
                        fig._suptitle.set_text(operation["text"])
                    applied = True
                else:
                    axes[0].title.set_text(operation["text"])
                    applied = True
            elif name == "set_subtitle":
                for axis in axes:
                    axis.title.set_text(operation["text"])
                    applied = True
            elif name == "set_axis_label":
                for axis in axes:
                    (axis.xaxis if operation["axis"] == "x" else axis.yaxis).label.set_text(operation["text"])
                    applied = True
            elif name == "set_legend_position":
                for axis in axes:
                    applied = _set_legend_position(axis, operation["position"]) or applied
            elif name == "toggle_grid":
                for axis in axes:
                    axis.grid(operation["visible"])
                    applied = True
            elif name == "set_font":
                from matplotlib import font_manager
                from matplotlib.font_manager import FontProperties
                from matplotlib.text import Text

                family = operation["family"]
                try:
                    font_manager.findfont(FontProperties(family=family), fallback_to_default=False)
                except Exception as error:
                    raise ValueError("font_not_found") from error
                for text in fig.findobj(match=Text):
                    text.set_fontfamily(family)
                    text.set_fontsize(operation["size"])
                applied = True
            else:
                raise ValueError("unknown_op")
            if not applied:
                failed.append({"index": index, "reason": "element_not_found"})
        except (KeyError, LookupError, TypeError, ValueError) as error:
            failed.append({"index": index, "reason": str(error) or type(error).__name__})
    return failed
