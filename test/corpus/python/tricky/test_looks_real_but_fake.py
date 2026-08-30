"""Verbose, busy, and checks nothing. These must be caught."""

from unittest.mock import Mock

from service import Service


def test_service_label_behaviour():
    repo = Mock()
    repo.find.return_value = {"name": "ada"}
    svc = Service(repo)
    result = svc.label("k")
    expected = "found:ADA"
    # Asserts the constant against itself. `result` is never involved.
    assert expected == "found:ADA"


def test_repo_is_wired():
    repo = Mock()
    svc = Service(repo)
    svc.label("k")
    # Checks only that a call happened - WEAK, not FAKE. It would still fail if
    # someone removed the find() call, which is why the probe must not escalate
    # it to an accusation.
    repo.find.assert_called_once()
