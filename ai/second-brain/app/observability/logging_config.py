"""Structured JSON logging with request-id correlation.

Every log line carries the request id of the in-flight HTTP request (a
``contextvar``, so it works under async without threading gymnastics). When
``LOG_JSON`` is on, records serialise to one JSON object per line — ready for
Loki / CloudWatch / ELK ingestion; otherwise a human-readable text format is
used for local dev.
"""

from __future__ import annotations

import json
import logging
import uuid
from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def set_request_id(rid: str) -> None:
    _request_id.set(rid or "-")


def get_request_id() -> str:
    return _request_id.get()


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


_RESERVED = set(
    logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
) | {"request_id", "message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Fold any structured `extra=` fields in.
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                try:
                    json.dumps(value)
                    payload[key] = value
                except (TypeError, ValueError):
                    payload[key] = repr(value)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(settings) -> None:
    """Install the request-id filter + JSON/text formatter on the root logger."""
    level = getattr(logging, str(getattr(settings, "log_level", "INFO")).upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    if getattr(settings, "log_json", True):
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s [%(request_id)s]: %(message)s"
            )
        )

    # Replace existing handlers so we don't double-log under uvicorn/pytest.
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
