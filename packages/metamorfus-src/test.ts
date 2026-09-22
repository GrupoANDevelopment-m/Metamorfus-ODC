async function test() {
  const url = "https://vswawfqzocydtwgwiqqv.supabase.co/rest/v1/dna_vault?select=*";
  const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzd2F3ZnF6b2N5ZHR3Z3dpcXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NDI2MzIsImV4cCI6MjA4MzQxODYzMn0.gkaSg4uNWdfu6hgmzdMNRnbt9m9uU2tkhlbXCwoi9fke";
  
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
