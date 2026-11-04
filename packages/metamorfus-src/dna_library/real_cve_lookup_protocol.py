"""Real NVD CVE lookup via the public NVD API."""
import json


def skill(organism, context):
    """Look up CVEs by keyword or CPE from the NVD API.
    context: {"keyword": "log4j", "limit": 5}
    """
    keyword = context.get("keyword", "")
    limit = int(context.get("limit", 5))
    if not keyword: return {"error": "keyword is required"}
    # urllib comes with Python; `requests` does not. A skill that only
    # works when a third-party package happens to be installed is a
    # skill that does not work. requests is used when present because
    # it is faster, but the standard library is the floor.
    try:
        import requests
    except ImportError:
        requests = None
    try:
        url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
        params = {"keywordSearch": keyword, "resultsPerPage": min(limit, 20)}
        if requests is not None:
            r = requests.get(url, params=params, timeout=15, headers={"User-Agent": "metamorfus/1.0"})
            r.raise_for_status()
            data = r.json()
        else:
            import urllib.parse, urllib.request
            full = url + "?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(full, headers={"User-Agent": "metamorfus/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        vulns = []
        for v in data.get("vulnerabilities", []):
            cve = v.get("cve", {})
            desc = ""
            for d in cve.get("descriptions", []):
                if d.get("lang") == "en":
                    desc = d.get("value", "")[:300]; break
            metrics = cve.get("metrics", {})
            cvss = None
            for vtype in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
                if vtype in metrics:
                    cvss = metrics[vtype][0]["cvssData"].get("baseScore")
                    break
            vulns.append({
                "id": cve.get("id"),
                "description": desc,
                "cvss_v3": cvss,
                "published": cve.get("published"),
            })
        return {"keyword": keyword, "total": data.get("totalResults", 0), "vulnerabilities": vulns}
    except Exception as e:
        return {"keyword": keyword, "error": str(e)}