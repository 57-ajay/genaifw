from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Union
from enum import Enum


class IntentType(str, Enum):
    """Types of intents the assistant can handle."""

    ENTRY = "entry"
    GET_DUTIES = "get_duties"
    CNG_PUMPS = "cng_pumps"
    PARKING = "parking"
    PETROL_PUMPS = "petrol_pumps"
    NEARBY_DRIVERS = "nearby_drivers"
    TOWING = "towing"
    TOILETS = "toilets"
    TAXI_STANDS = "taxi_stands"
    AUTO_PARTS = "auto_parts"
    CAR_REPAIR = "car_repair"
    HOSPITAL = "hospital"
    POLICE_STATION = "police_station"
    FRAUD = "fraud"
    INFORMATION = "information"
    FRAUD_CHECK_FOUND = "fraud_check_found"
    ADVANCE = "advance"
    BORDER_TAX = "border_tax"
    STATE_TAX = "state_tax"
    PUC = "puc"
    AITP = "aitp"
    END = "end"
    GENERIC = "generic"


class UIAction(str, Enum):
    """UI actions that client application should perform."""

    ENTRY = "entry"
    SHOW_DUTIES_LIST = "show_duties_list"
    SHOW_CNG_STATIONS = "show_cng_stations"
    SHOW_PETROL_STATIONS = "show_petrol_stations"
    SHOW_PARKING = "show_parking"
    SHOW_NEARBY_DRIVERS = "show_nearby_drivers"
    SHOW_TOWING = "show_towing"
    SHOW_TOILETS = "show_toilets"
    SHOW_TAXI_STANDS = "show_taxi_stands"
    SHOW_AUTO_PARTS = "show_auto_parts"
    SHOW_CAR_REPAIR = "show_car_repair"
    SHOW_HOSPITAL = "show_hospital"
    SHOW_POLICE_STATION = "show_police_station"
    SHOW_FRAUD = "show_fraud"
    SHOW_INFO = "show_info"
    SHOW_FRAUD_RESULT = "show_fraud_result"
    SHOW_ADVANCE = "show_advance"
    SHOW_BORDER_TAX = "show_border_tax"
    SHOW_STATE_TAX = "show_state_tax"
    SHOW_PUC = "show_puc"
    SHOW_AITP = "show_aitp"
    SHOW_MAP = "show_map"
    SHOW_END = "show_end"
    NONE = "none"


class Location(BaseModel):
    """Geographic location."""

    latitude: float
    longitude: float


class ProfilePicVariant(BaseModel):
    url: str = ""
    type: str = ""


class ProfilePic(BaseModel):
    thumb: Optional[ProfilePicVariant] = None
    mob: Optional[ProfilePicVariant] = None
    full: Optional[ProfilePicVariant] = None
    verified: bool = False
    errorMessage: Optional[str] = None
    uploadedAt: Optional[str] = None
    verificationDate: Optional[str] = None


class VideoWithAudio(BaseModel):
    videoUrl: Optional[str] = None
    audioUrl: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    verified: bool = False
    errorMessage: Optional[str] = None
    uploadedAt: Optional[str] = None
    verificationDate: Optional[str] = None
    durationInSeconds: Optional[float] = None
    fileSize: Optional[int] = None
    videoType: Optional[str] = None
    audioType: Optional[str] = None


class VerifiedLanguage(BaseModel):
    name: Optional[str] = None
    audioUrl: Optional[str] = None
    verified: bool = False
    errorMessage: Optional[str] = None
    uploadedAt: Optional[str] = None
    verificationDate: Optional[str] = None
    durationInSeconds: Optional[float] = None
    fileSize: Optional[int] = None
    audioType: Optional[str] = None
    reason: Optional[str] = None
    transcription: Optional[str] = None


class AadharCard(BaseModel):
    aadharNumber: Optional[str] = None
    details: Optional[dict] = None
    verified: bool = False
    verificationDate: Optional[str] = None


class DrivingLicense(BaseModel):
    licenseNumber: Optional[str] = None
    details: Optional[dict] = None
    verified: bool = False
    verificationDate: Optional[str] = None


class GST(BaseModel):
    gstNumber: Optional[str] = None
    details: Optional[dict] = None
    verified: bool = False
    verificationDate: Optional[str] = None


class CustomerDuties(BaseModel):
    status: Optional[str] = None
    active: bool = False
    updatedAt: Optional[str] = None


class PremiumDriverStatus(BaseModel):
    completedCriteria: Optional[Union[int, list]] = None  # Can be int or list
    completionPercentage: Optional[float] = None
    premiumDriver: bool = False
    updatedAt: Optional[str] = None


class Photo(BaseModel):
    """Photo object with multiple size variants."""

    thumb: Optional[ProfilePicVariant] = None
    mob: Optional[ProfilePicVariant] = None
    full: Optional[ProfilePicVariant] = None
    verified: bool = False
    errorMessage: Optional[str] = None
    uploadedAt: Optional[str] = None


class OnboardedInfo(BaseModel):
    """Onboarding information with timestamp."""

    at: Optional[str] = None


class LeadsInfo(BaseModel):
    """Leads statistics."""

    available: int = 0
    exchange: int = 0
    duties: int = 0


class DriverProfile(BaseModel):
    """Driver profile information sent with each request."""

    # Existing fields
    id: str
    name: str
    phone: str
    vehicle_type: Optional[str] = None
    vehicle_number: Optional[str] = None
    is_verified: bool = False

    # Personal
    gender: Optional[str] = None
    city: Optional[str] = None
    age: Optional[int] = None
    married: Optional[bool] = None
    children: Optional[int] = None
    identity: Optional[str] = None
    bio: Optional[str] = None
    userName: Optional[str] = None

    # Verification
    verified: Optional[bool] = None
    profileVerified: Optional[bool] = None
    isAadhaarVerified: Optional[bool] = None
    isDLVerified: Optional[bool] = None

    # Fraud
    fraud: Optional[bool] = None
    fraudReports: Optional[int] = None

    # URLs
    profileUrl: Optional[str] = None
    qrCodeUrl: Optional[str] = None
    instagramUrl: Optional[str] = None
    facebookUrl: Optional[str] = None
    youtubeChannelUrl: Optional[str] = None
    introVideoUrl: Optional[str] = None

    # Media
    profilePic: Optional[ProfilePic] = None
    aadharProfilePic: Optional[Union[str, ProfilePic]] = (
        None  # Can be string URL or ProfilePic object
    )
    photos: Optional[List[Photo]] = None  # List of Photo objects (not strings)
    videos: Optional[List[str]] = None
    videosWithAudio: Optional[List[VideoWithAudio]] = None

    # Preferences
    smokingAllowedInside: Optional[bool] = None
    availableForPartTimeFullTime: Optional[Union[bool, str]] = None  # Can be bool or string
    availableForCustomersPersonalCar: Optional[bool] = None
    availableForDrivingInEventWedding: Optional[bool] = None
    allowHandicappedPersons: Optional[bool] = None
    isPetAllowed: Optional[bool] = None

    # Duty
    tripTypes: Optional[List[str]] = None
    isAvailableForCustomerDuty: Optional[bool] = None
    getDutyAlerts: Optional[bool] = None
    customerDuties: Optional[CustomerDuties] = None
    customerDutyCity: Optional[str] = None
    customerDutyUpdateTime: Optional[str] = None

    # Stats
    callReceivedCount: Optional[int] = None
    callDoneCount: Optional[int] = None
    recentCallls: Optional[Union[int, list]] = None  # Can be int or list
    profileVisits: Optional[int] = None
    connections: Optional[Union[int, list]] = None  # Can be int or list
    connectionCount: Optional[int] = None
    totalEarnings: Optional[float] = None
    quotationsCount: Optional[int] = None
    customersCount: Optional[int] = None
    confirmedTrips: Optional[int] = None
    customerCalls: Optional[int] = None

    # Documents
    aadharCard: Optional[AadharCard] = None
    drivingLicense: Optional[DrivingLicense] = None
    gst: Optional[GST] = None

    # Other
    leads: Optional[LeadsInfo] = None  # LeadsInfo object (not list)
    routes: Optional[list] = None
    verifiedVehicles: Optional[list] = None
    languages: Optional[List[str]] = None
    verifiedLanguages: Optional[List[VerifiedLanguage]] = None
    onboarded: Optional[Union[bool, OnboardedInfo]] = None  # Can be bool or OnboardedInfo object
    isPremium: Optional[bool] = None  # Client sends this field
    premiumDriverStatus: Optional[PremiumDriverStatus] = None
    createdAt: Optional[str] = None


class AssistantRequest(BaseModel):
    """Request from client application to the assistant."""

    text: str  # Transcribed text from speech_to_text
    driver_profile: DriverProfile
    current_location: Location
    session_id: Optional[str] = None  # For conversation context
    preferred_language: str = "hi"  # NOTE: Ignored - responses always in Hinglish
    interaction_count: Optional[int] = None  # Track user interaction count
    is_home: bool = True
    request_count: Optional[int] = None  # track page_count
    chip_click: Optional[str] = None  # UI chip click type (e.g., "find")
    phoneNo: Optional[str] = None  # for fraud_check


class DutyInfo(BaseModel):
    """Duty/trip information."""

    id: str
    pickup_city: str
    drop_city: str
    route: str
    fare: float
    distance_km: float
    vehicle_type: str
    posted_at: str


class IntentResult(BaseModel):
    """Result of intent classification and data retrieval."""

    intent: IntentType
    response_text: str
    ui_action: UIAction
    data: Optional[dict] = None  # Duties, stations, etc.


class AssistantResponse(BaseModel):
    """REST response with metadata (audio streamed separately via chunked transfer)."""

    session_id: str
    success: bool = True  # Always true for successful 200 responses
    intent: IntentType
    ui_action: UIAction
    response_text: str  # Deprecated: Always empty, use audio_url instead
    query: Optional[dict] = None  # Query info (for GET_DUTIES)
    counts: Optional[dict] = None  # Counts info (for GET_DUTIES)
    data: Optional[dict] = None
    audio_cached: bool = False
    cache_key: Optional[str] = None
    audio_url: Optional[str] = None  # Direct audio URL (for greeting)
