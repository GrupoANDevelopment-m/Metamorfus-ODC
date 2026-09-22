async function test() {
  const url = "https://vswawfqzocydtwgwiqqv.supabase.co/rest/v1/dna_vault?on_conflict=skill_name,version";
  const key = "sb_publishable_aeDLN0jr5xjiCKlXfRgCGQ_pXH-bIab";
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
         skill_name: "test_skill",
         code_snippet: "def test(): pass",
         version: 1
      })
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
