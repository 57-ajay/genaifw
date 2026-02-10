"""
Typesense service for searching duties, trips, and leads.
"""

import logging
from typing import Optional, List

import typesense

from app.models import Location, DutyInfo
from app.services.geocoding_service import get_city_coordinates_with_country
from config import get_settings

logger = logging.getLogger(__name__)


class TypesenseService:
    """Service for searching Typesense collections."""

    def __init__(self):
        settings = get_settings()
        self.client = typesense.Client({
            "nodes": [{
                "host": settings.typesense_host,
                "port": settings.typesense_port,
                "protocol": settings.typesense_protocol,
            }],
            "api_key": settings.typesense_api_key,
            "connection_timeout_seconds": 5,
        })
        self.duties_collection = settings.duties_collection
        self.trips_collection = settings.trips_collection
        self.leads_collection = settings.leads_collection

    async def search_duties(
        self,
        from_city: Optional[str] = None,
        to_city: Optional[str] = None,
        route: Optional[str] = None,
        vehicle_type: Optional[str] = None,
        limit: int = 10,
    ) -> list[DutyInfo]:
        """
        Search for available duties/trips.
        
        Args:
            from_city: Pickup city
            to_city: Drop city
            route: Route name (e.g., "Delhi-Mumbai")
            vehicle_type: Required vehicle type
            limit: Maximum results to return
            
        Returns:
            List of matching duties
        """
        try:
            # Build search query
            query_parts = []
            filter_parts = []

            if from_city:
                query_parts.append(from_city)
            if to_city:
                query_parts.append(to_city)
            if route:
                query_parts.append(route)

            query = " ".join(query_parts) if query_parts else "*"

            if vehicle_type:
                filter_parts.append(f"vehicle_type:={vehicle_type}")

            search_params = {
                "q": query,
                "query_by": "pickup_city,drop_city,route",
                "per_page": limit,
                "sort_by": "posted_at:desc",
            }

            if filter_parts:
                search_params["filter_by"] = " && ".join(filter_parts)

            results = self.client.collections[self.duties_collection].documents.search(
                search_params
            )

            duties = []
            for hit in results.get("hits", []):
                doc = hit["document"]
                duties.append(DutyInfo(
                    id=doc["id"],
                    pickup_city=doc["pickup_city"],
                    drop_city=doc["drop_city"],
                    route=doc.get("route", f"{doc['pickup_city']}-{doc['drop_city']}"),
                    fare=doc["fare"],
                    distance_km=doc["distance_km"],
                    vehicle_type=doc["vehicle_type"],
                    posted_at=doc["posted_at"],
                ))

            return duties

        except Exception as e:
            logger.error(f"Error searching duties: {e}")
            return []

    async def search_trips(
        self,
        pickup_city: Optional[str] = None,
        drop_city: Optional[str] = None,
        pickup_coordinates: Optional[List[float]] = None,
        radius_km: float = 50.0,
        limit: int = 30,
    ) -> List[dict]:
        """
        Search for trips using dual-stage search (text + geo).
        Internally runs BOTH city-based text search AND radius-based geo search,
        then merges and deduplicates results.

        Filters out trips where customerIsOnboardedAsPartner=true.
        Aligned with Dart/Flutter implementation using LOOSE matching.

        Args:
            pickup_city: Pickup city name for text search
            drop_city: Drop city name for text search (use "any" to skip drop filtering)
            pickup_coordinates: [lat, lng] for geo search (pre-validated, optional)
            radius_km: Search radius for geo search (default: 50km)
            limit: Maximum results per stage (default: 30)

        Returns:
            Merged and deduplicated list of trip documents, sorted by createdAt desc
        """
        # Initialize tracking
        all_results = []
        seen_ids = set()  # Track IDs to avoid duplicates
        has_drop_city = drop_city and drop_city.strip() != "" and drop_city.lower() != "any"
        has_pickup_city = pickup_city and pickup_city.strip() != ""

        logger.info(
            f"[TRIPS] Starting dual-stage search: pickup={pickup_city}, drop={drop_city}, "
            f"coordinates={'provided' if pickup_coordinates else 'none'}"
        )

        # Stage 1: Text-based search (if pickup or drop city provided)
        if has_pickup_city or has_drop_city:
            try:
                logger.info(f"[TRIPS] Stage 1: Starting text search with fuzzy matching...")

                # Build query string from cities (for fuzzy matching)
                query_parts = []
                if has_pickup_city:
                    query_parts.append(pickup_city)
                if has_drop_city:
                    query_parts.append(drop_city)
                query_string = " ".join(query_parts)

                # Only hard filters in filter_by (no city filters here)
                filter_parts = ["customerIsOnboardedAsPartner:=false"]

                search_params = {
                    "q": query_string,
                    "query_by": "customerPickupLocationCity,customerDropLocationCity",
                    "filter_by": " && ".join(filter_parts),
                    "sort_by": "createdAt:desc",
                    "per_page": limit,
                }

                results = self.client.collections[self.trips_collection].documents.search(
                    search_params
                )

                # Add results to tracking
                for hit in results.get("hits", []):
                    doc = hit["document"]
                    doc_id = doc.get("id")
                    if doc_id and doc_id not in seen_ids:
                        all_results.append(doc)
                        seen_ids.add(doc_id)

                logger.info(f"[TRIPS] Stage 1: Found {len(seen_ids)} trips from text search")

            except Exception as e:
                logger.error(f"[TRIPS] Stage 1: Text search failed: {e}")
                # Continue to next stage

        # Stage 2: Geocode pickup city (if coordinates not provided and city available)
        coords_for_geo_search = pickup_coordinates

        if not pickup_coordinates and has_pickup_city:
            try:
                logger.info(f"[TRIPS] Stage 2: Geocoding pickup city '{pickup_city}'...")
                coords_for_geo_search, country_code = await get_city_coordinates_with_country(pickup_city)

                if coords_for_geo_search and country_code == "IN":
                    logger.info(
                        f"[TRIPS] Stage 2: Geocoded to {coords_for_geo_search} (country: {country_code})"
                    )
                elif coords_for_geo_search and country_code != "IN":
                    logger.warning(
                        f"[TRIPS] Stage 2: City '{pickup_city}' is in {country_code}, not India - "
                        f"skipping geo search"
                    )
                    coords_for_geo_search = None
                else:
                    logger.warning(
                        f"[TRIPS] Stage 2: Geocoding failed for '{pickup_city}' - skipping geo search"
                    )
                    coords_for_geo_search = None

            except Exception as e:
                logger.error(f"[TRIPS] Stage 2: Geocoding error: {e}")
                coords_for_geo_search = None
        elif pickup_coordinates:
            logger.info(f"[TRIPS] Stage 2: Using provided coordinates {pickup_coordinates}")

        # Stage 3: Geo-based search (if coordinates available)
        if coords_for_geo_search:
            try:
                logger.info(f"[TRIPS] Stage 3: Starting geo search (radius={radius_km}km)...")
                lat, lng = coords_for_geo_search

                # Build filter parts - always filter out partner trips
                filter_parts = ["customerIsOnboardedAsPartner:=false"]

                # Add city filters with LOOSE matching (:) if specified
                if has_pickup_city:
                    filter_parts.append(f"customerPickupLocationCity:{pickup_city}")
                if has_drop_city:
                    filter_parts.append(f"customerDropLocationCity:{drop_city}")

                search_params = {
                    "q": "*",
                    "query_by": "",
                    "filter_by": f"customerPickupLocationCoordinates:({lat}, {lng}, {radius_km} km) && " + " && ".join(filter_parts),
                    "sort_by": f"customerPickupLocationCoordinates({lat}, {lng}):asc, createdAt:desc",
                    "per_page": limit,
                }

                results = self.client.collections[self.trips_collection].documents.search(
                    search_params
                )

                # Add new results to tracking (deduplicate by ID)
                geo_count = 0
                new_count = 0
                for hit in results.get("hits", []):
                    doc = hit["document"]
                    doc_id = doc.get("id")
                    geo_count += 1
                    if doc_id and doc_id not in seen_ids:
                        all_results.append(doc)
                        seen_ids.add(doc_id)
                        new_count += 1

                logger.info(
                    f"[TRIPS] Stage 3: Found {geo_count} trips from geo search, "
                    f"added {new_count} new unique trips"
                )

            except Exception as e:
                logger.error(f"[TRIPS] Stage 3: Geo search failed: {e}")
                # Continue to final stage

        # Stage 4: Sort by createdAt descending (newest first)
        all_results.sort(key=lambda x: x.get("createdAt", 0), reverse=True)

        logger.info(f"[TRIPS] Final: Returning {len(all_results)} total unique trips")
        return all_results

    async def search_leads(
        self,
        pickup_city: Optional[str] = None,
        drop_city: Optional[str] = None,
        pickup_coordinates: Optional[List[float]] = None,
        radius_km: float = 50.0,
        limit: int = 30,
    ) -> List[dict]:
        """
        Search for leads using dual-stage search (text + geo).
        Internally runs BOTH city-based text search AND radius-based geo search,
        then merges and deduplicates results.

        Filters out leads where status=pending.
        Aligned with Dart/Flutter implementation using LOOSE matching.

        Args:
            pickup_city: Pickup city name for text search
            drop_city: Drop city name for text search (use "any" to skip drop filtering)
            pickup_coordinates: [lat, lng] for geo search (pre-validated, optional)
            radius_km: Search radius for geo search (default: 50km)
            limit: Maximum results per stage (default: 30)

        Returns:
            Merged and deduplicated list of lead documents, sorted by createdAt desc
        """
        # Initialize tracking
        all_results = []
        seen_ids = set()  # Track IDs to avoid duplicates
        has_drop_city = drop_city and drop_city.strip() != "" and drop_city.lower() != "any"
        has_pickup_city = pickup_city and pickup_city.strip() != ""

        logger.info(
            f"[LEADS] Starting dual-stage search: pickup={pickup_city}, drop={drop_city}, "
            f"coordinates={'provided' if pickup_coordinates else 'none'}"
        )

        # Stage 1: Text-based search (if pickup or drop city provided)
        if has_pickup_city or has_drop_city:
            try:
                logger.info(f"[LEADS] Stage 1: Starting text search with fuzzy matching...")

                # Build query string from cities (for fuzzy matching)
                query_parts = []
                if has_pickup_city:
                    query_parts.append(pickup_city)
                if has_drop_city:
                    query_parts.append(drop_city)
                query_string = " ".join(query_parts)

                # Only hard filters in filter_by (no city filters here)
                filter_parts = ["status:!=pending"]

                search_params = {
                    "q": query_string,
                    "query_by": "fromTxt,toTxt",
                    "filter_by": " && ".join(filter_parts),
                    "sort_by": "createdAt:desc",
                    "per_page": limit,
                }

                results = self.client.collections[self.leads_collection].documents.search(
                    search_params
                )

                # Add results to tracking
                for hit in results.get("hits", []):
                    doc = hit["document"]
                    doc_id = doc.get("id")
                    if doc_id and doc_id not in seen_ids:
                        all_results.append(doc)
                        seen_ids.add(doc_id)

                logger.info(f"[LEADS] Stage 1: Found {len(seen_ids)} leads from text search")

            except Exception as e:
                logger.error(f"[LEADS] Stage 1: Text search failed: {e}")
                # Continue to next stage

        # Stage 2: Geocode pickup city (if coordinates not provided and city available)
        coords_for_geo_search = pickup_coordinates

        if not pickup_coordinates and has_pickup_city:
            try:
                logger.info(f"[LEADS] Stage 2: Geocoding pickup city '{pickup_city}'...")
                coords_for_geo_search, country_code = await get_city_coordinates_with_country(pickup_city)

                if coords_for_geo_search and country_code == "IN":
                    logger.info(
                        f"[LEADS] Stage 2: Geocoded to {coords_for_geo_search} (country: {country_code})"
                    )
                elif coords_for_geo_search and country_code != "IN":
                    logger.warning(
                        f"[LEADS] Stage 2: City '{pickup_city}' is in {country_code}, not India - "
                        f"skipping geo search"
                    )
                    coords_for_geo_search = None
                else:
                    logger.warning(
                        f"[LEADS] Stage 2: Geocoding failed for '{pickup_city}' - skipping geo search"
                    )
                    coords_for_geo_search = None

            except Exception as e:
                logger.error(f"[LEADS] Stage 2: Geocoding error: {e}")
                coords_for_geo_search = None
        elif pickup_coordinates:
            logger.info(f"[LEADS] Stage 2: Using provided coordinates {pickup_coordinates}")

        # Stage 3: Geo-based search (if coordinates available)
        if coords_for_geo_search:
            try:
                logger.info(f"[LEADS] Stage 3: Starting geo search (radius={radius_km}km)...")
                lat, lng = coords_for_geo_search

                # Build filter parts - always filter out pending leads
                filter_parts = ["status:!=pending"]

                # Add city filters with LOOSE matching (:) if specified
                if has_pickup_city:
                    filter_parts.append(f"fromTxt:{pickup_city}")
                if has_drop_city:
                    filter_parts.append(f"toTxt:{drop_city}")

                search_params = {
                    "q": "*",
                    "query_by": "",
                    "filter_by": f"location:({lat}, {lng}, {radius_km} km) && " + " && ".join(filter_parts),
                    "sort_by": f"location({lat}, {lng}):asc, createdAt:desc",
                    "per_page": limit,
                }

                results = self.client.collections[self.leads_collection].documents.search(
                    search_params
                )

                # Add new results to tracking (deduplicate by ID)
                geo_count = 0
                new_count = 0
                for hit in results.get("hits", []):
                    doc = hit["document"]
                    doc_id = doc.get("id")
                    geo_count += 1
                    if doc_id and doc_id not in seen_ids:
                        all_results.append(doc)
                        seen_ids.add(doc_id)
                        new_count += 1

                logger.info(
                    f"[LEADS] Stage 3: Found {geo_count} leads from geo search, "
                    f"added {new_count} new unique leads"
                )

            except Exception as e:
                logger.error(f"[LEADS] Stage 3: Geo search failed: {e}")
                # Continue to final stage

        # Stage 4: Sort by createdAt descending (newest first)
        all_results.sort(key=lambda x: x.get("createdAt", 0), reverse=True)

        logger.info(f"[LEADS] Final: Returning {len(all_results)} total unique leads")
        return all_results


# Singleton instance
_typesense_service: Optional[TypesenseService] = None


def get_typesense_service() -> TypesenseService:
    """Get or create the Typesense service singleton."""
    global _typesense_service
    if _typesense_service is None:
        _typesense_service = TypesenseService()
    return _typesense_service
