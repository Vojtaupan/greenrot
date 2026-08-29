"""A test that LOOKS like it mocks the unit under test, but does not.

`from calc import add` binds the original function object into this module's
namespace at import time. `@patch("calc.add")` then replaces the attribute on
the `calc` module - which this module no longer consults. So the real `add`
runs, and the test genuinely checks it.

Ground truth is therefore REAL, and greenrot must reach that: B8 flags it
structurally, and the probe exonerates it by detecting a mutation. Labelled
REAL on purpose - this fixture exists to keep a plausible-looking heuristic
from hardening into a false accusation.
"""

from unittest.mock import patch

from calc import add


@patch("calc.add")
def test_add_is_mocked_away(mock_add):
    mock_add.return_value = 5
    assert add(2, 3) == 5
