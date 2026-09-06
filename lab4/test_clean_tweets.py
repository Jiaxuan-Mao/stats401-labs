"""Check the Task 7-10 methods using small, hand-calculated examples.

Run from the repository root:
    python -m unittest discover -s lab4 -p 'test_*.py'
"""

import contextlib
import io
import math
import unittest

import numpy as np
import pandas as pd
from scipy.sparse import issparse

from clean_tweets import (
    add_tfidf_features,
    build_document_term_matrix,
    prepare_for_roberta,
)


class TextAnalysisTests(unittest.TestCase):
    def test_nltk_preprocessing_preserves_task_placeholders(self):
        original = pd.DataFrame({"tweet_text_raw": [
            "I really like dogs @team! Version 2.0 https://example.com",
            "We really like dogs @other. Version 3.0 https://example.org",
            "Bad flights delayed flights.",
            "Bad flights again.",
            "Birds fly over trees.",
        ]})
        snapshot = original.copy(deep=True)
        with contextlib.redirect_stdout(io.StringIO()):
            cleaned, _, _ = add_tfidf_features(original)
        self.assertEqual(cleaned["text_clean"].tolist(), [
            "really like dog USER version NUMBER URL",
            "really like dog USER version NUMBER URL",
            "bad flight delayed flight",
            "bad flight",
            "bird fly tree",
        ])
        pd.testing.assert_frame_equal(original, snapshot)
        pd.testing.assert_series_equal(cleaned["tweet_text_raw"], original["tweet_text_raw"])

    def test_dtm_counts_and_vocabulary_pruning(self):
        texts = pd.Series([
            "common flight flight late unique",
            "common flight late",
            "common service",
            "common service",
        ])
        with contextlib.redirect_stdout(io.StringIO()):
            dtm, terms = build_document_term_matrix(texts)
        self.assertTrue(issparse(dtm))
        self.assertEqual(terms.tolist(), ["flight", "late", "service"])
        np.testing.assert_array_equal(dtm.toarray(), [
            [2, 1, 0], [1, 1, 0], [0, 0, 1], [0, 0, 1]
        ])

    def test_tfidf_matches_hand_calculated_weights(self):
        tweets = pd.DataFrame({"tweet_text_raw": [
            "common flight flight late unique",
            "common flight late",
            "common service",
            "common service",
        ]})
        with contextlib.redirect_stdout(io.StringIO()):
            _, terms, vocabulary_size = add_tfidf_features(tweets)
        terms = terms.set_index("term")
        self.assertEqual(vocabulary_size, 3)
        self.assertEqual(terms["document_frequency"].to_dict(), {
            "flight": 2, "late": 2, "service": 2
        })
        # All retained terms have the same IDF. L2 normalization therefore
        # reduces each document's weights to its normalized count vector.
        self.assertAlmostEqual(terms.loc["flight", "total_tfidf"], 2 / math.sqrt(5) + 1 / math.sqrt(2))
        self.assertAlmostEqual(terms.loc["late", "total_tfidf"], 1 / math.sqrt(5) + 1 / math.sqrt(2))
        self.assertAlmostEqual(terms.loc["service", "total_tfidf"], 2.0)

    def test_roberta_keeps_sentiment_bearing_language(self):
        text = "I do NOT like this! 😡 @airline https://example.com"
        self.assertEqual(prepare_for_roberta(text), "I do NOT like this! 😡 @user http")


if __name__ == "__main__":
    unittest.main()
