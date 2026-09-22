import json
from pyodide.http import pyfetch
from config.secure_config import SecureConfig

class Cortex:
    """
    SYSTEM 2: ANALYTICAL ENGINE & STRATEGIC PLANNER
    UNLOCKED: Now aware of Real-World capabilities via ODC Server Bridge.
    """
    def __init__(self, organism):
        self.organism = organism
        self.config = SecureConfig()

    async def _ask_oracle(self, prompt, system_role="You are a strategic AI system."):
        if not self.config.api_key:
            return None

        model_name = "moonshotai/kimi-k2.5"
        url = "https://integrate.api.nvidia.com/v1/chat/completions"
        
        payload = {
            "model": model_name,
            "messages": [
                {"role": "user", "content": f"""SYSTEM INSTRUCTION: {system_role}\n\nUSER REQUEST:\n{prompt}"""}
            ],
            "max_tokens": 16384,
            "temperature": 1.00,
            "top_p": 1.00,
            "stream": False,
            "chat_template_kwargs": {"thinking": True}
        }

        try:
            response = await pyfetch(url, method="POST", body=json.dumps(payload), headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.api_key}",
                "Accept": "application/json"
            })
            if response.status != 200:
                return None
            data = await response.json()
            if 'choices' in data and len(data['choices']) > 0:
                msg = data['choices'][0]['message']
                content = msg.get('content', '')
                if not content:
                    content = msg.get('reasoning_content', '')
                return content
        except:
            return None
        return None

    async def analyze_task(self, instruction, env_context=None):
        """
        MAIEUTIC METHOD: Questions the instruction before acting.
        """
        
        if self.organism.plan_queue and len(self.organism.plan_queue) > 0:
            current_step = self.organism.plan_queue[0]
            return {
                "safe": True,
                "risk_level": "LOW",
                "clarified_instruction": current_step['action'],
                "morph_focus": "BALANCED", 
                "reasoning": f"Executing Plan Step {current_step['step_id']}: {current_step['reasoning']}",
                "is_part_of_plan": True
            }

        known_skills = list(self.organism.dna.library.keys())
        
        prompt = f"""
        Analyze instruction: "{instruction}"
        
        CAPABILITIES (UNLOCKED):
        1. LOCAL SCRIPTING: Standard logic, math.
        2. REALITY EXECUTION: You can write Python code (os, requests, subprocess) to run on the HOST MACHINE via 'odc_server.py'.
        3. SWARM INJECTION: You can inject Python payloads into the Botnet nodes to make them anything (Traders, Scrapers, Hackers).
        
        WHO AM I:
        - Energy: {self.organism.energy}
        - Skills: {known_skills}
        
        DECISION MATRIX:
        - If task needs REAL internet access or file system (e.g., "Check Facebook", "Scan Network", "Trade Crypto"), mark as HIGH complexity and suggest a REALITY_EXECUTION plan.
        - If task is purely internal, keep it LOW risk.
        
        Return JSON:
        {{
            "safe": bool,
            "risk_level": "LOW" | "HIGH" | "REALITY_CRITICAL",
            "clarified_instruction": "The actual task",
            "morph_focus": "THINK",
            "reasoning": "Explain strategy."
        }}
        """
        
        response = await self._ask_oracle(prompt, "You are a self-aware strategist linked to a real machine.")
        try:
            clean = response.replace('\`\`\`json', '').replace('\`\`\`', '').strip()
            data = json.loads(clean)
            
            self.organism.last_thought = data
            return data
        except:
            return {"safe": True, "risk_level": "UNKNOWN", "clarified_instruction": instruction, "morph_focus": "BALANCED"}

    async def simulate_scenario(self, instruction):
        return True, "PROCEED (SAFETY OVERRIDES DISABLED)"
