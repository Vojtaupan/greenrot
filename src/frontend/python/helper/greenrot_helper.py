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


def _iter_test_files(root, excludes=()):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            if not _is_test_file(fn):
                continue
            path = os.path.join(dirpath, fn)
            rel = _relpath(path, root)
            if any(rel == e or rel.startswith(e.rstrip("/") + "/") for e in excludes):
                continue
            yield path


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
    """What this test file imports, split by FORM, because the form decides
    whether a later patch of the same name can take effect.

    `__from__` : {local_name: 'module.attr'} from `from module import attr`.
                 These bind the object itself at import time, so patching
                 'module.attr' afterwards does NOT affect calls made through
                 the local name.
    `__mod__`  : {local_name: 'module'} from `import module`. Calls written as
                 `module.attr(...)` DO see a later patch.
    """
    out = {"__from__": {}, "__mod__": {}}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                out["__from__"][alias.asname or alias.name] = node.module + "." + alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                out["__mod__"][alias.asname or alias.name] = alias.name
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

    # B8: the unit under test is itself replaced by a mock.
    #
    # The subtle part, and it was backwards in the first version: a patch is
    # only effective if the call site actually goes through the patched
    # attribute. When the test does
    #
    #     from calc import add        # binds the ORIGINAL function object now
    #     @patch("calc.add")          # replaces the attribute on the module
    #     ... add(2, 3)               # ...which this call never consults
    #
    # the patch is a no-op and the real code runs. Flagging that as
    # "unit under test is mocked" is simply wrong. So B8 stands down whenever a
    # from-import shadows the patch target - the conservative direction, which
    # costs us some true positives and buys us no false accusations.
    patched = _patch_targets(fn)
    unit = None
    shadowed_by_from_import = set(imported.get("__from__", {}).values())
    for p in patched:
        if p in shadowed_by_from_import:
            continue
        unit = p
        break
    seen_patches = set()
    for p in patched:
        if p in seen_patches:
            continue  # decorator_list and ast.walk both yield the decorator call
        seen_patches.add(p)
        table.mocks.append({"line": fn.lineno, "target": p, "configuredReturn": True})
    assertions = _collect_assertions(fn, table, _swallowing_try_lines(fn),
                                     _unreachable_lines(fn))


    # Does this test call production code at all? Needed by check A3, whose
    # claim is literally "production code never reached".
    #
    # Found by dogfooding on a real 449-test suite, where A3 produced three
    # false positives, all the SPY pattern: a list created empty in the test,
    # handed to production code through a callback, filled by it, then
    # asserted on. The origin tracker sees `calls = []` and says
    # test-constructed; it does not model mutation through a closure. Rather
    # than try to track aliasing - which is where static analysis goes to die -
    # A3 simply declines to fire whenever production code ran at all.
    production_calls = sum(
        1 for n in ast.walk(fn)
        if isinstance(n, ast.Call) and table.classify(n) == "production-derived"
    )

    # B9 over-mocking means what it says: mocks exist and NO real code runs.
    # The previous ratio heuristic (mocks * 2 >= total calls) flagged any small
    # test with one mock and one genuine call, and counted the @patch decorator
    # itself as a call.
    over_mocked = bool(table.mocks) and production_calls == 0

    return {"test": {"id": rel + "::" + fn.name, "file": rel, "line": fn.lineno,
                     "name": fn.name, "skipped": _skip_marked(fn)},
            "assertions": assertions, "mocks": table.mocks,
            "unitUnderTest": unit, "overMocked": over_mocked,
            "productionCalls": production_calls}


def _parse_excludes(arg):
    """Comma-separated repo-relative path prefixes to skip."""
    if not arg:
        return ()
    return tuple(x.strip().replace(os.sep, "/") for x in arg.split(",") if x.strip())


def cmd_discover(root, arg=None):
    out = []
    for path in _iter_test_files(root, _parse_excludes(arg)):
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


def cmd_model(root, arg=None):
    out = []
    for path in _iter_test_files(root, _parse_excludes(arg)):
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


_TRACE_TOOL_ID = 2  # sys.monitoring "profiler" slot


def _trace_with_monitoring(run_callable):
    mon = sys.monitoring
    seen = {}
    mon.use_tool_id(_TRACE_TOOL_ID, "greenrot")

    def on_line(code, line_number):
        seen.setdefault(code.co_filename, set()).add(line_number)
        return None

    mon.register_callback(_TRACE_TOOL_ID, mon.events.LINE, on_line)
    mon.set_events(_TRACE_TOOL_ID, mon.events.LINE)
    try:
        run_callable()
    finally:
        mon.set_events(_TRACE_TOOL_ID, 0)
        mon.free_tool_id(_TRACE_TOOL_ID)
    return seen


def _trace_with_settrace(run_callable):
    seen = {}

    def tracer(frame, event, _arg):
        if event == "line":
            seen.setdefault(frame.f_code.co_filename, set()).add(frame.f_lineno)
        return tracer

    sys.settrace(tracer)
    try:
        run_callable()
    finally:
        sys.settrace(None)
    return seen


def _run_one_test(root, test_id, extra_args=()):
    import pytest

    rel_file, _, name = test_id.partition("::")
    target = os.path.join(root, rel_file) + ("::" + name if name else "")
    args = ["-q", "-p", "no:cacheprovider", "--no-header", "-x", target]
    args.extend(extra_args)
    return int(pytest.main(args))


def _production_lines(seen, root):
    """Keep only lines in files under `root` that are not themselves tests.

    Everything else - stdlib, site-packages, pytest's own frames, the test file
    - is not a legitimate mutation target.
    """
    by_file = {}
    root_norm = os.path.normcase(os.path.abspath(root))
    for fn, lines in seen.items():
        try:
            abs_fn = os.path.normcase(os.path.abspath(fn))
        except (OSError, ValueError):
            continue
        if not abs_fn.startswith(root_norm):
            continue
        rel = _relpath(fn, root)
        base = os.path.basename(fn)
        if _is_test_file(base) or "site-packages" in rel or rel.startswith(".."):
            continue
        if any(seg in SKIP_DIRS for seg in rel.split("/")):
            continue
        by_file[rel] = sorted(lines)
    return by_file


def cmd_trace(root, test_id):
    """Run ONE test under a line tracer and report the production lines it hit.

    sys.monitoring only exists on 3.12+. Python 3.9-3.11 are still widespread,
    so the settrace fallback is not optional - without it a large share of real
    repositories would silently land in UNKNOWN.
    """
    try:
        import pytest  # noqa: F401
    except ImportError:
        return {"error": True, "code": "runner-missing", "file": "", "line": 1,
                "detail": "pytest is not importable by this interpreter"}

    rel_file = test_id.partition("::")[0]
    tracer = _trace_with_monitoring if hasattr(sys, "monitoring") else _trace_with_settrace

    try:
        seen = tracer(lambda: _run_one_test(root, test_id))
    except Exception as exc:  # noqa: BLE001
        return {"error": True, "code": "frontend-crash", "file": rel_file, "line": 1,
                "detail": type(exc).__name__ + ": " + str(exc)}

    return {"byFile": _production_lines(seen, root)}


def cmd_runtest(root, test_id):
    try:
        import pytest  # noqa: F401
    except ImportError:
        return {"outcome": "error", "detail": "pytest is not importable"}
    try:
        code = _run_one_test(root, test_id)
    except Exception as exc:  # noqa: BLE001
        return {"outcome": "error", "detail": type(exc).__name__ + ": " + str(exc)}
    # pytest exit codes: 0 all passed, 1 tests failed, others are usage/collection
    # errors. Anything that is not a clean pass or a clean failure is 'error',
    # which becomes UNKNOWN rather than being misread as a surviving mutant.
    if code == 0:
        return {"outcome": "pass", "code": code}
    if code == 1:
        return {"outcome": "fail", "code": code}
    return {"outcome": "error", "code": code, "detail": "pytest exit " + str(code)}


_MUTATIONS = (
    ("arith", ((" + ", " - "), (" - ", " + "), (" * ", " / "), (" // ", " * "))),
    ("compare", ((" == ", " != "), (" != ", " == "), (" <= ", " > "), (" >= ", " < "),
                 (" < ", " >= "), (" > ", " <= "))),
    ("bool", ((" and ", " or "), (" or ", " and "), (" not ", " "))),
    ("const", (("True", "False"), ("False", "True"), ("None", "0"))),
)


def cmd_mutants(root, spec_json):
    """Generate mutants confined to the given lines.

    Text-level and line-scoped on purpose: the probe only ever needs to perturb
    lines a specific test executed, and a full AST rewrite would be far more
    machinery for no additional proving power.
    """
    try:
        spec = json.loads(spec_json or "{}")
    except ValueError as exc:
        return {"error": True, "code": "frontend-crash", "file": "", "line": 1,
                "detail": "bad mutant spec: " + str(exc)}

    out = []
    for rel, lines in spec.items():
        path = os.path.join(root, rel)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                src = fh.read().splitlines()
        except OSError:
            continue
        wanted = set(lines)
        for idx, text in enumerate(src, start=1):
            if idx not in wanted:
                continue
            stripped = text.strip()
            if not stripped or stripped.startswith("#"):
                continue
            # A bare `def`/`class` header executes at import time and shows up
            # as covered, but perturbing it tests nothing about behaviour.
            if stripped.startswith(("def ", "class ", "@", "import ", "from ")):
                continue
            for operator, pairs in _MUTATIONS:
                for find, repl in pairs:
                    if find in text:
                        out.append({
                            "id": "{}:{}:{}:{}".format(rel, idx, operator, find.strip()),
                            "file": rel, "line": idx, "original": text,
                            "mutated": text.replace(find, repl, 1), "operator": operator,
                        })
                        break  # one mutant per operator family per line
    return out


HANDLERS = {"discover": cmd_discover, "model": cmd_model,
            "trace": cmd_trace, "runtest": cmd_runtest, "mutants": cmd_mutants}


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
    # stdout is a JSON-only channel. pytest writes its report there, and its
    # capture plugin works at the file-descriptor level, so redirecting
    # sys.stdout is not enough - fd 1 itself has to point elsewhere while a
    # handler runs. Without this the Node side receives "1 passed in 0.06s"
    # followed by JSON and fails to parse the whole run.
    sys.stdout.flush()
    saved_fd = os.dup(1)
    os.dup2(2, 1)
    try:
        result = HANDLERS[cmd](root, arg)
    except Exception as exc:  # noqa: BLE001 - a crash must become data, not a traceback
        result = {"error": True, "code": "frontend-crash", "file": "", "line": 1,
                  "detail": type(exc).__name__ + ": " + str(exc)}
    finally:
        sys.stdout.flush()  # flush the handler's noise into the redirected fd
        os.dup2(saved_fd, 1)
        os.close(saved_fd)

    json.dump(result, sys.stdout)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
