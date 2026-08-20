"""Standalone Flask workload service for the Autoscaling Lab."""

import logging
import math
import os
import socket
import time
import uuid
from typing import Any

from flask import Flask, jsonify, request


DEFAULT_WORK_DURATION = 1.0
DEFAULT_MAX_WORK_DURATION = 60.0

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("autoscaling-lab")

app = Flask(__name__)


def max_work_duration() -> float:
    """Return the configured maximum, falling back to the safe default."""
    raw_value = os.getenv("MAX_WORK_DURATION", str(DEFAULT_MAX_WORK_DURATION))
    try:
        value = float(raw_value)
    except ValueError:
        return DEFAULT_MAX_WORK_DURATION
    return value if value > 0 else DEFAULT_MAX_WORK_DURATION


def parse_duration() -> tuple[float | None, tuple[Any, int] | None]:
    raw_value = request.args.get("duration", str(DEFAULT_WORK_DURATION))
    try:
        duration = float(raw_value)
    except (TypeError, ValueError):
        return None, ({"error": "duration must be a number"}, 400)

    if not math.isfinite(duration):
        return None, ({"error": "duration must be a finite number"}, 400)
    if duration < 0:
        return None, ({"error": "duration cannot be negative"}, 400)
    if duration > max_work_duration():
        return None, (
            {"error": f"duration cannot exceed {max_work_duration():g} seconds"},
            400,
        )
    return duration, None


def run_cpu_workload(duration: float) -> tuple[float, int]:
    """Perform deterministic CPU work in the request process for a fixed duration."""
    started_at = time.perf_counter()
    iterations = 0
    accumulator = 0.0

    while time.perf_counter() - started_at < duration:
        value = (iterations % 997) + 1
        accumulator += math.sqrt(value) * math.sin(value) * value
        accumulator += accumulator * 0.000001
        iterations += 1

    # Keep the calculation observable to Python without affecting the response.
    if accumulator == float("inf"):
        logger.debug("workload accumulator overflowed")
    return time.perf_counter() - started_at, iterations


def workload_response(endpoint: str, include_request_details: bool) -> tuple[Any, int]:
    duration, error = parse_duration()
    if error:
        return error

    request_id = str(uuid.uuid4())
    actual_duration, iterations = run_cpu_workload(duration or 0.0)
    hostname = socket.gethostname()
    logger.info(
        "workload timestamp=%s endpoint=%s request_id=%s hostname=%s "
        "requested_duration=%s actual_duration=%.6f iterations=%s",
        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        endpoint,
        request_id,
        hostname,
        duration,
        actual_duration,
        iterations,
    )

    response: dict[str, Any] = {
        "status": "completed",
        "requested_duration": duration,
        "actual_duration": round(actual_duration, 6),
        "iterations": iterations,
    }
    if include_request_details:
        response.update({"hostname": hostname, "request_id": request_id})
    return jsonify(response), 200


@app.get("/")
def root() -> Any:
    return jsonify({"service": "kubernetes-autoscaling-demo", "status": "healthy"})


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "healthy"})


@app.get("/info")
def info() -> Any:
    return jsonify(
        {
            "service": "kubernetes-autoscaling-demo",
            "hostname": socket.gethostname(),
            "python_version": ".".join(map(str, os.sys.version_info[:3])),
            "max_work_duration": max_work_duration(),
        }
    )


@app.get("/cpu")
def cpu() -> Any:
    return workload_response("/cpu", include_request_details=False)


@app.get("/work")
def work() -> Any:
    return workload_response("/work", include_request_details=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))