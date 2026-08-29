"""greenrot python helper. Stdlib only. Speaks JSON on stdout, nothing else.

Every failure is reported as a JSON error object carrying a reason code. This
process must never print a traceback to stdout: the Node side parses stdout as
JSON, and a traceback there would be indistinguishable from a parse failure of
the repository under analysis.
"""

import ast
import json
import os
import sys

SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__",
             ".greenrot-scratch", ".tox", ".mypy_cache", ".pytest_cache", "dist", "build"}

CALL_ONLY_METHODS = {"assert_called", "assert_called_once", "assert_called_with",
                     "assert_called_once_with", "assert_any_call", "assert_not_called"}
MOCK_FACTORIES = {"Mock", "MagicMock", "AsyncMock", "patch"}
BROAD_EXCEPTIONS = {"Exception", "BaseException"}


def _unparse(node):
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001 - unparse is 3.9+, and can fail on odd nodes
        return ""


def _relpath(path, root):
    return os.path.relpath(path, root).replace(os.sep, "/")


def _is_test_file(name):
    return (name.startswith("test_") and name.endswith(".py")) or name.endswith("_test.py")


def _iter_test_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            if _is_test_file(fn):
                yield os.path.join(dirpath, fn)


def _is_test_func(node):
    return (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name.startswith("test"))


def _skip_marked(node):
    for d in node.decorator_list:
        src = _unparse(d)
        if "skip" in src or "xfail" in src:
            return True
    return False


def cmd_discover(root, _arg=None):
    out = []
    for path in _iter_test_files(root):
        rel = _relpath(path, root)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                tree = ast.parse(fh.read(), filename=path)
        except (SyntaxError, UnicodeDecodeError) as exc:
            out.append({"error": True, "code": "parse-failure", "file": rel,
                        "line": getattr(exc, "lineno", 1) or 1, "detail": str(exc)})
            continue
        for node in ast.walk(tree):
            if _is_test_func(node):
                out.append({"id": rel + "::" + node.name, "file": rel, "line": node.lineno,
                            "name": node.name, "skipped": _skip_marked(node)})
    return out


HANDLERS = {"discover": cmd_discover}


def main():
    if len(sys.argv) < 3:
        json.dump({"error": True, "code": "frontend-crash", "file": "", "line": 1,
                   "detail": "usage: helper <command> <root> [arg]"}, sys.stdout)
        return 0
    cmd, root = sys.argv[1], sys.argv[2]
    arg = sys.argv[3] if len(sys.argv) > 3 else None
    if cmd not in HANDLERS:
        json.dump({"error": True, "code": "frontend-crash", "file": "", "line": 1,
                   "detail": "unknown command " + cmd}, sys.stdout)
        return 0
    try:
        json.dump(HANDLERS[cmd](root, arg), sys.stdout)
    except Exception as exc:  # noqa: BLE001 - a crash must become data, not a traceback
        json.dump({"error": True, "code": "frontend-crash", "file": "", "line": 1,
                   "detail": type(exc).__name__ + ": " + str(exc)}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
