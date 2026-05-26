async function testNvidia() {
    console.log("--- Testing NVIDIA API ---");
    const key = process.env.NVIDIA_API_KEY;
    if (!key) { console.log("NO NVIDIA_API_KEY config. Will test with a dummy key assuming it will return 401."); }
    
    try {
        const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key || 'dummy'}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta/llama3-70b-instruct",
                messages: [{ role: "user", content: "Hello" }],
                max_tokens: 10
            })
        });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 100)}...`);
    } catch(e: any) {
        console.log(`Error: ${e.message}`);
    }
}

async function testKimi() {
    console.log("--- Testing KIMI API ---");
    const key = process.env.KIMI_API_KEY;
    if (!key) { console.log("NO KIMI_API_KEY config."); }
    
    try {
        const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key || 'dummy'}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "moonshot-v1-8k",
                messages: [{ role: "user", content: "Hello" }],
                max_tokens: 10
            })
        });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 100)}...`);
    } catch(e: any) {
        console.log(`Error: ${e.message}`);
    }
}

async function testMistral() {
    console.log("--- Testing MISTRAL API ---");
    const key = process.env.MISTRAL_API_KEY;
    if (!key) { console.log("NO MISTRAL_API_KEY config."); }
    
    try {
        const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key || 'dummy'}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "mistral-large-latest",
                messages: [{ role: "user", content: "Hello" }],
                max_tokens: 10
            })
        });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Response: ${text.substring(0, 100)}...`);
    } catch(e: any) {
        console.log(`Error: ${e.message}`);
    }
}

async function run() {
    await testNvidia();
    await testKimi();
    await testMistral();
}
run();
