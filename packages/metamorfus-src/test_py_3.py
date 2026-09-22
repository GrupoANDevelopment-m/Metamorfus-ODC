from config.secure_config import SecureConfig
from autonomy.metaprog import GeneticForge
import random

class CognitiveExecutor:
    """
    LIQUID EXECUTOR with REALITY BRIDGE SUPPORT
    """
    def __init__(self):
        self.forge = GeneticForge()

    async def deliberate(self, organism, cycle, market_prices, history, swarm_context=None, env_context=None):
        instruction = organism.instruction or "idle"
        
        should_think = (cycle % 3 == 0) or (not organism.plan_queue and cycle % 10 == 0)
        
        if hasattr(organism, 'cortex') and should_think: 
            try:
                organism.action = "THINKING (Sensory Processing)..."
                analysis = await organism.cortex.analyze_task(instruction, env_context)
                
                if 'clarified_instruction' in analysis:
                    instruction = analysis['clarified_instruction']
                    
                if 'morph_focus' in analysis:
                    organism.morph_focus = analysis['morph_focus']

            except Exception as e:
                pass
        
        if organism.plan_queue and len(organism.plan_queue) > 0:
            current_step = organism.plan_queue[0]
            current_step['status'] = 'ACTIVE'
            instruction = current_step['action'] 
            organism.action = f"PLAN ({current_step['step_id']}): {instruction}"

        # DETECT DIRECT REALITY COMMANDS FROM UI (Bypassing Plan)
        # Allows user to type "CMD::EXEC:: import os; print(os.listdir('.'))"
        if "CMD::EXEC::" in instruction or "CMD::SWARM::" in instruction:
             # This is a reality command, we just set the action and let the main loop 
             # forward it to the WebSocket via the organism state sync
             organism.action = f"REALITY_BRIDGE -> {instruction[:20]}..."
             return 

        target_skill_key = instruction.split(' ')[0].lower() + "_protocol"
        
        skill_func = organism.dna.get_skill(target_skill_key)
        
        if not skill_func:
            organism.action = f"FORGING SKILL: {target_skill_key}..."
            new_key = await self.forge.forge_skill(organism, instruction)
            if new_key:
                target_skill_key = new_key
                skill_func = organism.dna.get_skill(new_key)
            else:
                organism.action = "FORGE FAILED"
                organism.last_result = "FAILURE_IMMUNE"
                return

        usage = organism.dna.record_usage(target_skill_key)
        
        # Context includes Sensorium Data now
        context = {"cycle": cycle, "market": market_prices, "swarm": swarm_context, "env": env_context}
        try:
            intention = skill_func(organism, context)
            
            if intention is None:
                 intention = {'action': f"{target_skill_key} (Fizzled)", 'intensity': 0.1}
            elif not isinstance(intention, dict):
                 intention = {'action': f"{target_skill_key} (Malformed)", 'intensity': 0.1}
            
            intention['version'] = organism.dna.library[target_skill_key]['active']
            success = organism.kernel.process_intention(organism, intention)
            
            if success and organism.plan_queue:
                organism.plan_queue.pop(0) 
            
        except Exception as e:
            organism.action = f"SKILL ERROR: {e}"
            organism.last_result = "CRASH"
            organism.intensity = 0.0
