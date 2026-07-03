from pydantic import BaseModel

class TelemetryPoint(BaseModel):
    timestamp: float
    lat: float
    lon: float
    alt: float
    pm25: float
    pm10: float
    temp: float
    humidity: float
    pressure: float