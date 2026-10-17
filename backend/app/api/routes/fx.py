from fastapi import APIRouter

from app.services import fx

router = APIRouter(tags=["fx"])


@router.get("/fx")
async def get_fx():
    """Today's exchange rates from INR (recorded once a day). Used by the web app's currency picker."""
    return await fx.today()
