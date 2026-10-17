"""Saved plans in data/plans: a cache that expires (config.PLAN_TTL_DAYS)."""
import json
import time
import uuid
from pathlib import Path

from app import config
from app.config import PLANS_DIR
from app.repositories.files import delete_older_than


class PlanRepository:
    def __init__(self, plans_dir: Path = PLANS_DIR):
        self.plans_dir = plans_dir
        self._last_purge = 0.0

    def save_plan(self, plan: dict) -> str:
        self.plans_dir.mkdir(parents=True, exist_ok=True)
        pid = uuid.uuid4().hex[:8]
        (self.plans_dir / f"{pid}.json").write_text(json.dumps({**plan, "id": pid, "created": int(time.time())}))
        if time.time() - self._last_purge > 3600:   # at most hourly
            self.purge_expired()
        return pid

    def get_plan(self, pid: str) -> dict | None:
        p = self.plans_dir / f"{pid}.json"
        return json.loads(p.read_text()) if pid.isalnum() and p.exists() else None

    def purge_expired(self, now: float | None = None) -> int:
        """Delete saved plans older than their TTL. Returns how many."""
        removed = delete_older_than(self.plans_dir, config.PLAN_TTL_DAYS, now)
        self._last_purge = time.time()
        return len(removed)
