use image::{Rgba, RgbaImage};

use super::smoothstep;

pub(super) struct Atmosphere {
    seed: [f32; 3],
    offset: f32,
    pointer: [f32; 2],
    strength: f32,
}

struct Globals {
    mood: f32,
    hardness: f32,
    thick: f32,
    drift: [f32; 2],
    phase: [f32; 3],
    amplitude: [f32; 2],
    rotation: [[f32; 2]; 3],
    layout: [f32; 2],
    grain_tick: f32,
    noise_a: NoisePlane,
    noise_b: NoisePlane,
    noise_tone: NoisePlane,
}

struct NoisePlane {
    values: Vec<[f32; 2]>,
    extent: i32,
    side: usize,
    fraction_z: f32,
}

impl NoisePlane {
    fn new(z: f32, aspect: f32) -> Self {
        let extent = (aspect * 3.0 + 6.0).ceil().max(16.0) as i32;
        let side = (extent * 2 + 1) as usize;
        let base_z = z.floor();
        let fz = z - base_z;
        let values = (0..side * side)
            .map(|index| {
                let x = (index % side) as i32 - extent;
                let y = (index / side) as i32 - extent;
                std::array::from_fn(|layer| {
                    let mut p = [
                        x as f32 * 0.1031,
                        y as f32 * 0.1031,
                        (base_z + layer as f32) * 0.1031,
                    ];
                    for value in &mut p {
                        *value -= value.floor();
                    }
                    let dot = p[0] * (p[2] + 31.32) + p[1] * (p[1] + 31.32) + p[2] * (p[0] + 31.32);
                    for value in &mut p {
                        *value += dot;
                    }
                    let value = (p[0] + p[1]) * p[2];
                    value - value.floor()
                })
            })
            .collect();
        Self {
            values,
            extent,
            side,
            fraction_z: fz * fz * (3.0 - 2.0 * fz),
        }
    }

    fn sample(&self, x: f32, y: f32) -> f32 {
        let ix = x.floor();
        let iy = y.floor();
        let fx = x - ix;
        let fy = y - iy;
        let fx = fx * fx * (3.0 - 2.0 * fx);
        let fy = fy * fy * (3.0 - 2.0 * fy);
        let offset =
            (iy as i32 + self.extent) as usize * self.side + (ix as i32 + self.extent) as usize;
        let layers: [f32; 2] = std::array::from_fn(|layer| {
            let a = self.values[offset][layer];
            let b = self.values[offset + 1][layer];
            let c = self.values[offset + self.side][layer];
            let d = self.values[offset + self.side + 1][layer];
            let bottom = a + (b - a) * fx;
            let top = c + (d - c) * fx;
            bottom + (top - bottom) * fy
        });
        layers[0] + (layers[1] - layers[0]) * self.fraction_z
    }
}

impl Atmosphere {
    pub(super) fn new() -> Self {
        let random = uuid::Uuid::new_v4();
        let bytes = random.as_bytes();
        let values: [f32; 4] = std::array::from_fn(|index| {
            let offset = index * 4;
            u32::from_le_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ]) as f32
                / u32::MAX as f32
        });
        Self {
            seed: [values[0], values[1], values[2]],
            offset: values[3] * 120.0,
            pointer: [0.5; 2],
            strength: 0.0,
        }
    }

    pub(super) fn render(
        &mut self,
        width: f32,
        height: f32,
        seconds: f32,
        pointer: Option<[f32; 2]>,
    ) -> RgbaImage {
        if let Some(pointer) = pointer {
            for axis in 0..2 {
                self.pointer[axis] += (pointer[axis] - self.pointer[axis]) * 0.1164;
            }
        }
        self.strength += (if pointer.is_some() { 1.0 } else { 0.0 } - self.strength) * 0.0975;
        let globals = self.globals(seconds + self.offset, width / height);
        // The light field is spatially smooth; keep shading off the UI thread and
        // bound its working set. GPUI samples the native texture when composing.
        let scale = (20_000.0 / (width * height)).sqrt().min(1.0);
        let pixel_width = (width * scale).round().max(1.0) as u32;
        let pixel_height = (height * scale).round().max(1.0) as u32;
        RgbaImage::from_fn(pixel_width, pixel_height, |x, y| {
            let color = self.shade(
                [
                    (x as f32 + 0.5) / pixel_width as f32,
                    1.0 - (y as f32 + 0.5) / pixel_height as f32,
                ],
                width / height,
                &globals,
            );
            let mut p = [
                (x as f32 + 0.5) / scale + globals.grain_tick * 17.0,
                (pixel_height as f32 - y as f32 - 0.5) / scale + globals.grain_tick * 17.0,
            ];
            p[0] *= 0.1031;
            p[1] *= 0.1031;
            p[0] -= p[0].floor();
            p[1] -= p[1].floor();
            let dot = p[0] * (p[1] + 33.33) + p[1] * (p[0] + 33.33) + p[0] * (p[0] + 33.33);
            let grain = (p[0] + dot + p[1] + dot) * (p[0] + dot);
            let grain = grain - grain.floor();
            let luma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
            let amount =
                (grain - 0.5) * (0.02 + (0.045 - 0.02) * smoothstep(0.02, 0.3, luma)) * 1.1;
            Rgba([
                (color[2] + amount).clamp(0.0, 1.0).mul_add(255.0, 0.5) as u8,
                (color[1] + amount).clamp(0.0, 1.0).mul_add(255.0, 0.5) as u8,
                (color[0] + amount).clamp(0.0, 1.0).mul_add(255.0, 0.5) as u8,
                255,
            ])
        })
    }

    fn globals(&self, seconds: f32, aspect: f32) -> Globals {
        let [sx, sy, sz] = self.seed;
        let t = seconds * 0.095 + sx * 40.0;
        let mood = noise([t * 0.22, sy, t * 0.16]);
        let detail = noise([sz + 1.2, t * 0.2, t * 0.18]);
        let hardness = 0.05 + 0.5 * smoothstep(0.42, 0.58, noise([t * 0.07 + sx, 2.1, sy]));
        let thick = (0.2 + 0.1 * noise([t * 0.08 + sz, 3.7, sy])) * (1.0 - 0.1 * hardness);
        let angles = [
            -0.22 + (sx - 0.5) * 0.55,
            0.48 + (sy - 0.5) * 0.7,
            -0.61 + (sz - 0.5) * 0.65,
        ];
        Globals {
            mood,
            hardness,
            thick,
            drift: [
                (noise([t * 0.4, sy, 1.0]) - 0.5) * 0.18,
                (noise([sz, t * 0.38, 2.0]) - 0.5) * 0.15,
            ],
            phase: [
                sx * 6.28318 + t * 1.42,
                sy * 6.28318 + t * 0.58 + 2.4,
                sz * 6.28318 - t * 1.95 - 1.1,
            ],
            amplitude: [0.12 + 0.30 * detail, 0.03 + 0.29 * detail],
            rotation: angles.map(|angle| [angle.cos(), angle.sin()]),
            layout: [(sx - 0.5) * 0.55, (sy - 0.5) * 0.55],
            grain_tick: (seconds * 3.0 + sx * 100.0).floor(),
            noise_a: NoisePlane::new(t * 0.14 + sy, aspect),
            noise_b: NoisePlane::new(t * 0.1 + sz + 2.0, aspect),
            noise_tone: NoisePlane::new(t * 0.12, aspect),
        }
    }

    fn shade(&self, uv: [f32; 2], aspect: f32, g: &Globals) -> [f32; 3] {
        let p = [(uv[0] - 0.5) * aspect, uv[1] - 0.5];
        let pointer = [
            p[0] - (self.pointer[0] - 0.5) * aspect,
            p[1] - (self.pointer[1] - 0.5),
        ];
        let influence = (-(pointer[0].powi(2) + pointer[1].powi(2)) * 14.0).exp() * self.strength;
        let q = [
            p[0] - g.layout[0] - pointer[1] * influence * 0.16,
            p[1] - g.layout[1] + pointer[0] * influence * 0.16,
        ];
        let [drift, drift2] = g.drift;
        let mut ambient = glow(q, [-0.25 + drift, -0.06 + drift2], [1.2, 0.8]) * 0.4
            + glow(q, [0.3 - drift2, 0.08 + drift], [0.95, 0.65]) * 0.28;
        let mut blue = glow(q, [0.5 + drift2, -drift], [0.55, 0.4]) * 0.75
            + glow(q, [0.18 - drift, -0.28], [0.36, 0.28]) * 0.45
            + glow(q, [-0.55 + drift, 0.22], [0.34, 0.26]) * (0.2 + 0.35 * g.mood)
            + glow(q, [0.72 + drift * 0.4, 0.32], [0.28, 0.22]) * 0.35
            + glow(q, [-0.2 - drift2, -0.4], [0.4, 0.2]) * 0.3;
        let blue_break = g.noise_a.sample(q[0] * 2.4 + drift, q[1] * 2.4 + drift) * 0.55
            + g.noise_b.sample(q[0] * 5.2 - drift2, q[1] * 5.2 - drift2) * 0.35;
        let blue_hole = glow(q, [-0.05 + drift2, 0.08], [0.55, 0.35]) * 0.4;
        blue *= 0.35 + 0.8 * blue_break;
        blue *= 1.0 - blue_hole * (0.25 + 0.3 * (1.0 - g.mood));
        blue = blue.clamp(0.0, 1.0);
        let a = ridge(
            [q[0] + drift * 0.5, q[1] + drift2],
            g.phase[0],
            g.thick,
            g.hardness,
            g.rotation[0],
            0.95,
        ) * 0.75;
        let b = ridge(
            [q[0] * 1.08 + 0.32, q[1] * 0.94 - 0.2],
            g.phase[1],
            g.thick * 1.12,
            g.hardness,
            g.rotation[1],
            0.68,
        ) * g.amplitude[0];
        let c = ridge(
            [q[0] * 0.9 - 0.36, q[1] * 1.14 + 0.22],
            g.phase[2],
            g.thick * 0.88,
            g.hardness,
            g.rotation[2],
            1.4,
        ) * g.amplitude[1];
        let bloom = glow(q, [-0.34 + drift, -0.1 + drift2], [0.58, 0.24]) * 0.6
            + glow(q, [-0.02 + drift2, 0.1], [0.36, 0.17]) * 0.4;
        let layers = a + (b + c * (1.0 - b)) * (1.0 - a);
        let mut highlight = ((layers + bloom * 0.55 * (1.0 - layers)) * 0.85).clamp(0.0, 1.0);
        let valley = glow(q, [0.1 + drift, -0.02], [0.4, 0.16]) * 0.65
            + glow(q, [-0.42, 0.2], [0.28, 0.12]) * 0.4;
        highlight *= 1.0 - valley * (0.35 + 0.2 * g.mood);
        let text_safe = glow(p, [0.0, 0.02], [0.7, 0.36]);
        highlight *= 1.0 - 0.7 * text_safe * 0.9;
        ambient *= 1.0 - 0.4 * text_safe * 0.65;
        let blue_amount = 0.4 + 0.45 * g.mood;
        let tone = g
            .noise_tone
            .sample(q[0] * 1.6 + self.seed[0], q[1] * 1.6 + self.seed[1]);
        let mut color = [0.045, 0.05, 0.06].map(|value| value * (ambient + 0.3).clamp(0.0, 1.0));
        let navy = [0.07, 0.09, 0.13];
        let dusty_blue = [0.15, 0.19, 0.27];
        let steel = [0.32, 0.36, 0.42];
        let white = [0.8, 0.82, 0.86];
        let navy_amount = (blue * 0.65 * blue_amount * (0.7 + 0.45 * tone)).clamp(0.0, 1.0);
        let dusty_amount = (blue * 0.28 * blue_amount * (0.5 + 0.7 * (1.0 - tone))).clamp(0.0, 1.0);
        let steel_amount = smoothstep(0.12, 0.5, highlight) * 0.55;
        let white_amount = smoothstep(0.32, 0.92, highlight).powf(1.5 + 0.8 * g.hardness);
        let edge =
            smoothstep(0.0, 0.1, uv[0].min(1.0 - uv[0])) * smoothstep(0.0, 0.14, 1.0 - uv[1]);
        for axis in 0..3 {
            color[axis] += (navy[axis] - color[axis]) * navy_amount;
            color[axis] += (dusty_blue[axis] - color[axis]) * dusty_amount;
            color[axis] += (steel[axis] - color[axis]) * steel_amount;
            color[axis] += (white[axis] - color[axis]) * white_amount;
            color[axis] *= 0.88 + 0.12 * edge;
        }
        color
    }
}

fn glow(point: [f32; 2], center: [f32; 2], radius: [f32; 2]) -> f32 {
    let x = (point[0] - center[0]) / radius[0];
    let y = (point[1] - center[1]) / radius[1];
    (-(x * x + y * y)).exp()
}

fn ridge(
    point: [f32; 2],
    phase: f32,
    thickness: f32,
    hardness: f32,
    rotation: [f32; 2],
    frequency: f32,
) -> f32 {
    let x = rotation[0] * point[0] + rotation[1] * point[1];
    let y = -rotation[1] * point[0] + rotation[0] * point[1];
    let fold = y
        - (-0.1
            + 0.3 * (x * (1.15 * frequency) + phase).sin()
            + 0.12 * (x * (2.35 * frequency) + phase * 1.7).sin()
            + 0.05 * (x * (4.2 * frequency) - phase * 0.65).sin());
    let soft = (-(fold * fold) / (thickness * thickness).max(0.0001)).exp();
    let sharp =
        (0.45 + (7.0 - 0.45) * hardness.clamp(0.0, 1.0)).min(thickness * thickness / (0.14 * 0.14));
    soft.powf(sharp)
}

fn noise(point: [f32; 3]) -> f32 {
    let base = point.map(f32::floor);
    let fraction = point.map(|value| {
        let f = value - value.floor();
        f * f * (3.0 - 2.0 * f)
    });
    let samples: [f32; 8] = std::array::from_fn(|index| {
        let mut p: [f32; 3] = std::array::from_fn(|axis| {
            let value = (base[axis] + ((index >> axis) & 1) as f32) * 0.1031;
            value - value.floor()
        });
        let dot = p[0] * (p[2] + 31.32) + p[1] * (p[1] + 31.32) + p[2] * (p[0] + 31.32);
        for channel in &mut p {
            *channel += dot;
        }
        let value = (p[0] + p[1]) * p[2];
        value - value.floor()
    });
    let x00 = samples[0] + (samples[1] - samples[0]) * fraction[0];
    let x10 = samples[2] + (samples[3] - samples[2]) * fraction[0];
    let x01 = samples[4] + (samples[5] - samples[4]) * fraction[0];
    let x11 = samples[6] + (samples[7] - samples[6]) * fraction[0];
    let xy0 = x00 + (x10 - x00) * fraction[1];
    let xy1 = x01 + (x11 - x01) * fraction[1];
    xy0 + (xy1 - xy0) * fraction[2]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_noise_lattice_preserves_shader_samples() {
        let plane = NoisePlane::new(3.73, 1.6);
        for x in [-6.2, -1.5, -0.1, 0.0, 1.33, 6.7] {
            for y in [-3.7, -0.3, 0.0, 1.26, 3.4] {
                assert!((plane.sample(x, y) - noise([x, y, 3.73])).abs() < 0.000_001);
            }
        }
    }

    #[test]
    fn atmosphere_is_deterministic_with_a_fixed_session() {
        let mut field = Atmosphere {
            seed: [0.2, 0.4, 0.6],
            offset: 12.0,
            pointer: [0.5; 2],
            strength: 0.0,
        };
        let image = field.render(700.0, 900.0, 1.0, None);
        assert!(image.width() * image.height() <= 20_300);
        let first = image.clone();
        assert_eq!(first, field.render(700.0, 900.0, 1.0, None));
        assert_ne!(first, field.render(700.0, 900.0, 2.0, None));
        assert!(image.pixels().all(|pixel| pixel.0[3] == 255));
    }
}
