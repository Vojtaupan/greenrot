from calc import add, is_even


def test_add_returns_sum():
    assert add(2, 3) == 5


def test_is_even():
    assert is_even(4) is True
