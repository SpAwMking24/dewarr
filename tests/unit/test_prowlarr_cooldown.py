from app.domain.prowlarr_network import COOLDOWN_MAX, cooldown_seconds


def test_cooldown_escalates_and_caps():
    assert [cooldown_seconds(n) for n in (1, 2, 3, 4)] == [60, 120, 240, 480]
    assert cooldown_seconds(10) == COOLDOWN_MAX
