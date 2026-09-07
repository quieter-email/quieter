use std::f32::consts::TAU;
use std::sync::OnceLock;

use image::RgbaImage;

use super::smoothstep;

#[derive(Default)]
pub(super) struct ParticleField {
    width: u32,
    height: u32,
    gap: f64,
    dots: Vec<Dot>,
    waves: Vec<Wave>,
    previous_seconds: f32,
    cursor: Option<[f32; 2]>,
    cursor_velocity: [f32; 2],
    cursor_strength: f32,
}

struct Dot {
    base: [f32; 2],
    position: [f32; 2],
    velocity: [f32; 2],
    opacity: f32,
    radius: f32,
    vibrance: f32,
    energy: f32,
    active: bool,
}

struct Wave {
    center: [f32; 2],
    started: f32,
    speed: f32,
    width: f32,
    force: f32,
    life: f32,
    activated_radius: f32,
}

struct WaveFrame {
    center: [f32; 2],
    front_radius: f32,
    width: f32,
    force: f32,
    envelope: f32,
    inner: f32,
    outer: f32,
    activation_inner: f32,
    activation_outer: f32,
}

fn hash(x: f64, y: f64) -> f64 {
    let value = (x * 127.1 + y * 311.7).sin() * 43_758.545_312_3;
    value - value.floor()
}

fn brand_boundary() -> &'static [f64; 720] {
    static BOUNDARY: OnceLock<[f64; 720]> = OnceLock::new();
    BOUNDARY.get_or_init(|| {
        // Cubics from the final mark in packages/ui/src/lib/brand-geometry.ts.
        let curves = [
            [
                [721.882, 305.554],
                [932.706, 516.378],
                [932.706, 538.57],
                [721.882, 749.356],
            ],
            [
                [721.882, 749.356],
                [584.322, 886.916],
                [415.678, 886.916],
                [278.118, 749.356],
            ],
            [
                [278.118, 749.356],
                [67.294, 538.57],
                [67.294, 516.378],
                [278.118, 305.554],
            ],
            [
                [278.118, 305.554],
                [488.904, 94.768],
                [511.096, 94.768],
                [721.882, 305.554],
            ],
        ];
        let mut outline = Vec::with_capacity(1025);
        for curve in curves {
            for index in 0..256 {
                let t = f64::from(index) / 256.0;
                let s = 1.0 - t;
                outline.push(std::array::from_fn::<_, 2, _>(|axis| {
                    s.powi(3) * curve[0][axis]
                        + 3.0 * s.powi(2) * t * curve[1][axis]
                        + 3.0 * s * t.powi(2) * curve[2][axis]
                        + t.powi(3) * curve[3][axis]
                        - 500.0
                }));
            }
        }
        outline.push(outline[0]);
        std::array::from_fn(|index| {
            let angle = index as f64 / 720.0 * std::f64::consts::TAU;
            let ray = [angle.cos(), angle.sin()];
            let mut radius: f64 = 0.0;
            for edge in outline.windows(2) {
                let delta = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]];
                let divisor = ray[0] * delta[1] - ray[1] * delta[0];
                if divisor.abs() < 1e-10 {
                    continue;
                }
                let distance = (edge[0][0] * delta[1] - edge[0][1] * delta[0]) / divisor;
                let along_edge = (edge[0][0] * ray[1] - edge[0][1] * ray[0]) / divisor;
                if distance >= 0.0 && (0.0..=1.0).contains(&along_edge) {
                    radius = radius.max(distance);
                }
            }
            // Match the browser's twelve binary path-containment refinements.
            ((radius / (600.0 / 4096.0)).floor() + 0.5) * (600.0 / 4096.0)
        })
    })
}

impl ParticleField {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn render(
        &mut self,
        css_width: f32,
        css_height: f32,
        display_scale: f32,
        seconds: f32,
        primary: [f32; 3],
        dark: bool,
        pointer: Option<[f32; 2]>,
        clicks: &[[f32; 2]],
    ) -> RgbaImage {
        let dpr = display_scale
            .min(1.5)
            .min((2_200_000.0 / (css_width * css_height)).sqrt().max(0.55));
        let width = (css_width * dpr).round().max(1.0) as u32;
        let height = (css_height * dpr).round().max(1.0) as u32;
        let gap =
            f64::from(4.0 * dpr).max((f64::from(width) * f64::from(height) / 54_000.0).sqrt());
        if self.width != width || self.height != height || (self.gap - gap).abs() >= 0.01 {
            self.rebuild(width, height, gap);
        }
        let elapsed = if self.previous_seconds > 0.0 {
            ((seconds - self.previous_seconds) * 1000.0).clamp(8.0, 34.0)
        } else {
            16.667
        };
        self.previous_seconds = seconds;
        self.simulate(elapsed, seconds, pointer, clicks);
        let width_f = width as f32;
        let height_f = height as f32;
        let swell_size = width_f.min(height_f) * 0.0012;
        let tint = if dark {
            [152.0 / 255.0, 184.0 / 255.0, 220.0 / 255.0]
        } else {
            [75.0 / 255.0, 99.0 / 255.0, 128.0 / 255.0]
        };
        let mut image = RgbaImage::new(width, height);
        for dot in &self.dots {
            let energy = dot.energy.clamp(0.0, 1.0);
            let radius = dot.radius + energy * 0.12 + smoothstep(0.72, 1.0, dot.vibrance) * 0.12;
            let center = [
                dot.position[0]
                    + (dot.base[1] / height_f * 6.28318 * 1.6 + seconds * 0.2).sin() * swell_size,
                dot.position[1]
                    + (dot.base[0] / width_f * 6.28318 * 1.4 + seconds * 0.17).cos() * swell_size,
            ];
            let shimmer =
                ((seconds * (1.2 + 1.6 * dot.vibrance) + dot.vibrance * 41.0).sin() * 0.5 + 0.5)
                    * smoothstep(0.68, 1.0, dot.vibrance);
            let opacity = dot.opacity * (0.94 + shimmer * 0.1 + energy * 0.08);
            let half_size = radius + 0.72;
            let min_x = (center[0] - half_size).floor().max(0.0) as u32;
            let min_y = (center[1] - half_size).floor().max(0.0) as u32;
            let max_x = ((center[0] + half_size).ceil().max(0.0) as u32).min(width);
            let max_y = ((center[1] + half_size).ceil().max(0.0) as u32).min(height);
            for y in min_y..max_y {
                for x in min_x..max_x {
                    let pixel_x = x as f32 + 0.5;
                    let pixel_y = y as f32 + 0.5;
                    let distance = (pixel_x - center[0]).hypot(pixel_y - center[1]);
                    let alpha = ((1.0
                        - smoothstep((radius - 0.72).max(0.0), radius + 0.78, distance))
                        * opacity)
                        .min(1.0);
                    if alpha <= 0.0 {
                        continue;
                    }
                    let tint_amount = 0.12
                        + 0.14
                            * ((pixel_x / width_f * 5.0 + pixel_y / height_f * 3.0).sin() * 0.5
                                + 0.5);
                    let current = image.get_pixel_mut(x, y);
                    let old_alpha = f32::from(current.0[3]) / 255.0;
                    let output_alpha = alpha + old_alpha * (1.0 - alpha);
                    for channel in 0..3 {
                        let color =
                            primary[channel] + (tint[channel] - primary[channel]) * tint_amount;
                        let old_color = f32::from(current.0[2 - channel]) / 255.0;
                        current.0[2 - channel] =
                            ((color * alpha + old_color * old_alpha * (1.0 - alpha)) / output_alpha
                                * 255.0)
                                .round() as u8;
                    }
                    current.0[3] = (output_alpha * 255.0).round() as u8;
                }
            }
        }
        image
    }

    fn rebuild(&mut self, width: u32, height: u32, gap: f64) {
        self.width = width;
        self.height = height;
        self.gap = gap;
        self.dots.clear();
        self.waves.clear();
        self.cursor = None;
        self.cursor_velocity = [0.0; 2];
        self.cursor_strength = 0.0;
        let width = f64::from(width);
        let height = f64::from(height);
        let unit = width.min(height) * 0.65 / 1000.0;
        let margin =
            ((15.0_f64.max(width.min(height) / 10.0 * 0.13 + 2.0) + gap) / gap).ceil() as i32;
        let radius_scale = (gap / 4.0).powf(0.42).clamp(1.0, 1.42);
        let boundary = brand_boundary();
        for row in -margin..=(height / gap).ceil() as i32 + margin {
            for column in -margin..=(width / gap).ceil() as i32 + margin {
                let cell_x = f64::from(column);
                let cell_y = f64::from(row);
                let x = (cell_x + 0.5) * gap + (hash(cell_x + 53.0, cell_y + 53.0) - 0.5) * gap;
                let y = (cell_y + 0.5) * gap + (hash(cell_x + 193.0, cell_y + 193.0) - 0.5) * gap;
                let local_x = (x - width * 0.5) / unit;
                let local_y = (y - height * 0.5) / unit;
                let angle = local_y.atan2(local_x).rem_euclid(std::f64::consts::TAU);
                let radius =
                    boundary[(angle / std::f64::consts::TAU * 720.0).round() as usize % 720];
                let outer_radius = local_x.hypot(local_y) / radius;
                let amount = ((outer_radius - 0.93) / (1.1 - 0.93)).clamp(0.0, 1.0);
                let inside = 1.0 - amount * amount * (3.0 - 2.0 * amount);
                let texture = 0.92 + (x / width * 29.0).sin() * (y / height * 23.0).cos() * 0.08;
                if 0.018 + inside * 0.8 * texture < hash(cell_x + 719.0, cell_y + 719.0) {
                    continue;
                }
                let seed = hash(cell_x + 389.0, cell_y + 389.0);
                let base = [x as f32, y as f32];
                self.dots.push(Dot {
                    base,
                    position: base,
                    velocity: [0.0; 2],
                    opacity: (0.85 + seed * 0.15) as f32,
                    radius: (((0.35 + seed * 0.45) * (1.0 - inside)
                        + (0.65 + seed * 0.55) * inside)
                        * radius_scale) as f32,
                    vibrance: hash(cell_x + 941.0, cell_y + 941.0) as f32,
                    energy: 0.0,
                    active: false,
                });
                if self.dots.len() == 108_000 {
                    return;
                }
            }
        }
    }

    fn simulate(
        &mut self,
        elapsed: f32,
        seconds: f32,
        pointer: Option<[f32; 2]>,
        clicks: &[[f32; 2]],
    ) {
        let width = self.width as f32;
        let height = self.height as f32;
        let min_side = width.min(height);
        let diagonal = width.hypot(height);
        let target_strength = if pointer.is_some() { 1.0 } else { 0.0 };
        self.cursor_strength += (target_strength - self.cursor_strength)
            * (1.0 - (-elapsed / 1000.0 * if pointer.is_some() { 12.0 } else { 5.5 }).exp());
        if let Some(pointer) = pointer {
            let target = [pointer[0] * width, pointer[1] * height];
            if let Some(cursor) = self.cursor.as_mut() {
                let follow = 1.0 - (-elapsed / 1000.0 * 17.0).exp();
                let velocity_follow = 1.0 - (-elapsed / 1000.0 * 18.0).exp();
                for axis in 0..2 {
                    let next = cursor[axis] + (target[axis] - cursor[axis]) * follow;
                    self.cursor_velocity[axis] += ((next - cursor[axis]) / elapsed
                        - self.cursor_velocity[axis])
                        * velocity_follow;
                    cursor[axis] = next;
                }
            } else {
                self.cursor = Some(target);
            }
        } else {
            for velocity in &mut self.cursor_velocity {
                *velocity *= 0.82_f32.powf(elapsed / 16.667);
            }
        }
        let unit = min_side / 10.0;
        let wave_width = (unit * 0.58).clamp(48.0, 120.0);
        let impulse_radius = (wave_width * 1.28).clamp(62.0, 190.0);
        let impulse_force = ((unit * 0.044).clamp(3.1, 8.2) * 1.24).clamp(4.4, 13.5);
        for click in clicks.iter().rev().take(24) {
            let speed = (unit * 0.008).clamp(0.5, 1.0);
            self.waves.push(Wave {
                center: [click[0] * width, click[1] * height],
                started: seconds,
                speed,
                width: wave_width,
                force: (unit * 0.037).clamp(2.6, 7.0),
                life: diagonal / speed + 780.0,
                activated_radius: 0.0,
            });
        }
        self.waves
            .retain(|wave| (seconds - wave.started) * 1000.0 <= wave.life);
        if self.waves.len() > 24 {
            self.waves.drain(0..self.waves.len() - 24);
        }
        let waves: Vec<_> = self
            .waves
            .iter_mut()
            .map(|wave| {
                let age = (seconds - wave.started) * 1000.0;
                let front_radius = age * wave.speed;
                let activation_outer = front_radius + wave.width * 2.7;
                let activation_inner = (wave.activated_radius - wave.width * 5.6).max(0.0);
                wave.activated_radius = wave.activated_radius.max(activation_outer);
                WaveFrame {
                    center: wave.center,
                    front_radius,
                    width: wave.width,
                    force: wave.force,
                    envelope: (1.0 - age / wave.life).powf(1.12),
                    inner: (front_radius - wave.width * 6.6).max(0.0).powi(2),
                    outer: (front_radius + wave.width * 3.8).powi(2),
                    activation_inner: activation_inner.powi(2),
                    activation_outer: activation_outer.powi(2),
                }
            })
            .collect();
        let step = elapsed / 16.667;
        let damping = 0.87_f32.powf(step);
        let cursor_radius = (min_side * 0.066).clamp(42.0, 96.0);
        let cursor_limit = (cursor_radius * 2.35).powi(2);
        let cursor_push = (min_side * 0.00125).clamp(0.72, 1.9);
        let cursor_sweep = (min_side * 0.00014).clamp(0.07, 0.24);
        let cursor_velocity = [
            self.cursor_velocity[0] * 16.667,
            self.cursor_velocity[1] * 16.667,
        ];
        for dot in &mut self.dots {
            for click in clicks.iter().rev().take(24) {
                let offset = [
                    dot.base[0] - click[0] * width,
                    dot.base[1] - click[1] * height,
                ];
                let distance = offset[0].hypot(offset[1]);
                if distance > impulse_radius {
                    continue;
                }
                let direction = if distance > 0.001 {
                    [offset[0] / distance, offset[1] / distance]
                } else {
                    [(dot.vibrance * TAU).cos(), (dot.vibrance * TAU).sin()]
                };
                let falloff = (-(distance / impulse_radius).powi(2) * 1.85).exp();
                let noise = (dot.vibrance - 0.5) * impulse_force * falloff * 0.32;
                let impulse = impulse_force * falloff;
                dot.velocity[0] += direction[0] * impulse - direction[1] * noise;
                dot.velocity[1] += direction[1] * impulse + direction[0] * noise;
                dot.position[0] += direction[0] * impulse * 0.34;
                dot.position[1] += direction[1] * impulse * 0.34;
                dot.energy += falloff * 0.48;
                dot.active = true;
            }
            if let Some(cursor) = self.cursor.filter(|_| self.cursor_strength > 0.002) {
                if (dot.base[0] - cursor[0]).powi(2) + (dot.base[1] - cursor[1]).powi(2)
                    <= cursor_limit
                {
                    dot.active = true;
                }
            }
            for wave in &waves {
                let distance =
                    (dot.base[0] - wave.center[0]).powi(2) + (dot.base[1] - wave.center[1]).powi(2);
                if distance >= wave.activation_inner && distance <= wave.activation_outer {
                    dot.active = true;
                }
            }
            if !dot.active {
                continue;
            }
            let mut acceleration = [
                (dot.base[0] - dot.position[0]) * 0.032,
                (dot.base[1] - dot.position[1]) * 0.032,
            ];
            let mut local_energy = 0.0;
            if let Some(cursor) = self.cursor.filter(|_| self.cursor_strength > 0.002) {
                let offset = [dot.position[0] - cursor[0], dot.position[1] - cursor[1]];
                let distance = offset[0].hypot(offset[1]);
                if distance.powi(2) <= cursor_limit {
                    let direction = if distance > 0.001 {
                        [offset[0] / distance, offset[1] / distance]
                    } else {
                        [(dot.vibrance * TAU).cos(), (dot.vibrance * TAU).sin()]
                    };
                    let pressure =
                        (-(distance / cursor_radius).powi(2) * 1.38).exp() * self.cursor_strength;
                    let speed_pressure = (cursor_velocity[0].hypot(cursor_velocity[1])
                        / cursor_radius)
                        .clamp(0.0, 1.45);
                    let wake = (-(distance / cursor_radius).powi(2) * 0.62).exp()
                        * self.cursor_strength
                        * speed_pressure;
                    let swirl = (dot.vibrance - 0.5)
                        * pressure
                        * cursor_push
                        * (0.26 + speed_pressure * 0.16);
                    acceleration[0] +=
                        direction[0] * pressure * cursor_push * (1.0 + speed_pressure * 0.34)
                            + cursor_velocity[0] * wake * cursor_sweep
                            - direction[1] * swirl;
                    acceleration[1] +=
                        direction[1] * pressure * cursor_push * (1.0 + speed_pressure * 0.34)
                            + cursor_velocity[1] * wake * cursor_sweep
                            + direction[0] * swirl;
                    local_energy += pressure * (0.18 + speed_pressure * 0.14);
                }
            }
            for wave in &waves {
                let offset = [
                    dot.position[0] - wave.center[0],
                    dot.position[1] - wave.center[1],
                ];
                let distance = offset[0].hypot(offset[1]);
                if distance.powi(2) < wave.inner || distance.powi(2) > wave.outer {
                    continue;
                }
                let direction = if distance > 0.001 {
                    [offset[0] / distance, offset[1] / distance]
                } else {
                    [(dot.vibrance * TAU).cos(), (dot.vibrance * TAU).sin()]
                };
                let front = distance - wave.front_radius;
                let pulse = (-(front / wave.width).powi(2) * 0.38).exp() * wave.envelope;
                let aftershock =
                    (-((front + wave.width * 2.15) / (wave.width * 2.05)).powi(2) * 0.42).exp()
                        * wave.envelope;
                for axis in 0..2 {
                    acceleration[axis] +=
                        direction[axis] * (pulse * wave.force - aftershock * wave.force * 0.12);
                }
                local_energy += pulse * 0.24 + aftershock * 0.08;
            }
            for axis in 0..2 {
                dot.velocity[axis] = (dot.velocity[axis] + acceleration[axis] * step) * damping;
                dot.position[axis] += dot.velocity[axis] * step;
            }
            let speed = dot.velocity[0].hypot(dot.velocity[1]);
            let displacement = (dot.position[0] - dot.base[0]).hypot(dot.position[1] - dot.base[1]);
            let target = (local_energy + speed * 0.032 + displacement / diagonal * 2.3).max(0.0);
            let follow = 1.0
                - if target > dot.energy {
                    0.7_f32
                } else {
                    0.93_f32
                }
                .powf(step);
            dot.energy += (target - dot.energy) * follow;
            if speed + displacement * 0.04 + dot.energy <= 0.012 && local_energy <= 0.001 {
                dot.position = dot.base;
                dot.velocity = [0.0; 2];
                dot.energy = 0.0;
                dot.active = false;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn final_brand_boundary_is_asymmetric_and_closed() {
        let radii = brand_boundary();
        assert!(radii.iter().all(|radius| (250.0..450.0).contains(radius)));
        assert!((radii[0] - radii[360]).abs() < 0.2);
        assert!(radii[90] > radii[630] + 10.0);
    }

    #[test]
    fn pointer_impulse_moves_and_then_restores_particles() {
        let mut field = ParticleField::default();
        field.rebuild(480, 600, 4.0);
        assert!(field.dots.len() > 1000);
        field.simulate(16.667, 1.0, None, &[[0.5, 0.5]]);
        assert!(field.dots.iter().any(|dot| dot.position != dot.base));
        for index in 1..1200 {
            field.simulate(16.667, 1.0 + index as f32 / 60.0, None, &[]);
        }
        assert!(field.dots.iter().all(|dot| !dot.active));
    }
}
