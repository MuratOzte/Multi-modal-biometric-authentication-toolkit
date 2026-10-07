import math
import unittest

import keystroke_ml


class KeystrokeMlTests(unittest.TestCase):
    def test_derive_uu_ms_basic(self) -> None:
        hold = [190.7, 135.1, 126.6]
        dd = [108.4, 214.3]

        uu = keystroke_ml.derive_uu_ms(hold, dd)

        self.assertEqual(uu, [164.0, 222.8])

    def test_flatten_sample_vector_length(self) -> None:
        n = 40
        hold = [float(100 + i) for i in range(n)]
        dd = [float(80 + i) for i in range(n - 1)]
        ud = [float(60 + i) for i in range(n - 1)]
        sample = {
            "holdMs": hold,
            "ddMs": dd,
            "udMs": ud,
        }

        vector = keystroke_ml.flatten_sample(sample)

        self.assertEqual(len(vector), 157)

    def test_percentile_linear_interpolation(self) -> None:
        values = [10.0, 20.0, 40.0, 100.0]
        self.assertEqual(keystroke_ml.percentile(values, 0), 10.0)
        self.assertEqual(keystroke_ml.percentile(values, 100), 100.0)
        self.assertAlmostEqual(keystroke_ml.percentile(values, 50), 30.0)

    def test_mean_and_sample_std(self) -> None:
        vectors = [
            [10.0, 20.0],
            [14.0, 24.0],
            [18.0, 28.0],
        ]
        means = keystroke_ml.vector_mean(vectors)
        stds = keystroke_ml.vector_sample_std(vectors, means)

        self.assertEqual(means, [14.0, 24.0])
        self.assertAlmostEqual(stds[0], 4.0)
        self.assertAlmostEqual(stds[1], 4.0)

    def test_distance_and_scoring(self) -> None:
        vector = [12.0, 21.0, 29.0]
        mean = [10.0, 20.0, 30.0]
        std = [2.0, 2.0, 2.0]

        dist = keystroke_ml.dist_from_template(vector, mean, std)
        score = keystroke_ml.score_from_dist(dist, 18.0)

        self.assertAlmostEqual(dist, (1.0 + 0.5 + 0.5) / 3.0)
        self.assertAlmostEqual(score, max(0.0, 100.0 - (18.0 * dist)))

    def test_incremental_update_is_deterministic(self) -> None:
        template = {
            "dim": 2,
            "count": 3,
            "mean": [10.0, 20.0],
            "std": [2.0, 3.0],
            "distThreshold": 1.5,
            "scoreK": 18.0,
            "autoEnrollScore": 92.0,
            "scoreThreshold": 85.0,
        }
        vector = [12.0, 19.0]

        updated_a = keystroke_ml.update_template_incremental(template, vector, 8.0)
        updated_b = keystroke_ml.update_template_incremental(template, vector, 8.0)

        self.assertEqual(updated_a["count"], 4)
        self.assertEqual(updated_a["mean"], updated_b["mean"])
        self.assertEqual(updated_a["std"], updated_b["std"])
        self.assertTrue(all(math.isfinite(value) for value in updated_a["mean"]))
        self.assertTrue(all(math.isfinite(value) for value in updated_a["std"]))


if __name__ == "__main__":
    unittest.main()
