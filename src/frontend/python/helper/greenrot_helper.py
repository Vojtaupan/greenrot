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

# Most -> least informative. Used when an expression mixes origins: if any part
# of it came from production code, the whole expression is production-derived,
# because breaking that code could change the result.
ORIGIN_RANK = ("production-derived", "unknown", "mock-configured",
               "test-constructed", "literal")


def _unparse(node):
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001 - ast.unparse is 3.9+ and can fail on odd nodes
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


def _ordered(fn):
    """Nodes in source order. ast.walk is breadth-first, which would let an
    assertion be classified before the assignment that defines its operands."""
    nodes = [n for n in ast.walk(fn) if hasattr(n, "lineno")]
    return sorted(nodes, key=lambda n: (n.lineno, getattr(n, "col_offset", 0)))


def _call_root(func):
    while isinstance(func, ast.Attribute):
        func = func.value
    return func.id if isinstance(func, ast.Name) else ""


def _merge(kids):
    for rank in ORIGIN_RANK:
        if rank in kids:
            return rank
    return "unknown"


class _OriginTable:
    """Maps a local name to where its value came from.

    Deliberately conservative: anything untraceable is 'unknown', which can
    never justify a FAKE verdict - only a probe obligation. Constraint 5.
    """

    def __init__(self):
        self.names = {}
        self.mocks = []

    def bind_name(self, name, origin):
        self.names[name] = origin

    def classify(self, node):
        if node is None:
            return "unknown"
        if isinstance(node, ast.Constant):
            return "literal"
        if isinstance(node, (ast.Dict, ast.List, ast.Set, ast.Tuple, ast.JoinedStr)):
            kids = [self.classify(k) for k in ast.iter_child_nodes(node)
                    if isinstance(k, ast.expr)]
            if not kids:
                return "test-constructed"
            if all(k in ("literal", "test-constructed") for k in kids):
                return "test-constructed"
            return _merge(kids)
        if isinstance(node, ast.Name):
            return self.names.get(node.id, "unknown")
        if isinstance(node, ast.Attribute):
            full = _unparse(node)
            if full in self.names:
                return self.names[full]
            return self.classify(node.value)
        if isinstance(node, ast.Subscript):
            return self.classify(node.value)
        if isinstance(node, ast.Call):
            full = _unparse(node.func)
            if full in self.names:
                return self.names[full]
            root = _call_root(node.func)
            if root in MOCK_FACTORIES or full in MOCK_FACTORIES:
                return "mock-configured"
            base = self.names.get(root)
            if base == "mock-configured":
                return "mock-configured"
            if base in ("literal", "test-constructed"):
                return "test-constructed"
            # An unknown callable is assumed to reach production code. This is
            # the safe direction: it yields a probe obligation, not an accusation.
            return "production-derived"
        if isinstance(node, ast.BinOp):
            return _merge([self.classify(node.left), self.classify(node.right)])
        if isinstance(node, ast.UnaryOp):
            return self.classify(node.operand)
        if isinstance(node, ast.BoolOp):
            return _merge([self.classify(v) for v in node.values])
        if isinstance(node, ast.Compare):
            return _merge([self.classify(node.left)]
                          + [self.classify(c) for c in node.comparators])
        return "unknown"


def _assign_targets(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        return [e.id for e in target.elts if isinstance(e, ast.Name)]
    if isinstance(target, ast.Attribute):
        name = _unparse(target)
        return [name] if name else []
    return []


def _swallowing_try_lines(fn):
    """Lines inside a try whose handler would eat an AssertionError."""
    lines = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Try):
            eats = any(
                h.type is None
                or (isinstance(h.type, ast.Name) and h.type.id in BROAD_EXCEPTIONS)
                for h in node.handlers
            )
            if eats:
                for stmt in node.body:
                    for sub in ast.walk(stmt):
                        if hasattr(sub, "lineno"):
                            lines.add(sub.lineno)
    return lines


def _unreachable_lines(fn):
    """Lines after an unconditional return/raise in the same block."""
    lines = set()
    for owner in ast.walk(fn):
        body = getattr(owner, "body", None)
        if not isinstance(body, list):
            continue
        dead = False
        for stmt in body:
            if dead:
                for sub in ast.walk(stmt):
                    if hasattr(sub, "lineno"):
                        lines.add(sub.lineno)
            elif isinstance(stmt, (ast.Return, ast.Raise)):
                dead = True
    return lines


def _collect_bindings(fn, table):
    for node in _ordered(fn):
        if not isinstance(node, ast.Assign):
            continue
        value_origin = table.classify(node.value)
        for target in node.targets:
            # `m.fetch.return_value = 42` configures a mock rather than binding
            # a new local, and it is what makes an assertion echo the test.
            if isinstance(target, ast.Attribute) and target.attr == "return_value":
                base = _unparse(target.value)
                root = base.split(".")[0] if base else ""
                for mk in table.mocks:
                    if mk["target"] == root:
                        mk["configuredReturn"] = True
                if base:
                    table.bind_name(base, "mock-configured")
                continue
            for name in _assign_targets(target):
                table.bind_name(name, value_origin)
            if isinstance(node.value, ast.Call):
                root = _call_root(node.value.func)
                full = _unparse(node.value.func)
                if root in MOCK_FACTORIES or full in MOCK_FACTORIES:
                    for name in _assign_targets(target):
                        table.mocks.append({"line": node.lineno, "target": name,
                                            "configuredReturn": False})


def _collect_assertions(fn, table, swallowed, unreachable):
    assertions = []
    for node in _ordered(fn):
        if isinstance(node, ast.Assert):
            t = node.test
            if isinstance(t, ast.Compare):
                origins = ([table.classify(t.left)]
                           + [table.classify(c) for c in t.comparators])
            else:
                origins = [table.classify(t)]
            assertions.append({"line": node.lineno, "kind": "assert", "origins": origins,
                               "callOnly": False, "broadException": False,
                               "swallowed": node.lineno in swallowed,
                               "unreachable": node.lineno in unreachable})
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and node.func.attr in CALL_ONLY_METHODS:
            assertions.append({"line": node.lineno, "kind": node.func.attr,
                               "origins": ["unknown"], "callOnly": True,
                               "broadException": False,
                               "swallowed": node.lineno in swallowed,
                               "unreachable": node.lineno in unreachable})
        elif isinstance(node, ast.Call) and "raises" in _unparse(node.func).split(".")[-1:]:
            broad = any(isinstance(a, ast.Name) and a.id in BROAD_EXCEPTIONS
                        for a in node.args)
            assertions.append({"line": node.lineno, "kind": "raises",
                               "origins": ["unknown"], "callOnly": False,
                               "broadException": broad,
                               "swallowed": node.lineno in swallowed,
                               "unreachable": node.lineno in unreachable})
    return assertions


def _imported_targets(tree):
    """Module-qualified names this test file imports, e.g. {'add': 'calc.add'}."""
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                out[alias.asname or alias.name] = node.module + "." + alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                out[alias.asname or alias.name] = alias.name
    return out


def _patch_targets(fn):
    """Dotted strings passed to @patch(...) or patch(...) inside the test."""
    targets = []
    candidates = list(fn.decorator_list) + [n for n in ast.walk(fn)
                                            if isinstance(n, ast.Call)]
    for node in candidates:
        if not isinstance(node, ast.Call):
            continue
        name = _unparse(node.func)
        if not name.split(".")[-1].startswith("patch"):
            continue
        for a in node.args:
            if isinstance(a, ast.Constant) and isinstance(a.value, str):
                targets.append(a.value)
    return targets


def _model_function(fn, rel, imported=None):
    imported = imported or {}
    table = _OriginTable()
    _collect_bindings(fn, table)

    # B8: if the test patches something it also imports, the thing under test
    # has been replaced by a mock and the real code never executes.
    patched = _patch_targets(fn)
    unit = None
    imported_values = set(imported.values())
    for p in patched:
        if p in imported_values:
            unit = p
            break
    for p in patched:
        table.mocks.append({"line": fn.lineno, "target": p, "configuredReturn": True})
    assertions = _collect_assertions(fn, table, _swallowing_try_lines(fn),
                                     _unreachable_lines(fn))

    real_calls = sum(1 for n in ast.walk(fn) if isinstance(n, ast.Call))
    over_mocked = bool(table.mocks) and real_calls > 0 and len(table.mocks) * 2 >= real_calls

    return {"test": {"id": rel + "::" + fn.name, "file": rel, "line": fn.lineno,
                     "name": fn.name, "skipped": _skip_marked(fn)},
            "assertions": assertions, "mocks": table.mocks,
            "unitUnderTest": unit, "overMocked": over_mocked}


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


def cmd_model(root, _arg=None):
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
            if not _is_test_func(node):
                continue
            try:
                out.append(_model_function(node, rel, _imported_targets(tree)))
            except Exception as exc:  # noqa: BLE001
                out.append({"error": True, "code": "frontend-crash", "file": rel,
                            "line": node.lineno,
                            "detail": type(exc).__name__ + ": " + str(exc)})
    return out


HANDLERS = {"discover": cmd_discover, "model": cmd_model}


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
