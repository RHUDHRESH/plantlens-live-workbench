import json
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from contract import validate_descriptor

class ContractGoldenTest(unittest.TestCase):
    def test_shared_golden_descriptor(self):
        fixture = pathlib.Path(__file__).parents[3] / "companion" / "contract" / "golden-v1.json"
        with fixture.open(encoding="utf-8") as source:
            self.assertFalse(validate_descriptor(json.load(source))["writesSupported"])

if __name__ == "__main__":
    unittest.main()
