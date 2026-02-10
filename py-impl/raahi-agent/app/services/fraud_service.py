import logging

import requests

logger = logging.getLogger(__name__)


def check_driver_rating(phone_number) -> tuple[str | None, dict | None]:
    """
    Check driver rating via fraud check API.

    Args:
        phone_number: Driver's phone number to check

    Returns:
        tuple: (rating_key, full_response_data)
            - rating_key: "fraud_high" | "fraud_medium" | "fraud_low" | "not_found" | None
            - full_response_data: Complete API response dict or None on error
    """
    url = "https://us-central1-bwi-cabswalle.cloudfunctions.net/raahi-data/getDriverRaing"
    payload = {"phoneNo": phone_number}

    try:
        # 1. Send the POST request with timeout
        response = requests.post(url, json=payload, timeout=10.0)

        # 2. Check if the HTTP request itself was successful (Status 200)
        response.raise_for_status()

        # 3. Parse the JSON response
        data = response.json()

        if data.get("found"):
            driver_detail = data.get("driverDetail", {})

            # Extract values correctly from nested driverDetail
            fraud = driver_detail.get("fraud", False)
            verified = driver_detail.get("profileVerified", False)

            # 1. Check for Fraud first (Highest priority)
            if fraud:
                return ("fraud_low", data)

            # 2. If not fraud, check verification status
            if verified:
                return ("found_verified", data)
            else:
                return ("found_unverified", data)

        else:
            logger.info("No driver record found for this number.")
            return ("not_found", data)

    except requests.exceptions.HTTPError as err:
        logger.error(f"HTTP error occurred: {err}")
        return (None, None)
    except Exception as err:
        logger.error(f"An error occurred: {err}")
        return (None, None)


# Execute
# check_driver_rating("+919083346516")
