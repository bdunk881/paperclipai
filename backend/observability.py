"""
observability.py — Azure Monitor / Application Insights telemetry bootstrap.

Call configure_telemetry(app) once at FastAPI startup.  When
APPLICATIONINSIGHTS_CONNECTION_STRING is absent (local dev, unit tests) the
function is a safe no-op so no Azure credentials are needed outside Azure.

Usage in main.py:
    from observability import configure_telemetry
    app = FastAPI(...)
    configure_telemetry(app)

What gets captured automatically:
- All HTTP request traces (method, URL, status code, duration)
- Unhandled exceptions with full stack traces
- Outbound HTTP calls made with httpx
- SQLAlchemy queries (table name, duration)

Custom events can be sent anywhere in the codebase:
    from opentelemetry import trace
    tracer = trace.get_tracer(__name__)
    with tracer.start_as_current_span("workflow.execute") as span:
        span.set_attribute("workflow.id", workflow_id)
        span.set_attribute("llm.model", model_name)
        ...
"""

import logging
import os

logger = logging.getLogger(__name__)


def configure_telemetry(app=None) -> None:
    connection_string = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
    if not connection_string:
        logger.info(
            "APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry disabled"
        )
        return

    try:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(connection_string=connection_string)
        logger.info("Azure Monitor OpenTelemetry configured")
    except Exception:
        logger.exception("Failed to configure Azure Monitor telemetry")
        return

    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app)
            logger.info("FastAPI instrumentation active")
        except Exception:
            logger.exception("Failed to instrument FastAPI")

    # Instrument outbound HTTP (httpx) and SQLAlchemy if present
    for instrument_fn in (_instrument_httpx, _instrument_sqlalchemy):
        try:
            instrument_fn()
        except Exception:
            pass


def _instrument_httpx() -> None:
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    HTTPXClientInstrumentor().instrument()
    logger.info("httpx instrumentation active")


def _instrument_sqlalchemy() -> None:
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

    SQLAlchemyInstrumentor().instrument()
    logger.info("SQLAlchemy instrumentation active")
