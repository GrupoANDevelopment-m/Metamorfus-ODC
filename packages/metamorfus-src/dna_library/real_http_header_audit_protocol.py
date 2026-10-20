"""Real HTTP security header auditor."""
import urllib.request, urllib.error, json

SECURITY_HEADERS = {
    "strict-transport-security": "Force HTTPS",
    "content-security-policy":   "XSS / injection",
    "x-frame-options":           "Clickjacking",
    "x-content-type-options":    "MIME sniffing",
    "referrer-policy":           "Referrer leakage",
    "permissions-policy":        "Feature abuse",
}

def skill(organism, context):
    """Audit HTTP security headers of a target URL."""
    url = context.get("url", "")
    if not url: return {"error": "url is required"}
    findings = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "metamorfus/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            for header, purpose in SECURITY_HEADERS.items():
                findings.append({"header": header, "present": header in headers, "purpose": purpose})
            present = sum(1 for f in findings if f["present"])
            return {"url": url, "status": resp.status, "score": round(present / len(findings), 2), "findings": findings}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "error": e.reason, "findings": findings}
    except Exception as e:
        return {"url": url, "error": str(e), "findings": findings}