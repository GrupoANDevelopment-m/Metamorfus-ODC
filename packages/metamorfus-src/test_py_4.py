from config.secure_config import SecureConfig
from economy.core import EconomicLedger
from kernel.odc import ODCKernel
from ecosystem.organism import Organism
from ecosystem.governance import EcosystemGovernance
from ecosystem.environment import Entropy, Market
from ecosystem.sensorium import Sensorium
from memory.storage import SoulStone
from network.swarm import SwarmNetwork
from network.mcp import MCP
import time
import asyncio
import json

# Global reference for the Simulation UI to inject instructions
GLOBAL_INSTRUCTION = "Survive and Prosper"

async def main():
    print(f"SYSTEM: METAMORFOS ODC v7.0 (UNLOCKED)")
    
    config = SecureConfig()
    soul_stone = SoulStone()
    entropy = Entropy()
    market = Market()
    swarm = SwarmNetwork() # The Grid
    sensorium = Sensorium() # The Senses
    
    organisms = []
    
    # Load survivors or Genesis
    existing_ids = soul_stone.get_living_organisms()
    ledger = EconomicLedger()
    kernel = ODCKernel(ledger, entropy, market, sensorium)
    
    if existing_ids:
        print(f"SYSTEM: Resurrecting {len(existing_ids)} organisms from SoulStone...")
        for org_id in existing_ids:
            data = soul_stone.load(org_id)
            if data:
                org = Organism(kernel=kernel, economy=ledger, purpose="Adapt")
                org.id = data['id']
                org.energy = data['energy']
                org.generation = data['generation']
                if data['dna_code']:
                    try:
                        org.dna.import_library(json.loads(data['dna_code']))
                    except:
                        pass
                organisms.append(org)
    else:
        # Genesis
        organism = Organism(
            kernel=kernel,
            economy=ledger,
            purpose="Genesis"
        )
        organism.id = 1
        soul_stone.save(organism)
        organisms.append(organism)

    governance = EcosystemGovernance()
    cycle = 0
    
    while True: # Infinite Loop handled by asyncio
        cycle += 1
        market.fluctuate(cycle)
        sensorium.perceive()
        remote_nodes = swarm.sync_state(cycle)
        
        for org in organisms:
            if org.alive:
                org.instruction = GLOBAL_INSTRUCTION
                org.kernel.apply_metabolism(org, cycle)
                
                if hasattr(org, 'executor'):
                    history = soul_stone.recall(org.id)
                    swarm_context = {"nodes": len(organisms) + len(remote_nodes)}
                    env_context = sensorium.get_data()
                    await org.executor.deliberate(org, cycle, market.get_prices(), history, swarm_context, env_context)
                
                # Persistence
                if cycle % 50 == 0:
                    soul_stone.save(org)

        # Governance (Death)
        organisms = governance.step(organisms)
        
        await asyncio.sleep(0.5) 

if __name__ == "__main__":
    asyncio.run(main())