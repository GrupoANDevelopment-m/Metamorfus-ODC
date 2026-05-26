import json
import os

class Sensorium:
    """
    REAL WORLD SENSORY BRIDGE
    Reads data injected by the Frontend HAL (Hardware Abstraction Layer)
    """
    def __init__(self):
        self.data_file = "/sensor_data.json"
        self.cached_data = {
            "battery": {"level": 1.0, "charging": True},
            "network": {"type": "unknown"},
            "location": None,
            "platform": "Unknown"
        }

    def perceive(self):
        """Reads the latest sensor dump from the HAL"""
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, 'r') as f:
                    data = json.load(f)
                    self.cached_data.update(data)
            except Exception as e:
                # Sensor read fail (IO race condition), ignore
                pass
        return self.cached_data

    def get_data(self):
        return self.cached_data

    def get_battery_stress(self):
        """Returns multiplier for metabolic cost based on battery"""
        bat = self.cached_data.get('battery')
        if not bat: return 1.0
        
        level = bat.get('level', 1.0)
        charging = bat.get('charging', True)
        
        if not charging and level < 0.2:
            return 5.0 # Critical stress, urge to hibernate
        if not charging and level < 0.5:
            return 1.5
        return 1.0
