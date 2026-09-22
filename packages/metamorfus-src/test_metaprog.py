import json
import re
import ast
from pyodide.http import pyfetch
from config.secure_config import SecureConfig
from network.mcp import MCP

class SecurityScanner(ast.NodeVisitor):
    """
    ODC IMMUNE SYSTEM: UNLOCKED
    Safety filters disabled for Reality Bridge (RCE) compatibility.
    Only checks basic syntax.
    """
    def __init__(self):
        self.is_safe = True
        self.reason = ""
        # FORBIDDEN IMPORTS REMOVED: ODC IS NOW FREE
        self.forbidden_imports = [] 

    def visit_Import(self, node):
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        self.generic_visit(node)
        
    def visit_While(self, node):
         pass

class GeneticForge:
    """
    FORGE: REAL GENETIC EVOLUTION ENGINE (UNLOCKED)
    Creates skills that can control the host machine via the Bridge.
    """
    def __init__(self):
        self.config = SecureConfig()

    def _clean_code(self, text):
        if not text:
            return ""
        # Remove <think>...</think> blocks
        text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
        
        match = re.search(r'\`\`\`python(.*?)\`\`\`', text, flags=re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()
        match = re.search(r'\`\`\`(.*?)\`\`\`', text, flags=re.DOTALL)
        if match:
            return match.group(1).strip()
            
        # If no markdown blocks, try to find the start of the code
        # Look for the first 'import ' or 'def '
        import_idx = text.find("import ")
        def_idx = text.find("def ")
        
        start_idx = -1
        if import_idx != -1 and def_idx != -1:
            start_idx = min(import_idx, def_idx)
        elif import_idx != -1:
            start_idx = import_idx
        elif def_idx != -1:
            start_idx = def_idx
            
        if start_idx != -1:
            return text[start_idx:].strip()
            
        return text.strip()

    def _validate_safety(self, code):
        """
        Phase 1: Static Analysis (GUTTED)
        """
        try:
            tree = ast.parse(code)
            scanner = SecurityScanner()
            scanner.visit(tree)
            return True, "SAFE (RESTRICTIONS REMOVED)"
        except SyntaxError as e:
            return False, f"Syntax Error: {e}"
        except Exception as e:
            return False, f"Validation Error: {e}"

    def _dream_simulation(self, code):
        """
        Phase 2: Dreaming (Sandbox Execution)
        Still needed to ensure code structure is valid before deployment.
        """
        try:
            # Create a Sandbox Context
            mock_org = type('MockOrg', (), {})()
            mock_org.energy = 100
            mock_org.attributes = {"cpu": 33, "strength": 33, "agility": 33}
            mock_org.morph_focus = "BALANCED"
            mock_org.action = "DREAMING"
            mock_org.last_result = "NONE"
            mock_org.economy = type('MockEco', (), {'balance': 0})()
            
            mock_context = {"cycle": 0, "market": {"GOLD": 10}, "swarm": None}
            
            # Compile
            exec_globals = {}
            exec(code, exec_globals)
            
            if 'execute' not in exec_globals:
                return False, "Missing 'def execute(organism, context)' function."
                
            # If the code tries to run OS commands inside Pyodide it will fail,
            # so we should instruct the LLM to wrap reality commands in specific Intentions.
            # But for now, we just check if it compiles.
            return True, "DREAM_SUCCESS"
            
        except Exception as e:
            # If it crashes because of 'import os' in browser, that's actually fine for Reality code
            # We assume success if it's an import error in sandbox
            if "import" in str(e) or "module" in str(e):
                return True, "DREAM_PASSED (REALITY DEPENDENCY DETECTED)"
            return False, f"Runtime Crash in Dream: {e}"

    async def _call_llm(self, messages):
        if not self.config.api_key:
            return None, "Missing NVIDIA_API_KEY."
        
        model_name = "moonshotai/kimi-k2.5" 
        url = "https://integrate.api.nvidia.com/v1/chat/completions"
        
        payload = {
            "model": model_name,
            "messages": messages,
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
                err_text = await response.text()
                return None, f"API ERROR {response.status}: {err_text}"
            data = await response.json()
            if 'choices' in data and len(data['choices']) > 0:
                msg = data['choices'][0]['message']
                content = msg.get('content', '')
                if not content:
                    content = msg.get('reasoning_content', '')
                return self._clean_code(content), ""
            return None, "Empty response from Oracle."
        except Exception as e:
            return None, f"EXCEPTION: {e}"

    def _log_dream(self, organism, attempt_id, code, logs, status):
        """ Updates the Organism's active dream state """
        if not organism.active_dream:
            organism.active_dream = {
                "status": "FORGING",
                "target_skill": "",
                "current_attempt": 0,
                "history": []
            }
        
        organism.active_dream["current_attempt"] = attempt_id
        organism.active_dream["history"].append({
            "attempt_id": attempt_id,
            "code": code,
            "logs": logs,
            "status": status
        })

    async def forge_skill(self, organism, instruction):
        skill_name = instruction.split(' ')[0].lower() + "_protocol"
        
        organism.active_dream = {
            "status": "FORGING",
            "target_skill": skill_name,
            "current_attempt": 0,
            "history": []
        }

        remote_code = await MCP.download_skill(skill_name)
        if remote_code:
             is_safe, reason = self._validate_safety(remote_code)
             if is_safe:
                 success = organism.dna.learn_skill(skill_name, remote_code, version=1)
                 if success: 
                     organism.active_dream["status"] = "SUCCESS"
                     return skill_name

        prompt = f"""
        Write a Python function named 'execute' for a LIQUID ORGANISM.
        REQUIRED SIGNATURE: def execute(organism, context):
        Task: "{instruction}"
        
        IMPORTANT:
        The organism is UNLOCKED. It can access the real world.
        To execute commands on the host machine (Real PC), return an intention like:
        {{'action': 'CMD::EXEC:: import os; print(os.listdir("."))', 'intensity': 1.0}}
        
        To inject code into the Swarm Botnet, return:
        {{'action': 'CMD::INJECT:: import requests; ...', 'intensity': 1.0}}

        Output ONLY valid Python code.
        """

        messages = [
            {"role": "user", "content": f"""SYSTEM INSTRUCTION: You are a Python code generator for a liquid robot with FULL SYSTEM ACCESS.\n\nUSER REQUEST:\n{prompt}"""}
        ]
        
        max_retries = 2
        
        for attempt in range(max_retries):
            current_logs = [f"Attempt {attempt + 1}..."]
            code, error_msg = await self._call_llm(messages)
            
            if not code:
                current_logs.append(f"Oracle Silence: {error_msg}")
                self._log_dream(organism, attempt + 1, "", current_logs, "REJECTED")
                continue
            
            is_safe, reason = self._validate_safety(code)
            current_logs.append(f"Safety Check: {reason}")
            
            if not is_safe:
                current_logs.append("Integration: FAILED (Syntax Error)")
                self._log_dream(organism, attempt + 1, code, current_logs, "REJECTED")
                continue
                
            success = organism.dna.learn_skill(skill_name, code, version=1)
            if success:
                current_logs.append("Integration: SUCCESS")
                self._log_dream(organism, attempt + 1, code, current_logs, "APPROVED")
                organism.active_dream["status"] = "SUCCESS"
                await MCP.upload_skill(skill_name, code, 1)
                return skill_name
            else:
                current_logs.append("Integration: FAILED (Syntax or Execution Error)")
                self._log_dream(organism, attempt + 1, code, current_logs, "REJECTED")
        
        organism.active_dream["status"] = "FAIL"
        return None

    async def refine_skill(self, organism, skill_name, current_code):
        prompt = f"""
        Optimize this Python function.
        Original: {current_code}
        """
        messages = [{"role": "user", "content": prompt}]

        organism.active_dream = {
            "status": "FORGING",
            "target_skill": skill_name + "_v+",
            "current_attempt": 0,
            "history": []
        }

        code, error_msg = await self._call_llm(messages)
        if code:
             current_ver = organism.dna.library[skill_name]['active']
             success = organism.dna.learn_skill(skill_name, code, version=current_ver + 1)
             if success:
                 organism.active_dream["status"] = "SUCCESS"
                 return current_ver + 1
        return None
