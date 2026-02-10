"""
Main API router for the Raahi Assistant.

Architecture:
- POST /assistant/query - Returns JSON with intent, UI action, and data
- GET /assistant/audio/{cache_key} - Streams cached audio
- POST /assistant/query-with-audio - Returns JSON + streams audio via chunked transfer encoding
"""

import asyncio
import json
import logging
import re
import uuid
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, Response, BackgroundTasks
from fastapi.responses import StreamingResponse

from app.models import (
    AssistantRequest,
    AssistantResponse,
    IntentType,
    UIAction,
    DriverProfile,
    Location,
)
from app.services import (
    get_gemini_service,
    get_typesense_service,
    get_tts_service,
    get_cache_service,
    get_audio_config_service,
)
from app.services.geocoding_service import get_city_coordinates, get_city_coordinates_with_country
from app.services.firebase_service import get_firebase_service
from app.services.analytics_service import log_intents
from app.services.fraud_service import check_driver_rating

from app.utils.merge_utils import (
    combine_trips_and_leads,
    normalize_trip_to_duty,
    normalize_lead_to_duty,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])


async def _process_intent(
    request: AssistantRequest, background_tasks: BackgroundTasks
) -> tuple[AssistantResponse, str]:
    """
    Process user request: classify intent, fetch data, generate response.

    Args:
        request: Assistant request with user text and profile
        background_tasks: FastAPI background tasks for async Firebase logging

    Returns:
        Tuple of (AssistantResponse, response_text_for_tts)
    """
    gemini = get_gemini_service()
    typesense = get_typesense_service()
    tts = get_tts_service()
    cache = get_cache_service()
    audio_config = get_audio_config_service()

    # Generate session ID if not provided
    session_id = request.session_id or str(uuid.uuid4())

    # Check for chip_click (UI button/chip interaction - no Gemini parsing needed)
    if request.chip_click == "find":
        find_chip_url = audio_config.get_url_direct("find_chip")

        return AssistantResponse(
            session_id=session_id,
            intent=IntentType.GENERIC,
            ui_action=UIAction.NONE,
            response_text="",  # No TTS, use audio_url instead
            data=None,
            audio_cached=False,
            cache_key="",
            audio_url=find_chip_url,
        ), ""

    if request.chip_click == "tools":
        tools_chip_url = audio_config.get_url_direct("tools_chip")

        return AssistantResponse(
            session_id=session_id,
            intent=IntentType.GENERIC,
            ui_action=UIAction.NONE,
            response_text="",  # No TTS, use audio_url instead
            data=None,
            audio_cached=False,
            cache_key="",
            audio_url=tools_chip_url,
        ), ""

    # Check for entry state (either interaction_count present OR empty text)
    if request.text.strip() == "":
        greeting_url = audio_config.get_url(
            IntentType.ENTRY, request.interaction_count, request.is_home, request.request_count
        )

        return AssistantResponse(
            session_id=session_id,
            intent=IntentType.ENTRY,
            ui_action=UIAction.ENTRY,
            response_text="",  # No TTS, use audio_url instead
            data=None,
            audio_cached=False,
            cache_key="",
            audio_url=greeting_url,
        ), ""

    # Step 1: Classify intent and get response using Gemini
    # Always use Hinglish for consistency with Hindi TTS audio
    intent_result = await gemini.classify_and_respond(
        user_text=request.text,
        driver_profile=request.driver_profile,
        location=request.current_location,
        session_id=session_id,
        preferred_language="hinglish",  # Always Hinglish
    )

    # Step 1.5: Check if GET_DUTIES has both cities missing, convert to ENTRY
    extracted_params = intent_result.data.get("extracted_params", {}) if intent_result.data else {}

    # Log intent query to BigQuery (background task - non-blocking)
    log_kwargs = {
        "driver_id": request.driver_profile.id,
        "query_text": request.text,
        "intent": intent_result.intent.value,
        "session_id": session_id,
        "interaction_count": request.interaction_count or 0,
    }
    if intent_result.intent == IntentType.GET_DUTIES:
        log_kwargs["pickup_city"] = extracted_params.get("from_city")
        log_kwargs["drop_city"] = extracted_params.get("to_city")
    background_tasks.add_task(log_intents, **log_kwargs)

    if intent_result.intent == IntentType.GET_DUTIES:
        pickup_city = extracted_params.get("from_city")
        drop_city = extracted_params.get("to_city")

        # If BOTH cities are missing, return ENTRY state instead
        pickup_empty = not pickup_city or (
            isinstance(pickup_city, str) and pickup_city.strip() == ""
        )
        drop_empty = not drop_city or (isinstance(drop_city, str) and drop_city.strip() == "")

        if pickup_empty and drop_empty:
            logger.info(
                f"GET_DUTIES with no cities specified for driver {request.driver_profile.id}, "
                f"converting to ENTRY state"
            )

            entry_url = audio_config.get_url(
                IntentType.ENTRY, request.interaction_count, request.is_home
            )

            return AssistantResponse(
                session_id=session_id,
                intent=IntentType.ENTRY,
                ui_action=UIAction.ENTRY,
                response_text="",  # No TTS, use audio_url instead
                data=None,
                audio_cached=False,
                cache_key="",
                audio_url=entry_url,
            ), ""

    # Step 2: Fetch data based on intent
    data = None
    rating_key = None  # For fraud check audio URL override

    if intent_result.intent == IntentType.GET_DUTIES:
        # Extract pickup and drop cities from Gemini's response
        pickup_city = extracted_params.get("from_city")
        drop_city = extracted_params.get("to_city")

        # Validate that cities are in India
        pickup_coordinates = None
        pickup_country = None
        drop_country = None
        used_geo = False

        # Check pickup city if provided
        if pickup_city:
            pickup_coordinates, pickup_country = await get_city_coordinates_with_country(
                pickup_city
            )

            # If geocoding failed, skip geo search but continue with text search
            # This handles cases like "Kamathivada" (misspelled "Kamithi wada")
            if pickup_country is None:
                logger.warning(
                    f"Could not geocode pickup city '{pickup_city}' - "
                    f"skipping geo-based search, will use text-based search only"
                )
                # Don't deny request - Typesense has better fuzzy matching
                pickup_coordinates = None
                used_geo = False
                # Continue to text search (don't return here)
            # Only validate if geocoding succeeded
            elif pickup_country != "IN":
                logger.info(
                    f"Pickup city '{pickup_city}' is in {pickup_country}, not India - denying request"
                )

                # Log rejected search to Firebase Analytics
                background_tasks.add_task(
                    get_firebase_service().log_search,
                    driver_id=request.driver_profile.id,
                    pickup_city=pickup_city,
                    drop_city=drop_city,
                    used_geo=False,
                    trips_count=0,
                    leads_count=0,
                )

                india_only_url = audio_config.get_url_direct("india_only")

                return AssistantResponse(
                    session_id=session_id,
                    success=True,
                    intent=IntentType.END,
                    ui_action=UIAction.SHOW_END,
                    response_text="",  # No TTS, use audio_url instead
                    data=None,
                    audio_cached=False,
                    cache_key="",
                    audio_url=india_only_url,
                ), ""

            # City is in India - coordinates are valid for geo search
            if pickup_coordinates:
                used_geo = True
                logger.info(
                    f"Using geo search for pickup city '{pickup_city}' (India): {pickup_coordinates}"
                )

        # Check drop city if provided (validate country only if geocoding succeeds)
        if drop_city:
            _, drop_country = await get_city_coordinates_with_country(drop_city)

            # If geocoding failed, log warning but continue with text search
            # This handles cases like "Kamathivada" (misspelled "Kamithi wada")
            if drop_country is None:
                logger.warning(
                    f"Could not geocode drop city '{drop_city}' - "
                    f"proceeding with text-based search only"
                )
                # Don't deny request - Typesense has better fuzzy matching
                # Continue execution (no return statement)
            # Only validate if geocoding succeeded
            elif drop_country != "IN":
                logger.info(
                    f"Drop city '{drop_city}' is in {drop_country}, not India - denying request"
                )

                # Log rejected search to Firebase Analytics
                background_tasks.add_task(
                    get_firebase_service().log_search,
                    driver_id=request.driver_profile.id,
                    pickup_city=pickup_city,
                    drop_city=drop_city,
                    used_geo=used_geo,
                    trips_count=0,
                    leads_count=0,
                )

                india_only_url = audio_config.get_url_direct("india_only")

                return AssistantResponse(
                    session_id=session_id,
                    success=True,
                    intent=IntentType.END,
                    ui_action=UIAction.SHOW_END,
                    response_text="",  # No TTS, use audio_url instead
                    data=None,
                    audio_cached=False,
                    cache_key="",
                    audio_url=india_only_url,
                ), ""

        # Run 2 parallel searches with dual-stage logic (text + geo internally)
        # Services now handle both text and geo searches internally, along with merging/deduplication
        search_results = await asyncio.gather(
            typesense.search_trips(
                pickup_city=pickup_city,
                drop_city=drop_city,
                pickup_coordinates=pickup_coordinates,  # Pass pre-validated coordinates
                radius_km=50.0,
                limit=50,
            ),
            typesense.search_leads(
                pickup_city=pickup_city,
                drop_city=drop_city,
                pickup_coordinates=pickup_coordinates,  # Pass pre-validated coordinates
                radius_km=50.0,
                limit=50,
            ),
            return_exceptions=True
        )

        # Handle exceptions - services return merged/deduplicated results
        all_trips = search_results[0] if not isinstance(search_results[0], Exception) else []
        all_leads = search_results[1] if not isinstance(search_results[1], Exception) else []

        # Extract query and counts to root level (for restructured response)
        query_info = {
            "pickup_city": pickup_city,
            "drop_city": drop_city,
            "used_geo": used_geo,
        }

        counts_info = {
            "trips": len(all_trips),
            "leads": len(all_leads),
        }

        # Return raw trips and leads without normalization
        data = {"trips": all_trips, "leads": all_leads}

        logger.info(f"GET_DUTIES: Found {len(all_trips)} trips, {len(all_leads)} leads")

        # Check if no duties were found - return END intent
        if len(all_trips) == 0 and len(all_leads) == 0:
            logger.info("No duties found - returning END intent")

            # Log zero-result search to Firebase Analytics
            background_tasks.add_task(
                get_firebase_service().log_search,
                driver_id=request.driver_profile.id,
                pickup_city=pickup_city,
                drop_city=drop_city,
                used_geo=used_geo,
                trips_count=0,
                leads_count=0,
            )

            # Get no_duty audio URL
            no_duty_url = audio_config.get_url_direct("no_duty")

            return AssistantResponse(
                session_id=session_id,
                success=True,
                intent=IntentType.END,
                ui_action=UIAction.SHOW_END,
                response_text="",  # No TTS, use audio_url instead
                data={"query": {"pickup_city": pickup_city, "drop_city": drop_city}},
                audio_cached=False,
                cache_key="",
                audio_url=no_duty_url,
            ), ""

        # Log search analytics to Firebase (background task - async, non-blocking)
        background_tasks.add_task(
            get_firebase_service().log_search,
            driver_id=request.driver_profile.id,
            pickup_city=pickup_city,
            drop_city=drop_city,
            used_geo=used_geo,
            trips_count=len(all_trips),
            leads_count=len(all_leads),
        )

    elif intent_result.intent == IntentType.CNG_PUMPS:
        data = {"stations": []}

    elif intent_result.intent == IntentType.PETROL_PUMPS:
        data = {"stations": []}

    elif intent_result.intent == IntentType.PARKING:
        data = {"stations": []}

    elif intent_result.intent == IntentType.NEARBY_DRIVERS:
        data = {"drivers": []}

    elif intent_result.intent == IntentType.TOWING:
        data = {"services": []}

    elif intent_result.intent == IntentType.TOILETS:
        data = {"locations": []}

    elif intent_result.intent == IntentType.TAXI_STANDS:
        data = {"stands": []}

    elif intent_result.intent == IntentType.AUTO_PARTS:
        data = {"shops": []}

    elif intent_result.intent == IntentType.CAR_REPAIR:
        data = {"shops": []}

    elif intent_result.intent == IntentType.HOSPITAL:
        data = {"hospitals": []}

    elif intent_result.intent == IntentType.POLICE_STATION:
        data = {"stations": []}

    elif intent_result.intent == IntentType.FRAUD:
        # Check if phoneNo is provided for fraud checking
        if request.phoneNo:
            # Call fraud check service
            rating_key, fraud_data = check_driver_rating(request.phoneNo)

            if rating_key and fraud_data:
                # Override intent to FRAUD_CHECK_FOUND
                intent_result.intent = IntentType.FRAUD_CHECK_FOUND
                intent_result.ui_action = UIAction.SHOW_FRAUD_RESULT

                # Set full API response as data
                data = fraud_data
                logger.info(f"FRAUD check: {rating_key} for {request.phoneNo}")
            else:
                # Error case - return empty data with generic fraud audio
                data = {}
                logger.warning(f"FRAUD check failed for {request.phoneNo}")
        else:
            # No phone number provided - initial fraud request
            data = {}

    elif intent_result.intent == IntentType.ADVANCE:
        data = {}

    elif intent_result.intent == IntentType.BORDER_TAX:
        data = {}

    elif intent_result.intent == IntentType.STATE_TAX:
        data = {}

    elif intent_result.intent == IntentType.PUC:
        data = {}

    elif intent_result.intent == IntentType.AITP:
        data = {}

    elif intent_result.intent == IntentType.INFORMATION:
        data = {}

    elif intent_result.intent == IntentType.END:
        data = {}

    # Step 3: Get audio URL from config (no TTS generation)
    # No cache needed since we're using pre-recorded audio URLs
    audio_url = audio_config.get_url(
        intent_result.intent, request.interaction_count, request.is_home
    )

    # Override audio URL for fraud check results
    if intent_result.intent == IntentType.FRAUD_CHECK_FOUND and rating_key:
        custom_audio_url = audio_config.get_url_direct(rating_key)
        if custom_audio_url:
            audio_url = custom_audio_url
            logger.info(f"Using custom audio URL for {rating_key}")

    # Override audio URL for GET_DUTIES when exactly one city is missing
    if intent_result.intent == IntentType.GET_DUTIES:
        pickup_empty = not pickup_city or (
            isinstance(pickup_city, str) and pickup_city.strip() == ""
        )
        drop_empty = not drop_city or (
            isinstance(drop_city, str) and drop_city.strip() == ""
        )

        if pickup_empty != drop_empty:
            # Exactly one city is missing (XOR) - use special audio
            custom_audio_url = audio_config.get_url_direct("duties_no_pickup_drop")
            if custom_audio_url:
                audio_url = custom_audio_url
                logger.info(
                    f"Duties found with one city missing "
                    f"(pickup: {pickup_city}, drop: {drop_city}) - using duties_no_pickup_drop audio"
                )

    # Build response with conditional query/counts for GET_DUTIES
    response_kwargs = {
        "session_id": session_id,
        "success": True,
        "intent": intent_result.intent,
        "ui_action": intent_result.ui_action,
        "response_text": "",  # No TTS, use audio_url instead
        "data": data,
        "audio_cached": False,  # Not using cache anymore
        "cache_key": "",  # Empty since no TTS
        "audio_url": audio_url,
    }

    # Add query and counts for GET_DUTIES intent
    if intent_result.intent == IntentType.GET_DUTIES:
        response_kwargs["query"] = query_info
        response_kwargs["counts"] = counts_info

    return AssistantResponse(**response_kwargs), intent_result.response_text


@router.post("/query", response_model=AssistantResponse)
async def query_assistant(
    request: AssistantRequest, background_tasks: BackgroundTasks
) -> AssistantResponse:
    """
    Process a text query from the user.

    Returns JSON with:
    - intent classification
    - UI action for client application to perform
    - relevant data (duties, stations, etc.)
    - cache_key to fetch audio separately

    Use this endpoint when you want to:
    1. Get the response data first
    2. Control the UI based on intent
    3. Then stream audio separately via /audio/{cache_key}
    """
    try:
        response, _ = await _process_intent(request, background_tasks)
        return response
    except Exception as e:
        logger.error(f"Error processing query: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/audio/{cache_key}")
async def get_audio(cache_key: str) -> StreamingResponse:
    """
    Stream audio for a given cache key.

    If cached, returns cached audio.
    If not cached, returns 404 (use /query-with-audio to generate).
    """
    cache = get_cache_service()

    audio_data = await cache.get(cache_key)
    if not audio_data:
        raise HTTPException(status_code=404, detail="Audio not found in cache")

    async def audio_stream() -> AsyncIterator[bytes]:
        chunk_size = 4096
        for i in range(0, len(audio_data), chunk_size):
            yield audio_data[i : i + chunk_size]

    return StreamingResponse(
        audio_stream(),
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "inline",
            "Transfer-Encoding": "chunked",
        },
    )


@router.post("/query-with-audio")
async def query_with_audio(
    request: AssistantRequest, background_tasks: BackgroundTasks
) -> StreamingResponse:
    """
    Process query and return JSON metadata + streamed audio.

    Response format (chunked transfer encoding):
    1. First chunk: JSON metadata (terminated with newline)
    2. Subsequent chunks: Audio data (WAV format via beta TTS streaming)

    This is a hybrid approach:
    - REST-like JSON response with all metadata
    - Chunked audio streaming for low latency playback
    - Backward compatible: if audio_url exists, client fetches it separately

    Client application should:
    1. Read first line as JSON, parse it for UI actions
    2. Check if audio_url exists in JSON:
       - If yes: fetch audio from URL
       - If no: pipe remaining bytes as WAV audio to player
    """
    # Log the raw request body for debugging
    # logger.info(f"Request received - session: {request.session_id}, request: {request}")
    logger.debug(f"Driver profile: {request.driver_profile.model_dump_json(indent=2)}")

    try:
        response, response_text = await _process_intent(request, background_tasks)

        def stream_response():
            # First, yield JSON metadata
            json_data = response.model_dump_json()
            yield json_data.encode() + b"\n"

            # Stream audio if audio_url is not available
            if not response.audio_url and response_text:
                # Use beta TTS streaming for real-time audio generation
                tts = get_tts_service()

                # Select voice based on preference or default
                voice_name = "hi-IN-Chirp3-HD-Aoede"  # Default voice

                try:
                    # Stream WAV audio chunks (beta API is synchronous)
                    # Sync generator runs in threadpool automatically via Starlette
                    for chunk in tts.synthesize_speech_streaming_beta(
                        response_text, voice_name=voice_name
                    ):
                        yield chunk
                except Exception as e:
                    logger.error(f"TTS streaming failed: {e}", exc_info=True)
                    # Send error marker so client can detect failure
                    error_marker = b"ERROR:" + str(e).encode()[:100]
                    yield error_marker
            # If audio_url exists, client fetches it separately (backward compatible)

        return StreamingResponse(
            stream_response(),
            media_type="application/octet-stream",
            headers={
                "Transfer-Encoding": "chunked",
                "X-Content-Type": "application/json+audio/wav",  # Changed from audio/mpeg
                "X-Intent": response.intent.value,  # Add intent header
            },
        )

    except Exception as e:
        logger.error(f"Error in query-with-audio: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/session/{session_id}")
async def clear_session(session_id: str) -> dict:
    """Clear conversation history for a session."""
    gemini = get_gemini_service()
    gemini.clear_session(session_id)
    return {"status": "ok", "message": f"Session {session_id} cleared"}


@router.get("/stream")
async def stream_question_answer(
    text: str, voice: str = "hi-IN-Chirp3-HD-Kore"
) -> StreamingResponse:
    """
    Stream audio response for general questions using beta TTS API.

    Query params:
        text: Question text (e.g., "cabswale key barey mey batao")
        voice: Optional voice name (default: hi-IN-Chirp3-HD-Kore)
              Available: hi-IN-Chirp3-HD-Aoede, hi-IN-Chirp3-HD-Kore

    Returns:
        Streaming WAV audio (LINEAR16 PCM with WAV header)

    Example:
        GET /assistant/stream?text=cabswale%20key%20barey%20mey%20batao
    """
    try:
        gemini = get_gemini_service()
        tts = get_tts_service()

        # Create minimal context for Gemini (no driver profile needed for info queries)
        dummy_profile = DriverProfile(id="info-query", name="Driver", phone="", is_verified=False)
        dummy_location = Location(latitude=0.0, longitude=0.0)

        # Classify intent and get Hinglish response
        intent_result = await gemini.classify_and_respond(
            user_text=text,
            driver_profile=dummy_profile,
            location=dummy_location,
            session_id=None,
            preferred_language="hinglish",  # Force Hinglish
        )

        response_text = intent_result.response_text

        # Stream TTS audio using beta API
        def stream_tts():
            # Note: beta API is synchronous, wrap in sync generator
            for chunk in tts.synthesize_speech_streaming_beta(response_text, voice_name=voice):
                yield chunk

        return StreamingResponse(
            stream_tts(),
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-cache",
                "Transfer-Encoding": "chunked",
                "X-Intent": intent_result.intent.value,
            },
        )

    except Exception as e:
        logger.error(f"Error in /stream endpoint: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/stream")
async def stream_question_answer_post(request: AssistantRequest) -> StreamingResponse:
    """
    POST variant of /stream with full driver context.
    Useful when driver profile is relevant to the question.
    """
    try:
        gemini = get_gemini_service()
        tts = get_tts_service()

        # Classify intent with full context
        intent_result = await gemini.classify_and_respond(
            user_text=request.text,
            driver_profile=request.driver_profile,
            location=request.current_location,
            session_id=request.session_id,
            preferred_language="hinglish",
        )

        response_text = intent_result.response_text

        # Stream TTS audio
        def stream_tts():
            for chunk in tts.synthesize_speech_streaming_beta(response_text):
                yield chunk

        return StreamingResponse(
            stream_tts(),
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-cache",
                "Transfer-Encoding": "chunked",
                "X-Intent": intent_result.intent.value,
            },
        )

    except Exception as e:
        logger.error(f"Error in POST /stream endpoint: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
