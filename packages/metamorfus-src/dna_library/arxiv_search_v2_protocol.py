"""Real arxiv search using urllib (no external deps)."""
import urllib.request, urllib.parse, json, re

def skill(organism, context):
    """Search arxiv.org for papers.
    context: {"query": "transformer", "max_results": 5}
    """
    query = context.get("query", "")
    max_results = min(int(context.get("max_results", 5)), 20)
    if not query: return {"error": "query is required"}
    url = ("http://export.arxiv.org/api/query?"
           f"search_query={urllib.parse.quote(query)}&max_results={max_results}")
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            xml = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        return {"error": f"arxiv fetch failed: {e}"}
    # Naive XML parsing — extract <entry> blocks
    entries = re.findall(r"<entry>(.*?)</entry>", xml, re.DOTALL)
    papers = []
    for e in entries[:max_results]:
        title_m = re.search(r"<title>(.*?)</title>", e, re.DOTALL)
        id_m = re.search(r"<id>(.*?)</id>", e)
        sum_m = re.search(r"<summary>(.*?)</summary>", e, re.DOTALL)
        if title_m and id_m:
            papers.append({
                "title": re.sub(r"\s+", " ", title_m.group(1)).strip(),
                "url": id_m.group(1).strip(),
                "summary_preview": (sum_m.group(1).strip()[:200] if sum_m else ""),
            })
    return {"query": query, "count": len(papers), "papers": papers}