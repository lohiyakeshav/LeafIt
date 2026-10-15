"""Street photo -> heat audit (PRD §7.3 stretch). Gemini looks at a citizen's photo and returns structured findings
that map onto LeafIt's interventions. Needs Gemini; there is no offline fallback for vision."""
import json

from google.genai import types

from .gemini import MODEL, client

PROMPT = """You are auditing a street photo from an Indian city for summer heat risk.
Return JSON only. Judge only what is visible; if unsure, say so in notes."""

SCHEMA = {
    "type": "object",
    "properties": {
        "shade_level": {"type": "string", "enum": ["none", "low", "medium", "high"]},
        "surfaces": {"type": "array", "items": {"type": "string",
                     "enum": ["asphalt", "concrete", "bare_soil", "grass", "trees", "dark_roof", "light_roof", "water"]}},
        "people_exposed": {"type": "boolean", "description": "People walking, waiting or working in the sun"},
        "heat_risk": {"type": "string", "enum": ["low", "medium", "high"]},
        "suggestions": {"type": "array", "items": {"type": "object", "properties": {
            "intervention": {"type": "string", "enum": ["tree", "cool_roof", "shade_stop"]},
            "where": {"type": "string"}, "why": {"type": "string"}}, "required": ["intervention", "where", "why"]}},
        "notes": {"type": "string"},
    },
    "required": ["shade_level", "surfaces", "people_exposed", "heat_risk", "suggestions"],
}


class Unavailable(Exception):
    pass


def analyse(image: bytes, mime: str, llm=None) -> dict:
    llm = llm or client()
    if not llm:
        raise Unavailable("Photo analysis isn't switched on yet: it needs Gemini, which hasn't been set up on this server.")
    resp = llm.models.generate_content(
        model=MODEL,
        contents=[types.Part.from_bytes(data=image, mime_type=mime), PROMPT],
        config=types.GenerateContentConfig(response_mime_type="application/json", response_json_schema=SCHEMA),
    )
    return json.loads(resp.text)
