"""Heavy mocking, but every assertion checks real production behaviour.

None of these may be flagged FAKE. If greenrot accuses one of them, the
false-positive gate blocks the release - which is the point.
"""

from unittest.mock import Mock

from service import Service, collect


def test_label_uppercases_the_name_from_the_repo():
    repo = Mock()
    repo.find.return_value = {"name": "ada"}
    svc = Service(repo)
    # The mock supplies the INPUT; the assertion checks a transformation the
    # production code performs. Real test, despite the mocking.
    assert svc.label("k") == "found:ADA"


def test_label_handles_a_missing_row():
    repo = Mock()
    repo.find.return_value = None
    assert Service(repo).label("k") == "missing"


def test_spy_list_is_filled_by_production_code():
    # THE SPY PATTERN. `seen` looks test-constructed to a static tracker, but
    # production code fills it. This exact shape produced 3 of 3 false
    # positives on the first real suite greenrot analysed.
    seen = []

    def sink(value):
        seen.append(value)

    collect([1, -2, 3], sink)
    assert seen == [1, 3]
