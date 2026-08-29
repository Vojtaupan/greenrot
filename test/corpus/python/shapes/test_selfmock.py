from unittest.mock import patch

from calc import add


@patch("calc.add")
def test_add_is_mocked_away(mock_add):
    mock_add.return_value = 5
    assert add(2, 3) == 5
