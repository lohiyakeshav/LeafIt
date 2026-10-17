"""The supplier directory (sample listings in data/vendors.json today; Places-backed later)."""
import json
from pathlib import Path

from app.config import VENDORS_FILE


class VendorRepository:
    def __init__(self, vendors_file: Path = VENDORS_FILE):
        self.vendors_file = vendors_file
        self._vendors: list[dict] | None = None

    def list_vendors(self) -> list[dict]:
        if self._vendors is None:
            self._vendors = json.loads(self.vendors_file.read_text())
        return self._vendors

    def get_vendor(self, vendor_id: str) -> dict | None:
        return next((v for v in self.list_vendors() if v["id"] == vendor_id), None)
