"""
Text-to-Speech service using Google Cloud TTS with Chirp 3 HD voices.
Supports streaming audio generation and caching.
"""

import hashlib
import logging
import struct
from typing import AsyncIterator, Iterator, Optional

from google.cloud import texttospeech_v1 as texttospeech
from google.cloud import texttospeech_v1beta1 as texttospeech_beta

from config import get_settings

logger = logging.getLogger(__name__)


class TTSService:
    """Service for text-to-speech using Google Cloud TTS with Chirp 3 HD."""

    def __init__(self):
        settings = get_settings()
        self.client = texttospeech.TextToSpeechAsyncClient()
        self.beta_client = texttospeech_beta.TextToSpeechClient()
        self.voice_name = settings.tts_voice_name
        self.language_code = settings.tts_language_code

    def _get_cache_key(self, text: str) -> str:
        """Generate a cache key for the given text."""
        normalized = text.strip().lower()
        return f"tts:{hashlib.sha256(normalized.encode()).hexdigest()}"

    # async def synthesize_speech(self, text: str) -> bytes:
    #     """
    #     Synthesize speech from text using Chirp 3 HD Aoede voice.
    #
    #     Args:
    #         text: Text to convert to speech
    #
    #     Returns:
    #         Audio content as bytes (MP3 format)
    #     """
    #     try:
    #         synthesis_input = texttospeech.SynthesisInput(text=text)
    #
    #         # Use Chirp 3 HD voice (Aoede)
    #         voice = texttospeech.VoiceSelectionParams(
    #             language_code=self.language_code,
    #             name=self.voice_name,
    #         )
    #
    #         # Use MP3 for smaller size and wide compatibility
    #         audio_config = texttospeech.AudioConfig(
    #             audio_encoding=texttospeech.AudioEncoding.MP3,
    #             speaking_rate=1.0,
    #             pitch=0.0,
    #         )
    #
    #         response = await self.client.synthesize_speech(
    #             input=synthesis_input,
    #             voice=voice,
    #             audio_config=audio_config,
    #         )
    #
    #         return response.audio_content
    #
    #     except Exception as e:
    #         logger.error(f"Error synthesizing speech: {e}")
    #         raise

    # async def synthesize_speech_streaming(
    #     self, text: str, chunk_size: int = 4096
    # ) -> AsyncIterator[bytes]:
    #     """
    #     Synthesize speech and yield chunks for streaming.
    #
    #     Note: Google TTS doesn't support true streaming for standard synthesis,
    #     so we synthesize the full audio and then stream it in chunks.
    #     For true streaming, use the streaming_synthesize method with v1beta1.
    #
    #     Args:
    #         text: Text to convert to speech
    #         chunk_size: Size of each chunk in bytes
    #
    #     Yields:
    #         Audio chunks
    #     """
    #     try:
    #         audio_content = await self.synthesize_speech(text)
    #
    #         # Yield in chunks for streaming response
    #         for i in range(0, len(audio_content), chunk_size):
    #             yield audio_content[i : i + chunk_size]
    #
    #     except Exception as e:
    #         logger.error(f"Error in streaming synthesis: {e}")
    #         raise

    def get_cache_key(self, text: str) -> str:
        """Get the cache key for a given text (public method for caching service)."""
        return self._get_cache_key(text)

    def _create_wav_header(
        self,
        sample_rate: int = 24000,
        bits_per_sample: int = 16,
        channels: int = 1,
        data_size: int = 0,
    ) -> bytes:
        """Create WAV file header for LINEAR16 PCM audio."""
        byte_rate = sample_rate * channels * bits_per_sample // 8
        block_align = channels * bits_per_sample // 8

        riff_size = min(36 + data_size, 0xFFFFFFFF)
        data_size = min(data_size, 0xFFFFFFFF)

        header = struct.pack("<4sI4s", b"RIFF", riff_size, b"WAVE")
        header += struct.pack(
            "<4sIHHIIHH",
            b"fmt ",
            16,
            1,
            channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
        )
        header += struct.pack("<4sI", b"data", data_size)
        return header

    def synthesize_speech_streaming_beta(
        self, text: str, voice_name: str = "hi-IN-Chirp3-HD-Aoede"
    ) -> Iterator[bytes]:
        """
        True streaming synthesis using v1beta1 API.
        Yields audio chunks as they are generated with WAV wrapper.

        Note: This is synchronous (not async) due to beta API limitations.
        """

        def request_generator():
            # First request: Configuration with voice selection only
            streaming_config = texttospeech_beta.StreamingSynthesizeConfig(
                voice=texttospeech_beta.VoiceSelectionParams(
                    language_code="hi-IN",
                    name=voice_name,
                )
            )
            yield texttospeech_beta.StreamingSynthesizeRequest(streaming_config=streaming_config)

            # Second request: Text input
            yield texttospeech_beta.StreamingSynthesizeRequest(
                input=texttospeech_beta.StreamingSynthesisInput(text=text)
            )

        # Yield WAV header immediately with "infinite" data size so players
        # stream until EOF instead of waiting for a known length.
        yield self._create_wav_header(data_size=0xFFFFFFFF - 44)

        try:
            # Call streaming API and yield PCM chunks as they arrive
            streaming_responses = self.beta_client.streaming_synthesize(request_generator())

            for response in streaming_responses:
                if response.audio_content:
                    yield response.audio_content
        except Exception as e:
            logger.error(f"TTS beta streaming failed: {e}", exc_info=True)
            raise  # Re-raise to be handled by caller


# Singleton instance
_tts_service: Optional[TTSService] = None


def get_tts_service() -> TTSService:
    """Get or create the TTS service singleton."""
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
