"""Real NVD CVE lookup via the public NVD API."""
def skill(organism, context):
    """Look up CVEs by keyword or CPE from the NVD API.
    context: {"keyword": "log4j", "limit": 5}
    """
    keyword = context.get("keyword", "")
    limit = int(context.get("limit", 5))
    if not keyword: return {"error": "keyword is required"}
    try:
        import requests
    except ImportError:
        return {"error": "requests not installed. Run: pip install requests"}
    try:
        url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
        params = {"keywordSearch": keyword, "resultsPerPage": min(limit, 20)}
        r = requests.get(url, params=params, timeout=15, headers={"User-Agent": "metamorfus/1.0"})
        r.raise_for_status()
        data = r.json()
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