from unittest.mock import Mock

import pytest


def test_no_assertion():
    x = 1 + 1


def test_tautology():
    assert 5 == 5


def test_only_test_constructed():
    data = {"a": 1}
    assert data["a"] == 1


def test_mock_echo():
    m = Mock()
    m.fetch.return_value = 42
    assert m.fetch() == 42


def test_call_only():
    m = Mock()
    m.save()
    m.save.assert_called_once()


def test_broad_exception():
    with pytest.raises(Exception):
        raise ValueError("x")


def test_swallowed():
    try:
        assert False
    except Exception:
        pass
