import os

import boto3
from botocore.config import Config

from src import config

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=config.SEAWEEDFS_S3_ENDPOINT,
            aws_access_key_id=os.getenv("SEAWEEDFS_S3_ACCESS_KEY"),
            aws_secret_access_key=os.getenv("SEAWEEDFS_S3_SECRET_KEY"),
            region_name=os.getenv("SEAWEEDFS_S3_REGION", "us-east-1"),
            # SeaweedFS não roteia por subdomínio de bucket — precisa de path-style.
            config=Config(s3={"addressing_style": "path"}),
        )
    return _client


def key_from_url(url: str) -> str | None:
    """Documentos enviados pela tela de agentes ficam em <endpoint>/<bucket>/<key>
    (bucket privado). Retorna a key, ou None se o link for externo."""
    if not config.SEAWEEDFS_S3_ENDPOINT or not config.SEAWEEDFS_S3_BUCKET:
        return None
    prefix = f"{config.SEAWEEDFS_S3_ENDPOINT}/{config.SEAWEEDFS_S3_BUCKET}/"
    return url[len(prefix):] if url.startswith(prefix) else None


def download_object(s3_key: str) -> bytes:
    response = _get_client().get_object(Bucket=config.SEAWEEDFS_S3_BUCKET, Key=s3_key)
    return response["Body"].read()
