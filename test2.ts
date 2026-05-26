async function test() {
  const url = "https://vswawfqzocydtwgwiqqv.supabase.co/rest/v1/dna_vault?select=*";
  const key = "sb_publishable_aeDLN0jr5xjiCKlXfRgCGQ_pXH-bIab";
  
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
