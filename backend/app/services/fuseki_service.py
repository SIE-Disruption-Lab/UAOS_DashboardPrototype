"""
Fuseki service: query the running Fuseki endpoint for SPARQL results.
"""
import requests
import json
from pathlib import Path


FUSEKI_BASE = "http://localhost:3030"


def is_fuseki_running(dataset_name: str) -> bool:
    """Check if a Fuseki dataset endpoint is alive."""
    try:
        r = requests.get(f"{FUSEKI_BASE}/{dataset_name}", timeout=3)
        return r.status_code < 500
    except requests.exceptions.ConnectionError:
        return False


def sparql_query(dataset_name: str, query: str, timeout: int = 30) -> dict:
    """
    Execute a SPARQL SELECT query against the named dataset.
    Returns the raw SPARQL JSON result dict.
    Raises requests.HTTPError on failure.
    `timeout` is both the HTTP client timeout and the Fuseki server-side query timeout (seconds).
    """
    url = f"{FUSEKI_BASE}/{dataset_name}/sparql"
    r = requests.post(
        url,
        data={"query": query, "timeout": timeout * 1000},  # Fuseki wants milliseconds
        headers={"Accept": "application/sparql-results+json"},
        timeout=timeout + 2,  # HTTP client timeout slightly longer than server timeout
    )
    r.raise_for_status()
    return r.json()


def load_result_file(results_dir: str, query_name: str) -> dict | None:
    """Load a pre-generated query result JSON file from build/results/."""
    p = Path(results_dir) / f"{query_name}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding='utf-8'))


def count_result_rows(result: dict) -> int:
    """Return the number of result rows from a SPARQL JSON result."""
    try:
        return len(result["results"]["bindings"])
    except (KeyError, TypeError):
        return 0
