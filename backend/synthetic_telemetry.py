# Generates a 200-point synthetic drone flight path with dramatic pollution
# hotspots for testing the 3D interpolation + visualization pipeline.
#
# The flight loops in a small arc near (43.8561, -79.0235), climbs and
# descends in altitude (sin curve), and has multiple pollution features:
#   - A broad primary hotspot near one corner (~PM2.5 up to 35)
#   - A secondary hotspot at the far end of the flight path
#   - An altitude-dependent gradient (higher = cleaner air)
#   - Gaussian sensor noise layered on top
#
# This creates enough spatial variation (~3 to ~35 PM2.5) for the RBF
# interpolation to produce a visually interesting 3D surface.

import json, time, math, random


def generate_flight(n_points=200):
    random.seed(42)  # reproducible for debugging

    data = []
    for i in range(n_points):
        t = i / n_points
        lat = 43.8561 + 0.002 * math.sin(2 * math.pi * t)
        lon = -79.0235 + 0.002 * t
        alt = 20 + 10 * math.sin(math.pi * t)

        # --- Primary hotspot: broad Gaussian centered near the start ---
        # Uses separate lat/lon distances scaled to meters for isotropy
        dlat1 = (lat - 43.8565) * 111000     # meters
        dlon1 = (lon - (-79.0225)) * 111000 * math.cos(math.radians(43.856))
        dist1_m = math.sqrt(dlat1**2 + dlon1**2)
        hotspot1 = 25 * math.exp(-(dist1_m / 80)**2)  # ~80m decay radius

        # --- Secondary hotspot: at the far end of the flight path ---
        dlat2 = (lat - 43.857) * 111000
        dlon2 = (lon - (-79.0215)) * 111000 * math.cos(math.radians(43.856))
        dist2_m = math.sqrt(dlat2**2 + dlon2**2)
        hotspot2 = 15 * math.exp(-(dist2_m / 60)**2)  # ~60m decay radius

        # --- Altitude gradient: higher altitude = cleaner air ---
        alt_factor = 1.0 - 0.3 * ((alt - 20) / 10)  # 1.0 at 20m, 0.7 at 30m

        pm25_base = (hotspot1 + hotspot2) * alt_factor
        pm25 = max(0, pm25_base + random.gauss(5, 1.5))

        pm10_base = pm25_base * 1.4
        pm10 = max(0, pm10_base + random.gauss(7, 2))

        data.append({
            "timestamp": time.time() + i,
            "lat": lat,
            "lon": lon,
            "alt": round(alt, 1),
            "pm25": round(pm25, 2),
            "pm10": round(pm10, 2),
            "temp": round(22 + random.gauss(0, 0.3), 2),
            "humidity": round(58 + random.gauss(0, 1), 2),
            "pressure": round(1013.2 + random.gauss(0, 0.5), 2),
        })
    return data


if __name__ == "__main__":
    flight = generate_flight()
    with open("synthetic_flight.json", "w") as f:
        json.dump(flight, f, indent=2)

    # Print a quick summary
    pm_vals = [p["pm25"] for p in flight]
    print(f"Generated {len(flight)} points")
    print(f"PM2.5 range: {min(pm_vals):.1f} — {max(pm_vals):.1f}")
    print(f"Lat range: {min(p['lat'] for p in flight):.6f} — {max(p['lat'] for p in flight):.6f}")
    print(f"Lon range: {min(p['lon'] for p in flight):.6f} — {max(p['lon'] for p in flight):.6f}")
    print(f"Alt range: {min(p['alt'] for p in flight):.1f} — {max(p['alt'] for p in flight):.1f}")