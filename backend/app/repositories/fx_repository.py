"""Exchange-rate snapshots, one file per day in data/fx/<date>.json."""
import json
from pathlib import Path

from app.config import FX_DIR


class FxRateRepository:
    def __init__(self, fx_dir: Path = FX_DIR):
        self.fx_dir = fx_dir

    def get_rates(self, day: str | None = None) -> dict | None:
        """The snapshot for `day`, or the most recent one when no day is given."""
        files = sorted(self.fx_dir.glob("*.json"))
        if day:
            files = [f for f in files if f.stem == day]
        return json.loads(files[-1].read_text()) if files else None

    def save_rates(self, rates: dict) -> None:
        self.fx_dir.mkdir(parents=True, exist_ok=True)
        (self.fx_dir / f"{rates['date']}.json").write_text(json.dumps(rates, indent=1))
