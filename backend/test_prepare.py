import csv
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from dataset import load
from prepare import prepare


class PrepareTests(unittest.TestCase):
    def test_filters_low_coverage_and_records_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            with (source/"geolens_terra_standard_2003.csv").open("w",newline="") as file:
                writer = csv.writer(file)
                writer.writerow(["source","cell","quality","month","valid_area","land_area","weighted"])
                writer.writerow(["terra","PK714","standard","2003-01",60,100,18])
                writer.writerow(["terra","PK714","standard","2003-02",20,100,6])
            output = root/"data"/"observations.csv"
            prepare(source,output)
            with output.open(newline="") as file:
                rows = list(csv.DictReader(file))
            self.assertEqual(len(rows),1)
            self.assertEqual(float(rows[0]["ndvi"]),.3)
            manifest = json.loads(output.with_suffix(".json").read_text())
            self.assertEqual((manifest["accepted"],manifest["observed"]),(1,2))
            self.assertEqual(len(manifest["version"]),64)
            with patch.dict("os.environ", {"OBSERVATIONS_CSV": str(output)}):
                _, loaded = load()
                self.assertEqual(loaded["mode"], "source extract")
                output.write_bytes(output.read_bytes() + b"\n")
                with self.assertRaisesRegex(ValueError, "does not match"):
                    load()

    def test_unconfigured_observations_are_unavailable(self):
        with patch.dict("os.environ", {"OBSERVATIONS_CSV": ""}):
            data, manifest = load()
        self.assertEqual(data, {})
        self.assertEqual(manifest["mode"], "unavailable")
