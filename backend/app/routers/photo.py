import base64
import binascii

from fastapi import APIRouter, HTTPException

from ..agents import photo
from ..schemas import PhotoRequest

router = APIRouter(tags=["photo"])


@router.post("/photo")
def post_photo(req: PhotoRequest):
    try:
        image = base64.b64decode(req.image_b64, validate=True)
    except binascii.Error:
        raise HTTPException(422, "image_b64 is not valid base64")
    try:
        return photo.analyse(image, req.mime_type)
    except photo.Unavailable as e:
        raise HTTPException(503, str(e))
