from fastapi import APIRouter, Response

from app.api.deps import BlockServiceDep

router = APIRouter(tags=["blocks"])


@router.get("/blocks")
def list_blocks(service: BlockServiceDep):
    return service.list_blocks()


@router.get("/blocks/{block_id}")
def get_block(block_id: str, service: BlockServiceDep):
    return Response(service.get_block(block_id), media_type="application/json")  # raw cached JSON
