const MAX_WAVES = 24u;
const MAX_IMPULSES = 24u;
const PI2 = 6.283185307179586;

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

struct Wave {
  center: vec2f,
  force: f32,
  envelope: f32,
  frontRadius: f32,
  width: f32,
  innerRadiusSquared: f32,
  outerRadiusSquared: f32,
  activationInnerRadiusSquared: f32,
  activationOuterRadiusSquared: f32,
}

struct Impulse {
  center: vec2f,
  radius: f32,
  force: f32,
}

struct SimParams {
  step: f32,
  spring: f32,
  damping: f32,
  diagonal: f32,
  cursor: vec2f,
  cursorVelocity: vec2f,
  cursorRadius: f32,
  cursorRadiusSquared: f32,
  cursorActivationRadiusSquared: f32,
  cursorPush: f32,
  cursorSweep: f32,
  cursorStrength: f32,
  particleCount: u32,
  waveCount: u32,
  impulseCount: u32,
}

@group(0) @binding(0) var<storage, read> particleStatics: array<ParticleStatic>;
@group(0) @binding(1) var<storage, read> sourceStates: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> destinationStates: array<ParticleState>;
@group(0) @binding(3) var<storage, read> waves: array<Wave>;
@group(0) @binding(4) var<storage, read> impulses: array<Impulse>;
@group(0) @binding(5) var<uniform> params: SimParams;

fn directionFor(offset: vec2f, distanceValue: f32, vibrance: f32) -> vec2f {
  if (distanceValue > 0.001) {
    return offset / distanceValue;
  }
  return vec2f(cos(vibrance * PI2), sin(vibrance * PI2));
}

@compute @workgroup_size(128)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let particle = particleStatics[index];
  let source = sourceStates[index];
  var position = source.position;
  var velocity = source.velocity;
  var energy = source.energy;
  var nextActive = source.activeFlag;

  if (params.cursorStrength > 0.002) {
    let offset = particle.base - params.cursor;
    if (dot(offset, offset) <= params.cursorActivationRadiusSquared) {
      nextActive = 1.0;
    }
  }

  for (var waveIndex = 0u; waveIndex < MAX_WAVES; waveIndex += 1u) {
    if (waveIndex >= params.waveCount) {
      break;
    }
    let wave = waves[waveIndex];
    let offset = particle.base - wave.center;
    let distanceSquared = dot(offset, offset);
    if (
      distanceSquared >= wave.activationInnerRadiusSquared &&
      distanceSquared <= wave.activationOuterRadiusSquared
    ) {
      nextActive = 1.0;
    }
  }

  for (var impulseIndex = 0u; impulseIndex < MAX_IMPULSES; impulseIndex += 1u) {
    if (impulseIndex >= params.impulseCount) {
      break;
    }
    let impulseData = impulses[impulseIndex];
    let offset = particle.base - impulseData.center;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared > impulseData.radius * impulseData.radius) {
      continue;
    }
    let distanceValue = sqrt(distanceSquared);
    let direction = directionFor(offset, distanceValue, particle.vibrance);
    let normalizedDistance = distanceValue / impulseData.radius;
    let falloff = exp(-(normalizedDistance * normalizedDistance) * 1.85);
    let angularNoise = (particle.vibrance - 0.5) * impulseData.force * falloff * 0.32;
    let impulseForce = impulseData.force * falloff;
    nextActive = 1.0;
    velocity += vec2f(
      direction.x * impulseForce - direction.y * angularNoise,
      direction.y * impulseForce + direction.x * angularNoise
    );
    position += direction * impulseForce * 0.34;
    energy += falloff * 0.48;
  }

  if (nextActive < 0.5) {
    destinationStates[index] = ParticleState(particle.base, vec2f(0.0), 0.0, 0.0);
    return;
  }

  let restore = particle.base - position;
  var acceleration = restore * params.spring;
  var localEnergy = 0.0;

  if (params.cursorStrength > 0.002) {
    let offset = position - params.cursor;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared <= params.cursorRadiusSquared) {
      let distanceValue = sqrt(distanceSquared);
      let direction = directionFor(offset, distanceValue, particle.vibrance);
      let normalizedDistance = distanceValue / params.cursorRadius;
      let pressure = exp(-normalizedDistance * normalizedDistance * 1.38) * params.cursorStrength;
      let cursorSpeed = length(params.cursorVelocity);
      let speedPressure = clamp(cursorSpeed / params.cursorRadius, 0.0, 1.45);
      let wake = exp(-normalizedDistance * normalizedDistance * 0.62) * params.cursorStrength * speedPressure;
      let swirl = (particle.vibrance - 0.5) * pressure * params.cursorPush * (0.26 + speedPressure * 0.16);
      acceleration += direction * pressure * params.cursorPush * (1.0 + speedPressure * 0.34);
      acceleration += vec2f(
        params.cursorVelocity.x * wake * params.cursorSweep - direction.y * swirl,
        params.cursorVelocity.y * wake * params.cursorSweep + direction.x * swirl
      );
      localEnergy += pressure * (0.18 + speedPressure * 0.14);
    }
  }

  for (var waveIndex = 0u; waveIndex < MAX_WAVES; waveIndex += 1u) {
    if (waveIndex >= params.waveCount) {
      break;
    }
    let wave = waves[waveIndex];
    let offset = position - wave.center;
    let distanceSquared = dot(offset, offset);
    if (distanceSquared < wave.innerRadiusSquared || distanceSquared > wave.outerRadiusSquared) {
      continue;
    }
    let distanceValue = sqrt(distanceSquared);
    let direction = directionFor(offset, distanceValue, particle.vibrance);
    let frontDistance = distanceValue - wave.frontRadius;
    let normalizedBand = frontDistance / wave.width;
    let band = exp(-(normalizedBand * normalizedBand) * 0.38);
    let pulse = band * wave.envelope;
    let aftershockOffset = (frontDistance + wave.width * 2.15) / (wave.width * 2.05);
    let aftershock = exp(-(aftershockOffset * aftershockOffset) * 0.42) * wave.envelope;
    acceleration += direction * (pulse * wave.force - aftershock * wave.force * 0.12);
    localEnergy += pulse * 0.24 + aftershock * 0.08;
  }

  velocity = (velocity + acceleration * params.step) * params.damping;
  let speed = length(velocity);
  position += velocity * params.step;
  let displacement = length(position - particle.base);
  let targetEnergy = max(localEnergy + speed * 0.032 + displacement / params.diagonal * 2.3, 0.0);
  let followBase = select(0.93, 0.7, targetEnergy > energy);
  let energyFollow = 1.0 - pow(followBase, params.step);
  energy = mix(energy, targetEnergy, energyFollow);

  if (speed + displacement * 0.04 + energy > 0.012 || localEnergy > 0.001) {
    destinationStates[index] = ParticleState(position, velocity, energy, 1.0);
  } else {
    destinationStates[index] = ParticleState(particle.base, vec2f(0.0), 0.0, 0.0);
  }
}
