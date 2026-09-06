"""Clean airline tweets, build a DTM and TF-IDF, and estimate RoBERTa sentiment.

Run from the repository root:
    python -m pip install -r lab4/requirements.txt
    python lab4/clean_tweets.py

Dataset: Twitter US Airline Sentiment, collected by Crowdflower in 2015.
Source: https://www.kaggle.com/crowdflower/twitter-airline-sentiment
License: CC BY-NC-SA 4.0.

The supplied crowd sentiment labels are retained only as source metadata and are
not inputs to the RoBERTa estimates produced by this script.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import nltk
import numpy as np
import pandas as pd
import torch
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from nltk.tokenize import word_tokenize
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from transformers import pipeline


MODEL_NAME = "cardiffnlp/twitter-roberta-base-sentiment-latest"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_PATH = PROJECT_ROOT / "data" / "lab4_raw_tweets.csv"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data"
REQUIRED_COLUMNS = {
    "tweet_id",
    "airline_sentiment",
    "airline",
    "name",
    "retweet_count",
    "text",
    "tweet_created",
}
SENTIMENT_ORDER = ("Negative", "Neutral", "Positive")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--batch-size", type=int, default=32)
    return parser.parse_args()


def inspect_raw_data(df: pd.DataFrame) -> dict[str, object]:
    """Print and return the data-quality facts checked before cleaning."""
    missing = df.isna().sum().astype(int).to_dict()
    report = {
        "raw_rows": int(len(df)),
        "raw_columns": int(len(df.columns)),
        "exact_duplicate_rows": int(df.duplicated().sum()),
        "duplicate_tweet_ids": int(df.duplicated(subset=["tweet_id"]).sum()),
        "missing_by_column": missing,
        "raw_dtypes": {column: str(dtype) for column, dtype in df.dtypes.items()},
    }

    print("Raw shape:", df.shape)
    print("\nRaw data types:\n", df.dtypes)
    print("\nMissing values:\n", df.isna().sum())
    print("\nExact duplicate rows:", report["exact_duplicate_rows"])
    print("Duplicate tweet IDs:", report["duplicate_tweet_ids"])
    return report


def ensure_nltk_resources() -> None:
    """Make the resources listed in Lab 4 Task 7 available without re-downloading."""
    resources = {
        "punkt": "tokenizers/punkt",
        "punkt_tab": "tokenizers/punkt_tab",
        "stopwords": "corpora/stopwords",
        "wordnet": "corpora/wordnet",
        "omw-1.4": "corpora/omw-1.4",
    }
    for package, resource in resources.items():
        try:
            nltk.data.find(resource)
        except LookupError:
            try:
                nltk.data.find(resource + ".zip")
            except LookupError:
                if not nltk.download(package, quiet=True):
                    raise RuntimeError(f"NLTK could not download {package}.")


def normalize_for_tfidf(text: str) -> str:
    text = text.lower()
    text = re.sub(r"https?://\S+|www\.\S+", " URL ", text)
    text = re.sub(r"@\w+", " USER ", text)
    text = re.sub(r"\b\d+(?:\.\d+)?\b", " NUMBER ", text)
    return re.sub(r"\s+", " ", text).strip()


def prepare_for_roberta(text: str) -> str:
    text = re.sub(r"@\w+", "@user", str(text))
    text = re.sub(r"https?://\S+|www\.\S+", "http", text)
    return text.strip()


def clean_structured_fields(raw_df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    missing_columns = REQUIRED_COLUMNS.difference(raw_df.columns)
    if missing_columns:
        raise ValueError(
            "Raw CSV is missing required columns: " + ", ".join(sorted(missing_columns))
        )

    df = raw_df.copy()
    start_rows = len(df)

    for column in ("tweet_id", "airline", "name", "text", "tweet_created"):
        df[column] = df[column].astype("string").str.strip()

    df = df.dropna(subset=["tweet_id", "airline", "text", "tweet_created"])
    df = df[df["text"].ne("")]
    missing_critical_removed = start_rows - len(df)

    before_exact = len(df)
    df = df.drop_duplicates()
    exact_duplicates_removed = before_exact - len(df)

    before_ids = len(df)
    df = df.drop_duplicates(subset=["tweet_id"], keep="first")
    duplicate_ids_removed = before_ids - len(df)

    df["retweets"] = pd.to_numeric(
        df["retweet_count"].astype("string").str.replace(",", "", regex=False),
        errors="coerce",
    )
    invalid_retweets = int((df["retweets"].isna() | df["retweets"].lt(0)).sum())
    df.loc[df["retweets"].lt(0), "retweets"] = pd.NA
    df["retweets"] = df["retweets"].fillna(0).astype("int64")

    df["created_at"] = pd.to_datetime(
        df["tweet_created"], errors="coerce", format="mixed", utc=True
    )
    invalid_dates = int(df["created_at"].isna().sum())
    df = df.dropna(subset=["created_at"])

    df["username"] = (
        df["name"].astype("string").str.strip().str.replace(r"^@", "", regex=True)
    )
    df["airline"] = df["airline"].astype("string").str.replace(r"\s+", " ", regex=True)
    df["tweet_text_raw"] = (
        df["text"].astype("string").str.replace(r"\s+", " ", regex=True).str.strip()
    )
    df["source_sentiment"] = (
        df["airline_sentiment"].astype("string").str.strip().str.capitalize()
    )
    df["date"] = df["created_at"].dt.strftime("%Y-%m-%d")
    df["weekday"] = df["created_at"].dt.day_name()
    df["hour"] = df["created_at"].dt.hour.astype("int64")
    df["character_count"] = df["tweet_text_raw"].str.len().astype("int64")
    df["word_count"] = df["tweet_text_raw"].str.split().str.len().astype("int64")

    decisions = {
        "missing_critical_rows_removed": int(missing_critical_removed),
        "exact_duplicates_removed": int(exact_duplicates_removed),
        "duplicate_ids_removed_after_exact_deduplication": int(duplicate_ids_removed),
        "duplicate_ids_removed": int(exact_duplicates_removed + duplicate_ids_removed),
        "invalid_retweet_values_filled_with_zero": invalid_retweets,
        "invalid_date_rows_removed": invalid_dates,
    }
    return df, decisions


def build_document_term_matrix(texts: pd.Series) -> tuple:
    """Tasks 8-9: prune the vocabulary and inspect a sparse word-count DTM."""
    vectorizer = CountVectorizer(min_df=2, max_df=0.90, lowercase=True)
    dtm = vectorizer.fit_transform(texts)
    terms = vectorizer.get_feature_names_out()

    print("\nDTM shape:", dtm.shape)
    print("DTM vocabulary size:", len(terms))
    # Keep the full matrix sparse; only convert a small inspection sample.
    print("DTM preview (first 5 tweets, first 10 terms):\n", pd.DataFrame(
        dtm[:5, :10].toarray(), index=texts.index[:5], columns=terms[:10]
    ))
    return dtm, terms


def add_tfidf_features(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Tasks 7-10: NLTK preprocessing, a frequency DTM, then TF-IDF."""
    ensure_nltk_resources()
    lemmatizer = WordNetLemmatizer()
    stop_words = set(stopwords.words("english"))

    df = df.copy()
    df["text_normalized"] = df["tweet_text_raw"].apply(normalize_for_tfidf)
    df["tokens"] = df["text_normalized"].apply(word_tokenize)
    df["tokens_no_stop"] = df["tokens"].apply(
        lambda tokens: [token for token in tokens if token not in stop_words]
    )
    df["tokens_clean"] = df["tokens_no_stop"].apply(
        lambda tokens: [lemmatizer.lemmatize(token) for token in tokens if token.isalpha()]
    )
    df["text_clean"] = df["tokens_clean"].apply(" ".join)
    print("\nText preprocessing preview:\n", df[["tweet_text_raw", "text_clean"]].head())

    dtm, dtm_terms = build_document_term_matrix(df["text_clean"])

    vectorizer = TfidfVectorizer(min_df=2, max_df=0.90)
    matrix = vectorizer.fit_transform(df["text_clean"])
    terms = vectorizer.get_feature_names_out()
    if dtm.shape != matrix.shape or not np.array_equal(dtm_terms, terms):
        raise ValueError("DTM and TF-IDF vocabularies do not match.")
    print("\nTF-IDF shape:", matrix.shape)
    print("TF-IDF preview (first 5 tweets, first 10 terms):\n", pd.DataFrame(
        matrix[:5, :10].toarray(), index=df.index[:5], columns=terms[:10]
    ))
    document_frequency = np.asarray((matrix > 0).sum(axis=0)).ravel()
    total_weight = np.asarray(matrix.sum(axis=0)).ravel()

    terms_df = pd.DataFrame(
        {
            "term": terms,
            "document_frequency": document_frequency.astype(int),
            "total_tfidf": total_weight,
        }
    ).sort_values(["total_tfidf", "term"], ascending=[False, True])

    return df, terms_df.head(50).reset_index(drop=True), int(len(terms))


def add_roberta_sentiment(df: pd.DataFrame, batch_size: int) -> pd.DataFrame:
    if batch_size < 1:
        raise ValueError("batch-size must be at least 1")

    df = df.copy()
    df["sentiment_text"] = df["tweet_text_raw"].apply(prepare_for_roberta)
    device = torch.device("mps") if torch.backends.mps.is_available() else torch.device("cpu")
    print(f"\nRunning RoBERTa inference on {device}.")
    classifier = pipeline(
        "sentiment-analysis",
        model=MODEL_NAME,
        tokenizer=MODEL_NAME,
        top_k=None,
        device=device,
    )
    results = classifier(
        df["sentiment_text"].tolist(),
        truncation=True,
        batch_size=batch_size,
    )

    label_aliases = {
        "label_0": "negative",
        "label_1": "neutral",
        "label_2": "positive",
    }

    def scores_to_dict(scores: list[dict[str, object]]) -> dict[str, float]:
        converted: dict[str, float] = {}
        for item in scores:
            label = str(item["label"]).lower()
            label = label_aliases.get(label, label)
            converted[label] = float(item["score"])
        return converted

    score_dicts = [scores_to_dict(scores) for scores in results]
    for label in ("negative", "neutral", "positive"):
        df[f"sentiment_{label}"] = [scores.get(label, 0.0) for scores in score_dicts]

    probabilities = df[
        ["sentiment_negative", "sentiment_neutral", "sentiment_positive"]
    ].to_numpy()
    if not np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-4):
        raise ValueError("RoBERTa class probabilities do not sum to one.")

    labels = np.asarray(SENTIMENT_ORDER)
    df["sentiment"] = labels[probabilities.argmax(axis=1)]
    df["sentiment_score"] = df["sentiment_positive"] - df["sentiment_negative"]
    return df


def build_airline_summary(df: pd.DataFrame) -> pd.DataFrame:
    counts = (
        df.groupby(["airline", "sentiment"], observed=True)
        .size()
        .unstack(fill_value=0)
        .reindex(columns=SENTIMENT_ORDER, fill_value=0)
    )
    counts.columns = [f"{column.lower()}_count" for column in counts.columns]
    counts["total"] = counts.sum(axis=1)

    for label in ("negative", "neutral", "positive"):
        counts[f"{label}_pct"] = 100 * counts[f"{label}_count"] / counts["total"]

    counts["average_score"] = df.groupby("airline")["sentiment_score"].mean()
    return (
        counts.reset_index()
        .sort_values("negative_pct", ascending=False)
        .reset_index(drop=True)
    )


def main() -> None:
    args = parse_args()
    if not args.raw.is_file():
        raise FileNotFoundError(f"Raw tweet CSV not found: {args.raw}")

    raw_df = pd.read_csv(args.raw, dtype={"tweet_id": "string"})
    raw_report = inspect_raw_data(raw_df)
    cleaned_df, cleaning_decisions = clean_structured_fields(raw_df)
    cleaned_df, tfidf_terms, vocabulary_size = add_tfidf_features(cleaned_df)
    cleaned_df = add_roberta_sentiment(cleaned_df, args.batch_size)

    output_columns = [
        "tweet_id",
        "created_at",
        "date",
        "hour",
        "weekday",
        "username",
        "airline",
        "tweet_text_raw",
        "text_clean",
        "retweets",
        "character_count",
        "word_count",
        "sentiment_negative",
        "sentiment_neutral",
        "sentiment_positive",
        "sentiment_score",
        "sentiment",
    ]
    output_df = cleaned_df[output_columns].sort_values(["created_at", "tweet_id"])
    airline_summary = build_airline_summary(output_df)

    if len(output_df) < 1_000:
        raise ValueError("Fewer than 1,000 valid tweets remain after cleaning.")
    if output_df["tweet_id"].duplicated().any():
        raise ValueError("Clean output still contains duplicate tweet IDs.")
    if output_df[output_columns].isna().any().any():
        raise ValueError("Clean output contains unexpected missing values.")
    if not output_df["sentiment_score"].between(-1, 1).all():
        raise ValueError("Sentiment score is outside the expected [-1, 1] range.")

    report = {
        **raw_report,
        **cleaning_decisions,
        "clean_rows": int(len(output_df)),
        "airlines": int(output_df["airline"].nunique()),
        "date_min": output_df["date"].min(),
        "date_max": output_df["date"].max(),
        "tfidf_vocabulary_size": vocabulary_size,
        "dtm_shape": [int(len(output_df)), vocabulary_size],
        "text_tokenizer": "nltk.word_tokenize",
        "stopword_source": "nltk.corpus.stopwords.words('english')",
        "vocabulary_min_df": 2,
        "vocabulary_max_df": 0.90,
        "sentiment_model": MODEL_NAME,
        "sentiment_counts": {
            label: int((output_df["sentiment"] == label).sum())
            for label in SENTIMENT_ORDER
        },
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_df.to_csv(args.output_dir / "lab4_clean_tweets.csv", index=False)
    airline_summary.to_csv(
        args.output_dir / "lab4_sentiment_by_airline.csv", index=False
    )
    tfidf_terms.to_csv(args.output_dir / "lab4_tfidf_terms.csv", index=False)
    (args.output_dir / "lab4_cleaning_report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print("\nClean rows:", len(output_df))
    print("TF-IDF vocabulary size:", vocabulary_size)
    print("\nSentiment counts:\n", output_df["sentiment"].value_counts())
    print("\nAirline summary:\n", airline_summary.to_string(index=False))


if __name__ == "__main__":
    main()
