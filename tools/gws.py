#!/usr/bin/env python3
"""
gws.py — Google Drive utility for TJ Wedding project.

Functions:
    download_workbook() → downloads the wedding xlsx from Drive, returns openpyxl.Workbook
    upload_workbook(wb) → uploads modified xlsx back to Drive (replaces existing)

Credentials:
    - credentials.json  : service account key (project root)
    - GOOGLE_DRIVE_FILE_ID in .env
"""

import io
import os
import sys

from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed. Run: pip install openpyxl")
    sys.exit(1)

load_dotenv()

SCOPES     = ["https://www.googleapis.com/auth/drive"]
CREDS_FILE = os.path.join(os.path.dirname(__file__), "..", "credentials.json")
FILE_ID    = os.environ.get("GOOGLE_DRIVE_FILE_ID", "")


def _drive_service():
    creds = Credentials.from_service_account_file(CREDS_FILE, scopes=SCOPES)
    return build("drive", "v3", credentials=creds)


def download_workbook() -> openpyxl.Workbook:
    """Download the wedding xlsx from Drive and return an openpyxl Workbook."""
    if not FILE_ID:
        raise ValueError("GOOGLE_DRIVE_FILE_ID not set in .env")

    service = _drive_service()
    request = service.files().get_media(fileId=FILE_ID)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)

    done = False
    while not done:
        _, done = downloader.next_chunk()

    buf.seek(0)
    return openpyxl.load_workbook(buf, data_only=True)


def upload_workbook(wb: openpyxl.Workbook) -> str:
    """Upload a modified workbook back to Drive, replacing the existing file.

    Returns the file ID.
    """
    if not FILE_ID:
        raise ValueError("GOOGLE_DRIVE_FILE_ID not set in .env")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    service = _drive_service()
    media = MediaIoBaseUpload(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        resumable=False,
    )
    result = service.files().update(fileId=FILE_ID, media_body=media).execute()
    return result.get("id", FILE_ID)


if __name__ == "__main__":
    print("Downloading workbook...")
    wb = download_workbook()
    print(f"Sheets: {wb.sheetnames}")
    print("Done.")
