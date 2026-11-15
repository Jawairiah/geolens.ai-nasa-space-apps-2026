import math
import unittest
from analysis import compare, estimate, scan
from dataset import CELLS


def sample_observations():
    data = {}
    for i, cell in enumerate(CELLS):
        for source in ("terra", "aqua"):
            for quality in ("standard", "strict"):
                data[source,cell,quality] = {
                    t: .21 + .009*(i%7) + .034*math.sin(t*math.pi/6+i*.2)
                    + (.04*math.sin(i*.73) + (.012*math.cos(i) if source=="aqua" else 0))*t/120
                    + .016*math.sin(t*1.2+i+(source=="aqua"))
                    for t in range(264) if quality=="standard" or (t*7+i*13)%23>=4
                }
    return data


class AnalysisTests(unittest.TestCase):
    def test_linear_seasonal_with_gaps(self):
        records = {i:.3 + i*.0004 + .03*math.sin(i*math.pi/6) for i in range(264) if i%7}
        self.assertAlmostEqual(estimate(records,264)["slope"],.048)

    def test_short_window(self):
        self.assertIsNone(estimate({i:i for i in range(24)},24)["slope"])

    def test_paired_difference_and_direction(self):
        data = sample_observations()
        first = compare(data,["PK714","PK712"],"terra","strict",0,264)
        second = compare(data,["PK712","PK714"],"terra","strict",0,264)
        self.assertAlmostEqual(first["delta"]["slope"],-second["delta"]["slope"])
        self.assertAlmostEqual(first["delta"]["slope"],first["left"]["slope"]-first["right"]["slope"])

    def test_scan(self):
        data = sample_observations()
        result = scan(data,CELLS,"standard",0,264)
        self.assertTrue(result["exploratory"])
        self.assertTrue(result["candidates"])
        self.assertEqual(set(result["trends"]),set(CELLS))
