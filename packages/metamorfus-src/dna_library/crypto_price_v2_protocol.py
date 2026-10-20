"""Real crypto price fetcher using public CoinGecko API."""
import urllib.request, urllib.parse, json

def skill(organism, context):
    """Fetch current price for a crypto symbol.
    context: {"symbol": "bitcoin"}  or  {"ids": "bitcoin,ethereum"}
    """
    base = "https://api.coingecko.com/api/v3/simple/price"
    params = {
        "vs_currencies": "usd",
        "include_24hr_change": "true",
        "include_market_cap": "true",
    }
    if "ids" in context:
        params["ids"] = context["ids"]
    elif "symbol" in context:
        params["ids"] = context["symbol"]
    else:
        return {"error": "symbol or ids required"}
    try:
        url = base + "?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        return {"prices": data, "fetched_at": __import__("time").time()}
    except Exception as e:
        return {"error": str(e)}