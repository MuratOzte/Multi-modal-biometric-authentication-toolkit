import os
import requests
import json
import sys
from dataclasses import dataclass
from typing import Any, Dict, Optional
from dotenv import load_dotenv
from datetime import datetime
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:
    ZoneInfo = None  # Eski Python ise timezone offset'i hesaplayamayız

load_dotenv()

API_BASE_URL = "https://vpnapi.io/api"
API_KEY = os.getenv("VPNAPI_KEY")
if not API_KEY:
    raise RuntimeError("VPNAPI_KEY environment variable not set")


@dataclass
class IpInfo:
    ip: Optional[str]
    security: dict
    location: dict
    network: dict


def fetch_ip_info(ip: str) -> IpInfo:
    url = f"{API_BASE_URL}/{ip}?key={API_KEY}"
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    data = resp.json()

    return IpInfo(
        ip=data.get("ip"),
        security=data.get("security", {}) or {},
        location=data.get("location", {}) or {},
        network=data.get("network", {}) or {},
    )


def compute_utc_offset_minutes(time_zone: Optional[str]) -> Optional[int]:
    """
    location.time_zone (örn: 'Europe/Istanbul') bilgisinden,
    o anki UTC offset'i dakika cinsinden hesapla.
    Örn: UTC+3 -> 180
    """
    if not time_zone or ZoneInfo is None:
        return None

    try:
        now = datetime.now(ZoneInfo(time_zone))
        offset = now.utcoffset()
        if offset is None:
            return None
        return int(offset.total_seconds() // 60)
    except Exception:
        return None


def slim_ip_info(ip_info: IpInfo) -> Dict[str, Any]:
    """Gereksiz alanları kırpılmış, sade bir ip_info döndür."""
    security = ip_info.security or {}
    location = ip_info.location or {}

    tz_name = location.get("time_zone")
    utc_offset_minutes = compute_utc_offset_minutes(tz_name)

    return {
        "ip": ip_info.ip,
        "security": {
            "vpn": security.get("vpn"),
            "proxy": security.get("proxy"),
            "tor": security.get("tor"),
            "relay": security.get("relay"),
        },
        "location": {
            "city": location.get("city"),
            "region": location.get("region"),
            "country": location.get("country"),
            "country_code": location.get("country_code"),
            "time_zone": tz_name,
            "utc_offset_minutes": utc_offset_minutes,
        },
        # network, latitude/longitude, continent vs. BİLİNÇLİ OLARAK YOK
    }


def check_ip_country(ip: str, expected_country_code: Optional[str]) -> Dict[str, Any]:
    ip_info = fetch_ip_info(ip)
    slim = slim_ip_info(ip_info)

    ip_country = slim["location"].get("country_code")
    same_country: Optional[bool] = None

    if ip_country is not None and expected_country_code is not None:
        same_country = ip_country.upper() == expected_country_code.upper()

    return {
        "same_country": same_country,
        "ip_country_code": ip_country,
        "expected_country_code": expected_country_code,
        "ip_info": slim,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python ip_check.py <ip> [expected_country_code]",
            file=sys.stderr,
        )
        return 1

    ip = sys.argv[1]
    expected_country = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"[ip_check] ip={ip!r}, expected={expected_country!r}", file=sys.stderr)

    result = check_ip_country(ip, expected_country)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
