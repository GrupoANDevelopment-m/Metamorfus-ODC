class ODCKernel:
    """
    AGNOSTIC KERNEL (Physics Engine)
    Updated v5.6: LIQUID ARCHITECTURE + SENSORIUM LINK
    """
    def __init__(self, ledger, entropy, market, sensorium):
        self.ledger = ledger
        self.entropy = entropy
        self.market = market
        self.sensorium = sensorium

    def apply_metabolism(self, organism, cycle):
        # 1. MORPHOLOGY FLUX
        focus = getattr(organism, 'morph_focus', 'BALANCED')
        
        targets = {
            "BALANCED": {"cpu": 33.0, "strength": 33.0, "agility": 34.0},
            "HUNT":     {"cpu": 10.0, "strength": 70.0, "agility": 20.0},
            "THINK":    {"cpu": 80.0, "strength": 10.0, "agility": 10.0},
            "ESCAPE":   {"cpu": 20.0, "strength": 10.0, "agility": 70.0},
            "TRADE":    {"cpu": 50.0, "strength": 10.0, "agility": 40.0}
        }
        
        target_dist = targets.get(focus, targets["BALANCED"])
        flow_rate = 2.0 
        
        for attr, target_val in target_dist.items():
            current = organism.attributes.get(attr, 33.0)
            if current < target_val:
                organism.attributes[attr] += flow_rate
            elif current > target_val:
                organism.attributes[attr] -= flow_rate
        
        total_mass = sum(organism.attributes.values())
        if total_mass > 0:
            factor = 100.0 / total_mass
            for k in organism.attributes:
                organism.attributes[k] *= factor

        # 2. COST OF EXISTENCE (Entropy + Hardware Stress)
        base_cost = self.entropy.get_metabolic_cost(cycle)
        
        # Sensorium Impact: Low battery increases metabolic cost (simulating stress)
        hw_stress = self.sensorium.get_battery_stress() if self.sensorium else 1.0
        
        cpu_tax = organism.attributes.get('cpu', 0) * 0.005
        total_cost = (base_cost + cpu_tax) * hw_stress
        
        organism.energy -= total_cost
        
        # 3. HOMEOSTASIS
        resting_states = ["IDLE", "FORGING", "EVOLVING", "FIZZLE", "FAILED", "Processing", "THINKING", "PLANNING"]
        is_resting = any(state in organism.action for state in resting_states)
        
        if is_resting:
            max_energy = 100.0
            deficit = max_energy - organism.energy
            if deficit > 0:
                organism.energy += (deficit * 0.5)
            
        return total_cost

    def process_intention(self, organism, intention):
        if not isinstance(intention, dict):
            return False
            
        action_name = intention.get('action', 'IDLE')
        intensity = float(intention.get('intensity', 0.5))
        
        if 'morph_focus' in intention:
            organism.morph_focus = intention['morph_focus']
        
        organism.intensity = intensity
        
        required_attrs = intention.get('required_attributes', {})
        for attr, req_val in required_attrs.items():
            current_val = organism.attributes.get(attr, 0)
            if current_val < req_val:
                organism.action = f"FIZZLE: {action_name} (Need {attr}:{req_val})"
                organism.last_result = "FAILURE_MORPH"
                return False

        action_cost = 2.0 * intensity
        if organism.energy < action_cost:
            organism.action = "EXHAUSTED"
            organism.last_result = "FAILURE_ENERGY"
            return False

        organism.energy -= action_cost
        organism.action = f"{action_name} v{intention.get('version', 1)}"
        organism.last_result = "SUCCESS"
        
        if "MINE" in action_name or "HUNT" in action_name:
            organism.energy = 100.0
            yield_amt = organism.attributes.get('strength', 0) * 0.2 * intensity
            organism.economy.balance += yield_amt
            
        elif "GATHER" in action_name:
            organism.energy = 100.0
            yield_amt = organism.attributes.get('agility', 0) * 0.2 * intensity
            organism.economy.balance += yield_amt

        elif "TRADE" in action_name:
            base_stat = (organism.attributes.get('cpu', 0) + organism.attributes.get('agility', 0)) / 2
            yield_amt = base_stat * 0.2 * intensity
            organism.economy.balance += yield_amt
            
        elif "HACK" in action_name:
            cpu_val = organism.attributes.get('cpu', 0)
            chance = cpu_val / 100.0
            # Simulating Hack Success
            if random.random() < chance:
                organism.economy.balance += 20.0 * intensity
                organism.energy += 30.0 
            else:
                organism.action = "HACK BLOCKED"
                organism.energy -= 10
                organism.last_result = "FAILURE_BLOCKED"
        
        if organism.energy > 100:
            organism.energy = 100
            
        return True
