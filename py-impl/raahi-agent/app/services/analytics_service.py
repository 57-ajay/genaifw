"""
Analytics service for logging intent data via HTTP POST to BigQuery sync endpoint.

This service replaces Firebase Firestore logging for raahiIntents with direct HTTP POST
to the BigQuery sync endpoint. Analytics failures never break the API.
"""

from datetime import datetime, timezone
import asyncio
import logging
import aiohttp
from typing import List, Optional


INTENT_API_URL = "https://bigquerysync-event-t5xpmeezuq-uc.a.run.app/partnerRaahi"

logger = logging.getLogger(__name__)


async def log_intents(
    driver_id: str,
    query_text: str,
    intent: str,
    session_id: str,
    interaction_count: int,
    pickup_city: Optional[str] = None,
    drop_city: Optional[str] = None,
    timeout_seconds: float = 10.0,
) -> bool:
    """
    Log intent data to BigQuery via HTTP POST.

    This function posts driver intent data to the BigQuery sync endpoint.
    Failures are logged but never raise exceptions to prevent breaking the API.

    Args:
        driver_id: Driver identifier
        query_text: User's query text
        intent: Classified intent type
        session_id: Session identifier
        interaction_count: Number of interactions in this session
        pickup_city: Optional pickup city for GET_DUTIES intent
        drop_city: Optional drop city for GET_DUTIES intent
        timeout_seconds: HTTP request timeout (default: 10.0)

    Returns:
        bool: True if logged successfully, False otherwise
    """
    payload = {
        "driverId": driver_id,
        "intent": intent,
        "interactionCount": interaction_count,
        "createdAt": datetime.now(
            timezone.utc
        ).isoformat(),  # Auto-generate timestamp in ISO format
        "sessionId": session_id,
        "queryText": query_text,
    }

    if pickup_city is not None:
        payload["pickupCity"] = pickup_city
    if drop_city is not None:
        payload["dropCity"] = drop_city

    logger.info(f"Sending intent payload to BigQuery sync: {payload}")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                INTENT_API_URL,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout_seconds),
            ) as response:
                if response.status == 200:
                    response_text = await response.text()
                    logger.info(
                        f"Intent logged via HTTP: {intent} (driver={driver_id}, session={session_id})"
                    )
                    logger.info(f"BigQuery sync response body: {response_text}")
                    return True
                else:
                    response_text = await response.text()
                    logger.error(f"Failed to log intent: {response.status} - {response_text}")
                    return False

    except aiohttp.ClientError as e:
        logger.error(f"HTTP error logging intent: {e}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error logging intent: {e}", exc_info=True)
        return False


async def test_analytics_logging():
    logger.info("🚀 Starting intent logging test...")

    # Mock data fields
    test_params = {
        "driver_id": "XwFWWTp6xyfttmynty8CAp0HFUk1",
        "query_text": "",
        "intent": "generic",
        "session_id": "test-debug-session-001",
        "interaction_count": 4,
    }
    # test_params = {
    #     "driver_id": "DRV_989",
    #     "query_text": "Where is the nearest charging station?",
    #     "intent": "find_charging_point",
    #     "session_id": "sess-abc-123",
    #     "interaction_count": 5,
    # }

    # Calling the function
    success = await log_intents(**test_params)

    if success:
        logger.info("✅ Success: Intent logged to BigQuery.")
    else:
        logger.error("❌ Failure: Check logs for the specific error.")


if __name__ == "__main__":
    # Standard way to run a top-level entry point for coroutines
    asyncio.run(test_analytics_logging())
