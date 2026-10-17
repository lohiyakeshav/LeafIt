"""Errors services raise. The API layer maps each to an HTTP status (api/errors.py); services never know about HTTP."""


class ServiceError(Exception):
    """Base class. str(error) is a sentence safe to show the user."""


class NotFoundError(ServiceError):
    pass


class InvalidInputError(ServiceError):
    pass


class UnavailableError(ServiceError):
    """An outside system the request depends on is down."""
