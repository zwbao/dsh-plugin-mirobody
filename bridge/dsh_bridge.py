"""Stdlib bridge from the DSH plugin to the installed Mirobody engine.

One JSON object on stdin, one JSON object on stdout. The engine itself
(LOINC bundle, UCUM) stays in the Python package. This file does not
reimplement resolution.
"""

from __future__ import annotations

import json
import os
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=_plain))
    sys.stdout.write("\n")


def _plain(value):
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return item()
        except Exception:
            return str(value)
    return str(value)


def _jsonable(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _jsonable(item())
        except Exception:
            pass
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "__dict__"):
        return {
            key: _jsonable(item)
            for key, item in vars(value).items()
            if not str(key).startswith("_")
        }
    return str(value)


def _fields(obj):
    try:
        import dataclasses

        if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
            return _jsonable(dataclasses.asdict(obj))
    except Exception:
        pass
    data = _jsonable(obj)
    return data if isinstance(data, dict) else {"value": data}


def _prepare_path():
    home = os.environ.get("MIROBODY_HOME", "").strip()
    if home and home not in sys.path:
        sys.path.insert(0, home)


def _import_engine():
    _prepare_path()
    try:
        import mirobody
        from mirobody import engine
        from mirobody import units
    except Exception as exc:
        return None, {
            "ok": False,
            "error_kind": "unavailable",
            "error": "cannot import mirobody: %s: %s" % (type(exc).__name__, exc),
            "hint": (
                "Install mirobody on Python 3.12+ (`pip install mirobody`) and point "
                "pythonBin at that interpreter. mirobodyHome is a source checkout "
                "added to PYTHONPATH; it still needs the LOINC bundle from git lfs."
            ),
            "python": sys.version.split()[0],
        }
    return (mirobody, engine, units), None


def _names(value, limit):
    if not isinstance(value, list) or not value:
        return None, "names must be a non-empty list of strings."
    if len(value) > limit:
        return None, "Too many names in one call (max %s)." % limit
    cleaned = []
    for raw in value:
        if isinstance(raw, str) and raw.strip():
            cleaned.append(raw)
    if not cleaned:
        return None, "names must be a non-empty list of strings."
    return cleaned, None


def _resolve(engine, names):
    resolve = getattr(engine, "resolve", None)
    if resolve is None:
        return {"ok": False, "error_kind": "internal", "error": "mirobody.engine.resolve is missing"}
    results = []
    for raw in names:
        row = _fields(resolve(raw))
        row["name"] = raw
        results.append(row)
    matched = sum(1 for row in results if row.get("resolved"))
    return {
        "ok": True,
        "success": True,
        "message": "%s/%s resolved" % (matched, len(results)),
        "results": results,
    }


def _resolve_reading(engine, req):
    fn = getattr(engine, "resolve_reading", None)
    if fn is None:
        return {
            "ok": False,
            "error_kind": "unavailable",
            "error": "this mirobody build has no resolve_reading",
            "hint": "Upgrade the mirobody package. resolve_indicator still maps a name without the unit.",
        }
    name = req.get("name")
    if not isinstance(name, str) or not name.strip():
        return {"ok": False, "success": False, "error_kind": "invalid_arguments", "error": "name is required"}
    value = req.get("value")
    unit = req.get("unit")
    if unit == "":
        unit = None
    try:
        row = _fields(fn(name, value, unit))
    except Exception as exc:
        return {"ok": False, "error_kind": "internal", "error": "%s: %s" % (type(exc).__name__, exc)}
    row["name"] = name
    return {"ok": True, "success": True, "result": row}


def _convert(units, req):
    try:
        value = float(req.get("value"))
    except (TypeError, ValueError):
        return {"ok": False, "success": False, "error_kind": "invalid_arguments", "error": "value must be a number."}
    from_unit = req.get("from_unit")
    to_unit = req.get("to_unit")
    if not isinstance(from_unit, str) or not from_unit.strip() or not isinstance(to_unit, str) or not to_unit.strip():
        return {
            "ok": False,
            "success": False,
            "error_kind": "invalid_arguments",
            "error": "from_unit and to_unit are required",
        }
    normalize_unit = units.normalize_unit
    src = normalize_unit(from_unit) or from_unit
    dst = normalize_unit(to_unit) or to_unit
    loinc = req.get("loinc_code") or ""
    if not isinstance(loinc, str):
        loinc = ""
    try:
        converted = units.convert_value(value, src, dst, loinc_code=loinc.strip())
    except TypeError:
        converted = units.convert_value(value, src, dst)
    except (ValueError, Exception) as exc:
        return {"ok": False, "success": False, "error_kind": "internal", "error": "%s: %s" % (type(exc).__name__, exc)}
    if converted is None:
        return {
            "ok": True,
            "success": True,
            "converted": None,
            "from_ucum": src,
            "to_ucum": dst,
            "reason": (
                "These units are not interconvertible. Either they measure different things "
                "(a percentage is not an absolute count), or the conversion needs a molar mass "
                "this engine does not carry for that code. Report the readings separately."
            ),
        }
    return {
        "ok": True,
        "success": True,
        "converted": _jsonable(converted),
        "from_ucum": src,
        "to_ucum": dst,
    }


def _normalize(units, raw_units):
    names, error = _names(raw_units, 200)
    if error:
        return {"ok": False, "success": False, "error_kind": "invalid_arguments", "error": error.replace("names", "units")}
    results = []
    for raw in names:
        ucum = units.normalize_unit(raw) or ""
        family = ""
        if ucum:
            family = units.unit_family(ucum) or ""
        results.append({"unit": raw, "ucum": ucum, "family": family})
    matched = sum(1 for row in results if row["ucum"])
    return {
        "ok": True,
        "success": True,
        "message": "%s/%s normalized" % (matched, len(results)),
        "results": results,
    }


def _status(mirobody):
    return {
        "ok": True,
        "success": True,
        "version": getattr(mirobody, "__version__", ""),
        "bundle": getattr(mirobody, "BUNDLE_VERSION", ""),
        "python": sys.version.split()[0],
    }


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        emit({"ok": False, "error_kind": "invalid_arguments", "error": "bridge stdin is not JSON"})
        return
    if not isinstance(req, dict):
        emit({"ok": False, "error_kind": "invalid_arguments", "error": "bridge request must be an object"})
        return
    loaded, failure = _import_engine()
    if failure:
        emit(failure)
        return
    mirobody, engine, units = loaded
    op = req.get("op")
    if op == "status":
        emit(_status(mirobody))
    elif op == "resolve":
        names, error = _names(req.get("names"), 200)
        if error:
            emit({"ok": False, "success": False, "error_kind": "invalid_arguments", "error": error})
        else:
            emit(_resolve(engine, names))
    elif op == "resolve_reading":
        emit(_resolve_reading(engine, req))
    elif op == "convert":
        emit(_convert(units, req))
    elif op == "normalize":
        emit(_normalize(units, req.get("units")))
    else:
        emit({"ok": False, "error_kind": "invalid_arguments", "error": "unknown op"})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"ok": False, "error_kind": "internal", "error": "%s: %s" % (type(exc).__name__, exc)})
