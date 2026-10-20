import json, urllib.request, os

invoke_url = "https://integrate.api.nvidia.com/v1/chat/completions"
api_key = os.environ.get("NVIDIA_API_KEY", "")

payload = {
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "em uma frase: o que tem nesta imagem?"},
            {"type": "image_url", "image_url": {"url": "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg"}}
        ]
    }],
    "model": "moonshotai/kimi-k3",
    "max_tokens": 256,
    "stream": False,
}

req = urllib.request.Request(
    invoke_url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
        out = {
            "ok": True,
            "description": data["choices"][0]["message"]["content"],
            "model": data.get("model", "unknown"),
            "tokens": data.get("usage", {}).get("total_tokens", 0),
        }
        print(json.dumps(out))
except Exception as e:
    print(json.dumps({"ok": False, "error": repr(e)}))
