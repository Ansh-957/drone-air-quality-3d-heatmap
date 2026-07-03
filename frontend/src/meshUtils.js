// Builds a smooth, continuous triangulated terrain mesh from voxel data.
//
// Instead of the previous SolidPolygonLayer approach (which created flat-topped
// extruded "Minecraft" blocks per grid cell), this builds a proper triangle mesh
// where each vertex has its own height and color. Adjacent triangles share vertices,
// creating a continuous surface. Smooth per-vertex normals give the surface a
// fabric-like appearance under lighting.

/**
 * Multi-stop color ramp inspired by the "plasma" colormap.
 * Maps a normalized t ∈ [0, 1] to an RGBA array.
 */
function plasmaColor(t) {
    t = Math.max(0, Math.min(1, t));

    const stops = [
        { t: 0.0,  r: 13,  g: 8,   b: 135 },  // deep indigo
        { t: 0.15, r: 75,  g: 3,   b: 161 },  // purple
        { t: 0.3,  r: 137, g: 20,  b: 145 },  // magenta
        { t: 0.45, r: 192, g: 54,  b: 106 },  // hot pink
        { t: 0.6,  r: 230, g: 97,  b: 55  },  // orange
        { t: 0.75, r: 249, g: 149, b: 10  },  // amber
        { t: 0.9,  r: 252, g: 206, b: 37  },  // yellow
        { t: 1.0,  r: 240, g: 249, b: 33  },  // bright yellow-green
    ];

    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i].t && t <= stops[i + 1].t) {
            lo = stops[i];
            hi = stops[i + 1];
            break;
        }
    }

    const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
    return [
        Math.round(lo.r + (hi.r - lo.r) * f),
        Math.round(lo.g + (hi.g - lo.g) * f),
        Math.round(lo.b + (hi.b - lo.b) * f),
        230,
    ];
}

/**
 * Compute the percentile value from a sorted array.
 */
function percentile(sortedArr, p) {
    const idx = (sortedArr.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sortedArr[lower];
    return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
}

/**
 * Compute smooth per-vertex normals by averaging face normals of adjacent triangles.
 * This is what makes the mesh appear as a smooth fabric instead of faceted blocks.
 */
function computeSmoothNormals(positions, indices, numVertices) {
    const normals = new Float32Array(numVertices * 3);

    // Accumulate face normals at each vertex
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

        // Triangle edge vectors
        const e1x = positions[i1 * 3] - positions[i0 * 3];
        const e1y = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
        const e1z = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
        const e2x = positions[i2 * 3] - positions[i0 * 3];
        const e2y = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
        const e2z = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];

        // Cross product = face normal (not normalized — larger faces contribute more)
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;

        // Add to all 3 vertices sharing this face
        for (const vi of [i0, i1, i2]) {
            normals[vi * 3] += nx;
            normals[vi * 3 + 1] += ny;
            normals[vi * 3 + 2] += nz;
        }
    }

    // Normalize each vertex normal to unit length
    for (let i = 0; i < numVertices; i++) {
        const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2];
        const len = Math.sqrt(x * x + y * y + z * z) || 1;
        normals[i * 3] /= len;
        normals[i * 3 + 1] /= len;
        normals[i * 3 + 2] /= len;
    }

    return normals;
}


/**
 * Build a smooth triangulated terrain mesh from voxel data.
 *
 * The mesh positions are in METERS, centered on (0,0) horizontally.
 * Z axis = (value - minVal) * heightScale, giving a topographical surface.
 *
 * @param {Array} voxels - Array of {lat, lon, alt, value} from /heatmap
 * @param {Object} options
 * @param {number|null} options.altitudeIndex - Altitude layer index (null = auto-detect)
 * @param {number} options.heightScale - Z exaggeration multiplier
 * @returns {{ mesh, centerLon, centerLat, minVal, maxVal, alts, selectedAltIndex, triCount }}
 */
export function buildTerrainMesh(voxels, { altitudeIndex = null, heightScale = 5 } = {}) {
    if (!voxels || voxels.length === 0) {
        return {
            mesh: null, centerLon: 0, centerLat: 0,
            minVal: 0, maxVal: 1, alts: [], selectedAltIndex: 0, triCount: 0,
        };
    }

    // ─── Extract unique sorted coordinate axes ───
    const lons = [...new Set(voxels.map(v => v.lon))].sort((a, b) => a - b);
    const lats = [...new Set(voxels.map(v => v.lat))].sort((a, b) => a - b);
    const alts = [...new Set(voxels.map(v => v.alt))].sort((a, b) => a - b);

    // ─── Select altitude layer ───
    let selectedAltIndex;
    if (altitudeIndex !== null && altitudeIndex >= 0 && altitudeIndex < alts.length) {
        selectedAltIndex = altitudeIndex;
    } else {
        selectedAltIndex = 0;
        let bestVariance = -1;
        for (let a = 0; a < alts.length; a++) {
            const layerVals = voxels.filter(v => v.alt === alts[a]).map(v => v.value);
            if (layerVals.length === 0) continue;
            const mean = layerVals.reduce((s, v) => s + v, 0) / layerVals.length;
            const variance = layerVals.reduce((s, v) => s + (v - mean) ** 2, 0) / layerVals.length;
            if (variance > bestVariance) { bestVariance = variance; selectedAltIndex = a; }
        }
    }
    const targetAlt = alts[selectedAltIndex];

    // ─── Build 2D value grid at selected altitude ───
    const numRows = lats.length;
    const numCols = lons.length;
    const grid = Array.from({ length: numRows }, () => new Array(numCols).fill(null));
    for (const v of voxels) {
        if (v.alt !== targetAlt) continue;
        const latIdx = lats.indexOf(v.lat);
        const lonIdx = lons.indexOf(v.lon);
        if (latIdx >= 0 && lonIdx >= 0) grid[latIdx][lonIdx] = v.value;
    }

    // ─── Color range (percentile-based to resist outliers) ───
    const allVals = voxels.map(v => v.value).sort((a, b) => a - b);
    const minVal = percentile(allVals, 0.02);
    const maxVal = percentile(allVals, 0.98);
    const range = (maxVal - minVal) || 1;

    // ─── Coordinate conversion: lat/lon → meters from center ───
    const METERS_PER_DEGREE_LAT = 111000;
    const centerLat = (lats[0] + lats[lats.length - 1]) / 2;
    const centerLon = (lons[0] + lons[lons.length - 1]) / 2;
    const metersPerDegreeLon = 111000 * Math.cos(centerLat * Math.PI / 180);

    // ─── Build vertex attributes ───
    const numVertices = numRows * numCols;
    const positions = new Float32Array(numVertices * 3);
    const colors = new Float32Array(numVertices * 3);

    for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
            const vi = i * numCols + j;
            const value = grid[i][j] ?? minVal; // fill gaps with floor value

            // X = east (meters), Y = north (meters), Z = data value (scaled meters)
            positions[vi * 3]     = (lons[j] - centerLon) * metersPerDegreeLon;
            positions[vi * 3 + 1] = (lats[i] - centerLat) * METERS_PER_DEGREE_LAT;
            positions[vi * 3 + 2] = (value - minVal) * heightScale;

            const t = Math.max(0, Math.min(1, (value - minVal) / range));
            const c = plasmaColor(t);
            colors[vi * 3]     = c[0] / 255;
            colors[vi * 3 + 1] = c[1] / 255;
            colors[vi * 3 + 2] = c[2] / 255;
        }
    }

    // ─── Build triangle indices (2 triangles per grid cell, CCW winding) ───
    //
    //  v10 ── v11      Each quad gets split into 2 triangles:
    //   │  ╲   │        Triangle 1: v00 → v10 → v01
    //   │   ╲  │        Triangle 2: v01 → v10 → v11
    //  v00 ── v01      CCW winding ensures normals point upward (+Z)
    //
    const numQuads = (numRows - 1) * (numCols - 1);
    const indices = new Uint32Array(numQuads * 6);
    let ti = 0;

    for (let i = 0; i < numRows - 1; i++) {
        for (let j = 0; j < numCols - 1; j++) {
            const v00 = i * numCols + j;
            const v01 = i * numCols + (j + 1);
            const v10 = (i + 1) * numCols + j;
            const v11 = (i + 1) * numCols + (j + 1);

            indices[ti++] = v00;  indices[ti++] = v10;  indices[ti++] = v01;
            indices[ti++] = v01;  indices[ti++] = v10;  indices[ti++] = v11;
        }
    }

    // ─── Compute smooth vertex normals ───
    const normals = computeSmoothNormals(positions, indices, numVertices);

    // ─── Package as a loaders.gl-compatible mesh object ───
    // SimpleMeshLayer consumes this format directly, mapping:
    //   POSITION → shader `positions`
    //   NORMAL   → shader `normals`
    //   COLOR_0  → shader `colors` (must be Uint8Array!)
    const mesh = {
        attributes: {
            POSITION: { value: positions, size: 3 },
            NORMAL:   { value: normals,   size: 3 },
            COLOR_0:  { value: colors,    size: 3 },
        },
        indices: { value: indices, size: 1 },
    };

    const triCount = numQuads * 2;
    // Debug: verify color data
    const colorSample = [];
    for (let i = 0; i < Math.min(10, numVertices); i++) {
        colorSample.push(`[${colors[i*3].toFixed(3)}, ${colors[i*3+1].toFixed(3)}, ${colors[i*3+2].toFixed(3)}]`);
    }
    console.log(`[meshUtils] Color samples (first 10 verts): ${colorSample.join(', ')}`);
    console.log(`[meshUtils] Color array type: ${colors.constructor.name}, length: ${colors.length}`);
    console.log(
        `[meshUtils] Terrain: ${numVertices} verts, ${triCount} tris | ` +
        `alt=${targetAlt.toFixed(1)}m | range: ${minVal.toFixed(2)}–${maxVal.toFixed(2)} | ` +
        `heightScale=${heightScale}`
    );

    return { mesh, centerLon, centerLat, minVal, maxVal, alts, selectedAltIndex, triCount };
}