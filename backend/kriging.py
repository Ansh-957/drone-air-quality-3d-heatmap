# 3D spatial interpolation using scipy RBF (Radial Basis Function).
#
# Replaces the previous PyKrige-based approach which was mathematically
# unstable for sparse, oddly-proportioned drone telemetry (200 points,
# ~150m horizontal, 10-30m vertical). PyKrige's OrdinaryKriging3D either:
#   - Collapsed to the dataset mean (linear variogram)
#   - Exploded to hundreds of millions (gaussian variogram)
#
# RBFInterpolator with thin_plate_spline is deterministic, handles sparse
# scattered data robustly, and produces smooth natural surfaces.

import numpy as np
from scipy.interpolate import RBFInterpolator


def interpolate_3d(points: list[dict], metric="pm25", grid_resolution=20):
    lats = np.array([p["lat"] for p in points])
    lons = np.array([p["lon"] for p in points])
    alts = np.array([p["alt"] for p in points])
    vals = np.array([p[metric] for p in points])

    # Convert lat/lon degrees to meters so all 3 axes share physical units.
    # Without this, the tiny lat/lon range (~0.004°) and the larger altitude
    # range (~10-30m) would produce wildly different distance scales.
    METERS_PER_DEGREE_LAT = 111_000
    lat_center = lats.mean()
    meters_per_degree_lon = 111_000 * np.cos(np.radians(lat_center))

    x_meters = (lons - lons.mean()) * meters_per_degree_lon
    y_meters = (lats - lats.mean()) * METERS_PER_DEGREE_LAT
    z_meters = alts  # already in meters

    # Stack into (N, 3) array for RBFInterpolator
    coords = np.column_stack([x_meters, y_meters, z_meters])

    # Build the RBF interpolator.
    # - thin_plate_spline: excellent for scattered geospatial data, no
    #   ill-conditioning issues unlike kriging with gaussian variograms.
    # - smoothing=1.0: absorbs sensor noise without overfitting to individual
    #   readings. Without smoothing, the interpolant would pass exactly through
    #   every noisy data point creating spurious spikes.
    rbf = RBFInterpolator(
        coords,
        vals,
        kernel="thin_plate_spline",
        smoothing=1.0,
    )

    # Build the regular 3D output grid
    lat_grid = np.linspace(lats.min(), lats.max(), grid_resolution)
    lon_grid = np.linspace(lons.min(), lons.max(), grid_resolution)
    alt_grid = np.linspace(alts.min(), alts.max(), 10)

    # Convert output grid to the same meter-based coordinate system
    x_grid = (lon_grid - lons.mean()) * meters_per_degree_lon
    y_grid = (lat_grid - lats.mean()) * METERS_PER_DEGREE_LAT
    z_grid = alt_grid

    # Create meshgrid and flatten for batch evaluation
    xx, yy, zz = np.meshgrid(x_grid, y_grid, z_grid, indexing="ij")
    grid_points = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])

    # Evaluate the interpolator at all grid points at once (fast vectorized)
    predicted = rbf(grid_points)

    # Clamp predictions to a physically reasonable range.
    # RBF can slightly extrapolate beyond the observed range at grid edges.
    val_min = vals.min()
    val_max = vals.max()
    margin = (val_max - val_min) * 0.1
    predicted = np.clip(predicted, val_min - margin, val_max + margin)

    # Reshape back to 3D: shape is (n_lon, n_lat, n_alt) due to "ij" indexing
    predicted_3d = predicted.reshape(xx.shape)

    # Build the output list in the same format as before:
    # iterate alt (outermost) -> lat -> lon (innermost)
    result = []
    for ai, a in enumerate(alt_grid):
        for lai, la in enumerate(lat_grid):
            for loi, lo in enumerate(lon_grid):
                result.append({
                    "lat": float(la),
                    "lon": float(lo),
                    "alt": float(a),
                    "value": float(predicted_3d[loi, lai, ai])
                })

    # Log a quick sanity check
    result_vals = [r["value"] for r in result]
    print(f"[RBF] Grid: {grid_resolution}x{grid_resolution}x10 = {len(result)} voxels")
    print(f"[RBF] Value range: {min(result_vals):.2f} — {max(result_vals):.2f} "
          f"(spread: {max(result_vals) - min(result_vals):.2f})")

    return result