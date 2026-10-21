// Mood, drift, phases, and angles arrive as uniforms so pixels only evaluate the spatial field.
struct Params {
  resolution: vec2f,
  time: f32,
  intensity: f32,
  grain: f32,
  animate: f32,
  seed: vec3f,
  fadeTop: f32,
  fadeBottom: f32,
  fadeColorTop: vec3f,
  fadeColorBottom: vec3f,
  danger: f32,
  closing: f32,
  mood: f32,
  hardness: f32,
  thick: f32,
  drift: vec2f,
  phase: vec3f,
  layoutOffset: vec2f,
  ridgeAmp: vec2f,
  cosA: vec2f,
  cosB: vec2f,
  cosC: vec2f,
  pointer: vec2f,
  pointerStrength: f32,
}

@group(0) @binding(0) var<uniform> params: Params;

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash13(input: vec3f) -> f32 {
  var p = fract(input * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

fn valueNoise3(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n000 = hash13(i);
  let n100 = hash13(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash13(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash13(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash13(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash13(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash13(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash13(i + vec3f(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, f.x);
  let nx10 = mix(n010, n110, f.x);
  let nx01 = mix(n001, n101, f.x);
  let nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

fn softGlow(p: vec2f, center: vec2f, radius: vec2f) -> f32 {
  let d = (p - center) / radius;
  return exp(-dot(d, d));
}

fn ridge(p: vec2f, phase: f32, thickness: f32, hard: f32, cs: vec2f, freq: f32) -> f32 {
  let ca = cs.x;
  let sa = cs.y;
  let r = vec2f(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  let frequency = freq * mix(1.0, 0.7, params.closing);
  let detail = mix(1.0, 0.3, params.closing);
  let fold =
    r.y
    - (
      -0.1
      + 0.3 * sin(r.x * (1.15 * frequency) + phase)
      + 0.12 * detail * sin(r.x * (2.35 * frequency) + phase * 1.7)
      + 0.05 * detail * sin(r.x * (4.2 * frequency) - phase * 0.65)
    );
  let soft = exp(-(fold * fold) / max(thickness * thickness, 0.0001));
  let sharp = min(
    mix(0.45, 7.0, clamp(hard, 0.0, 1.0)),
    thickness * thickness / (0.14 * 0.14),
  );
  return pow(soft, sharp);
}

fn layerLight(a: f32, b: f32) -> f32 {
  return a + b * (1.0 - a);
}

@fragment fn fs_main(@location(0) inputUv: vec2f) -> @location(0) vec4f {
  let uv = vec2f(inputUv.x, 1.0 - inputUv.y);
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let t = params.time * params.animate * 0.095 + params.seed.x * 40.0;

  let mood = params.mood;
  let hardness = params.hardness * mix(1.0, 0.55, params.closing);
  let drift = params.drift.x;
  let drift2 = params.drift.y;
  let pointerOffset = p - (params.pointer - 0.5) * vec2f(aspect, 1.0);
  let pointerInfluence = exp(-dot(pointerOffset, pointerOffset) * 14.0) * params.pointerStrength;
  let q = p - params.layoutOffset + vec2f(-pointerOffset.y, pointerOffset.x) * pointerInfluence * 0.16;
  let grainUv = (q + vec2f(drift, drift2) * 0.14) * params.resolution.y * 0.8 + params.seed.xy * 173.0;
  let fineGrain = hash12(floor(grainUv)) - 0.5;
  let softGrain = valueNoise3(vec3f(q * 120.0 + params.seed.xy * 35.0, t * 0.025)) - 0.5;
  let materialGrain = fineGrain * 0.65 + softGrain * 0.35;

  var ambient =
    softGlow(q, vec2f(-0.25 + drift, -0.06 + drift2), vec2f(1.2, 0.8)) * 0.4 +
    softGlow(q, vec2f(0.3 - drift2, 0.08 + drift), vec2f(0.95, 0.65)) * 0.28;

  var blueField =
    softGlow(q, vec2f(0.5 + drift2, 0.0 - drift), vec2f(0.55, 0.4)) * 0.75 +
    softGlow(q, vec2f(0.18 - drift, -0.28), vec2f(0.36, 0.28)) * 0.45 +
    softGlow(q, vec2f(-0.55 + drift, 0.22), vec2f(0.34, 0.26)) * mix(0.2, 0.55, mood) +
    softGlow(q, vec2f(0.72 + drift * 0.4, 0.32), vec2f(0.28, 0.22)) * 0.35 +
    softGlow(q, vec2f(-0.2 - drift2, -0.4), vec2f(0.4, 0.2)) * 0.3;
  let blueBreak =
    valueNoise3(vec3f(q * 2.4 + drift, t * 0.14 + params.seed.y)) * 0.55
    + valueNoise3(vec3f(q * 5.2 - drift2, t * 0.1 + params.seed.z + 2.0)) * 0.35;
  let blueHole = softGlow(q, vec2f(-0.05 + drift2, 0.08), vec2f(0.55, 0.35)) * 0.4;
  blueField *= mix(0.35, 1.15, blueBreak);
  blueField *= 1.0 - blueHole * mix(0.25, 0.55, 1.0 - mood);
  blueField = clamp(blueField * (1.0 + materialGrain * params.grain * 0.025), 0.0, 1.0);

  let thick = params.thick * mix(1.0, 1.35, params.closing);
  let ridgeMain = ridge(
    q + vec2f(drift * 0.5, drift2),
    params.phase.x,
    thick,
    hardness,
    params.cosA,
    0.95
  );
  let ridgeB = ridge(
    q * vec2f(1.08, 0.94) + vec2f(0.32, -0.2),
    params.phase.y,
    thick * 1.12,
    hardness,
    params.cosB,
    0.68
  );
  let ridgeC = ridge(
    q * vec2f(0.9, 1.14) + vec2f(-0.36, 0.22),
    params.phase.z,
    thick * 0.88,
    hardness,
    params.cosC,
    1.4
  );

  let bloom =
    softGlow(q, vec2f(-0.34 + drift, -0.1 + drift2), vec2f(0.58, 0.24)) * 0.6 +
    softGlow(q, vec2f(-0.02 + drift2, 0.1), vec2f(0.36, 0.17)) * 0.4;

  let ridgeLayer = layerLight(
    ridgeMain * 0.75,
    layerLight(
      ridgeB * params.ridgeAmp.x * mix(1.0, 0.55, params.closing),
      ridgeC * params.ridgeAmp.y * mix(1.0, 0.2, params.closing)
    )
  );
  var highlight = layerLight(ridgeLayer, bloom * 0.55);
  highlight = clamp(highlight * params.intensity * mix(1.0, 1.2, params.closing), 0.0, 1.0);

  let valley =
    softGlow(q, vec2f(0.1 + drift, -0.02), vec2f(0.4, 0.16)) * 0.65 +
    softGlow(q, vec2f(-0.42, 0.2), vec2f(0.28, 0.12)) * 0.4;
  highlight *= 1.0 - valley * mix(0.35, 0.55, mood);

  let textSafe = softGlow(p, vec2f(0.0, 0.02), vec2f(0.7, 0.36));
  highlight *= mix(1.0, 0.3, textSafe * 0.9);
  ambient *= mix(1.0, 0.6, textSafe * 0.65);
  highlight *= max(0.0, 1.0 + materialGrain * params.grain * 0.022);
  ambient *= max(0.0, 1.0 + materialGrain * params.grain * 0.016);

  let black = vec3f(0.0);
  let charcoal = mix(mix(vec3f(0.045, 0.05, 0.06), vec3f(0.025, 0.038, 0.05), params.closing), vec3f(0.052, 0.032, 0.034), params.danger);
  let navy = mix(mix(vec3f(0.07, 0.09, 0.13), vec3f(0.035, 0.08, 0.125), params.closing), vec3f(0.14, 0.04, 0.05), params.danger);
  let dustyBlue = mix(mix(vec3f(0.15, 0.19, 0.27), vec3f(0.07, 0.2, 0.33), params.closing), vec3f(0.3, 0.08, 0.09), params.danger);
  let steel = mix(mix(vec3f(0.32, 0.36, 0.42), vec3f(0.25, 0.42, 0.55), params.closing), vec3f(0.4, 0.26, 0.26), params.danger);
  let offWhite = mix(mix(vec3f(0.8, 0.82, 0.86), vec3f(0.73, 0.86, 0.94), params.closing), vec3f(0.84, 0.78, 0.77), params.danger);

  let blueAmt = mix(0.4, 0.85, mood) * mix(1.0, 1.25, params.closing) * mix(1.0, 1.12, params.danger);
  let blueTone = valueNoise3(vec3f(q * 1.6 + params.seed.xy, t * 0.12));
  var color = mix(black, charcoal, clamp(ambient + 0.3, 0.0, 1.0));
  color = mix(color, navy, clamp(blueField * 0.65 * blueAmt * mix(0.7, 1.15, blueTone), 0.0, 1.0));
  color = mix(
    color,
    dustyBlue,
    clamp(blueField * 0.28 * blueAmt * mix(0.5, 1.2, 1.0 - blueTone), 0.0, 1.0)
  );
  color = mix(color, steel, smoothstep(0.12, 0.5, highlight) * 0.55);
  color = mix(color, offWhite, pow(smoothstep(0.32, 0.92, highlight), mix(1.5, 2.3, hardness)));

  let side = min(uv.x, 1.0 - uv.x);
  let fromTop = 1.0 - uv.y;
  let edgeMask = smoothstep(0.0, 0.1, side) * smoothstep(0.0, 0.14, fromTop);
  color *= mix(0.88, 1.0, edgeMask);

  if (params.fadeBottom > 0.5) {
    color = mix(params.fadeColorBottom, color, smoothstep(0.0, 0.16, uv.y));
  }
  if (params.fadeTop > 0.5) {
    color = mix(params.fadeColorTop, color, smoothstep(0.0, 0.16, 1.0 - uv.y));
  }

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
