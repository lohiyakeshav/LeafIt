from fastapi import APIRouter, HTTPException, Response

from ..store import store

router = APIRouter(tags=["blocks"])


@router.get("/blocks")
def list_blocks():
    return store.list_blocks()


@router.get("/blocks/{block_id}")
def get_block(block_id: str):
    raw = store.raw_block(block_id)
    if raw is None:
        raise HTTPException(404, "unknown block")
    return Response(raw, media_type="application/json")  # raw cached JSON
