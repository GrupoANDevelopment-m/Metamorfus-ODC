"""Real text summarizer using simple frequency analysis."""
import re, collections

STOP_WORDS = set("""a an the and or but if then else when where why how what which who
i me my we us our you your he she it they them his hers its their this that these those
is are was were be been being have has had do does did will would shall should may might can could
as at by for from in into of on to with about above below over under up down out off through""".split())

def skill(organism, context):
    """Summarize text by extracting the top-N most important sentences.
    context: {"text": "...", "sentences": 3}
    """
    text = context.get("text", "")
    n = int(context.get("sentences", 3))
    if not text: return {"error": "text is required"}
    # Split into sentences (naive)
    sents = [s.strip() for s in re.split(r"[.!?]+", text) if len(s.strip()) > 10]
    if not sents: return {"summary": text[:200], "method": "truncation"}
    # Score each sentence by word frequency
    words = [w.lower() for w in re.findall(r"\b\w+\b", text.lower()) if w not in STOP_WORDS and len(w) > 2]
    freq = collections.Counter(words)
    scored = []
    for i, s in enumerate(sents):
        s_words = [w for w in re.findall(r"\b\w+\b", s.lower()) if w not in STOP_WORDS]
        score = sum(freq.get(w, 0) for w in s_words) / max(len(s_words), 1)
        scored.append((score, i, s))
    scored.sort(reverse=True)
    top = sorted(scored[:n], key=lambda x: x[1])
    return {"summary": " ".join(s for _, _, s in top), "method": "frequency"}