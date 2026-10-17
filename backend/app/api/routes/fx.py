from fastapi import APIRouter

from app.api.deps import FxServiceDep

router = APIRouter(tags=["fx"])


@router.get("/fx")
async def get_fx_rates(service: FxServiceDep):
    """Today's exchange rates from INR (recorded once a day). Used by the web app's currency picker."""
    return await service.get_fx_rates()
