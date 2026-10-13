struct ParticleStatic {
  base: vec2f,
  radius: f32,
  opacity: f32,
  vibrance: f32,
  flow: f32,
}

struct ParticleState {
  position: vec2f,
  velocity: vec2f,
  energy: f32,
  activeFlag: f32,
}

struct RenderParams {
  resolution: vec2f,
  color: vec3f,
  time: f32,
  tint: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localPosition: vec2f,
  @location(1) opacity: f32,
  @location(2) radius: f32,
  @location(3) vibrance: f32,
  @location(4) energy: f32,
}

@group(0) @binding(0) var<storage, read> particleStatics: array<ParticleStatic>;
@group(0) @binding(1) var<storage, read> particleStates: array<ParticleState>;
@group(0) @binding(2) var<uniform> params: RenderParams;

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let particle = particleStatics[instanceIndex];
  let state = particleStates[instanceIndex];
  let energy = clamp(state.energy, 0.0, 1.0);
  let radius = particle.radius + energy * 0.16;
  let halfSize = radius + 0.5;
  let localPosition = corners[vertexIndex] * halfSize;
  let offset = particle.base - params.resolution * 0.5;
  let radialDistance = length(offset) / min(params.resolution.x, params.resolution.y);
  let angle = sin(params.time * 0.14 - radialDistance * 7.0) * 0.035 * particle.flow;
  let rotated = vec2f(offset.x * cos(angle) - offset.y * sin(angle), offset.x * sin(angle) + offset.y * cos(angle));
  let swell = rotated - offset;
  let center = vec2f(
    (state.position.x + swell.x) / params.resolution.x * 2.0 - 1.0,
    1.0 - (state.position.y + swell.y) / params.resolution.y * 2.0
  );
  let clipOffset = vec2f(
    localPosition.x / params.resolution.x * 2.0,
    -localPosition.y / params.resolution.y * 2.0
  );
  var output: VertexOutput;
  output.position = vec4f(center + clipOffset, 0.0, 1.0);
  output.localPosition = localPosition;
  output.opacity = particle.opacity;
  output.radius = radius;
  output.vibrance = particle.vibrance;
  output.energy = energy;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let distanceValue = length(input.localPosition);
  let core = 1.0 - smoothstep(max(input.radius - 0.45, 0.0), input.radius + 0.5, distanceValue);
  let alpha = min(core * input.opacity * (1.0 + input.energy * 0.16), 1.0);
  let tintAmount = 0.06 + input.vibrance * 0.08;
  return vec4f(mix(params.color, params.tint, tintAmount), alpha);
}
