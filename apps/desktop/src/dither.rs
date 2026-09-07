use gpui::prelude::Styled as _;
use gpui::{Bounds, Corners, Hsla, IntoElement, Pixels, Window, canvas, fill, point, px, size};

fn hash(x: f32, y: f32) -> f32 {
    ((x * 127.1 + y * 311.7).sin() * 43_758.547).fract().abs()
}

fn smoothstep(edge_0: f32, edge_1: f32, value: f32) -> f32 {
    let amount = ((value - edge_0) / (edge_1 - edge_0)).clamp(0.0, 1.0);
    amount * amount * (3.0 - 2.0 * amount)
}

pub fn workspace_dither(color: Hsla, dark: bool) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window: &mut Window, _| {
            let width = f32::from(bounds.size.width).max(1.0);
            let height = f32::from(bounds.size.height).max(1.0);
            let step = 6.0_f32;
            let columns = (width / step).ceil() as usize;
            let rows = (height / step).ceil() as usize;
            let strength = if dark { 0.20 } else { 0.34 };

            for row in 0..=rows {
                let vertical = row as f32 / rows.max(1) as f32;
                let edge = smoothstep(0.0, 0.14, vertical) * smoothstep(0.0, 0.14, 1.0 - vertical);
                for column in 0..=columns {
                    let horizontal = column as f32 / columns.max(1) as f32;
                    let lower_left = ((1.0 - horizontal + vertical) * 0.5).clamp(0.0, 1.0);
                    let upper_right = ((horizontal + 1.0 - vertical) * 0.5).clamp(0.0, 1.0);
                    let base = lower_left.max(upper_right).powf(1.28);
                    let waves = (horizontal * 13.5 + vertical * 6.5).sin() * 0.06
                        + (horizontal * 5.5 - vertical * 15.0).sin() * 0.035;
                    let density = (base + waves).clamp(0.0, 1.0) * edge;
                    if hash(column as f32, row as f32) > density * 1.03 - 0.06 {
                        continue;
                    }

                    let jitter = hash(column as f32 + 53.0, row as f32 + 97.0);
                    let radius = 0.3 + density.powf(1.35) * (0.6 + jitter * 0.18);
                    let mut dot = color;
                    dot.a = (0.08 + density.powf(1.18) * strength).min(0.42);
                    let center =
                        bounds.origin + point(px(column as f32 * step), px(row as f32 * step));
                    window.paint_quad(
                        fill(
                            Bounds {
                                origin: center - point(px(radius), px(radius)),
                                size: size(px(radius * 2.0), px(radius * 2.0)),
                            },
                            dot,
                        )
                        .corner_radii(Corners::all(px(radius))),
                    );
                }
            }
        },
    )
    .size_full()
}

pub fn particle_mark(color: Hsla, elapsed_seconds: f32) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window: &mut Window, _| {
            let width = f32::from(bounds.size.width).max(1.0);
            let height = f32::from(bounds.size.height).max(1.0);
            let step = 5.2_f32;
            let columns = (width / step).ceil() as usize;
            let rows = (height / step).ceil() as usize;
            let unit = width.min(height) / 10.0;
            let base_radius = 2.0_f32.powf(0.25) * unit * 2.0;
            let scales = [(1.0_f32, 1.0_f32), (0.9, 0.8), (0.8, 0.6), (0.7, 0.4)];
            let pulse = 0.96 + (elapsed_seconds * 1.4).sin() * 0.04;

            for row in 0..=rows {
                for column in 0..=columns {
                    let seed_x = column as f32;
                    let seed_y = row as f32;
                    let x = (seed_x + 0.5) * step + (hash(seed_x, seed_y) - 0.5) * step * 0.38;
                    let y =
                        (seed_y + 0.5) * step + (hash(seed_y + 71.0, seed_x) - 0.5) * step * 0.38;
                    let offset_x = x - width * 0.5;
                    let offset_y = y - height * 0.5;
                    let rotated_x = (offset_x + offset_y) * std::f32::consts::FRAC_1_SQRT_2;
                    let rotated_y = (-offset_x + offset_y) * std::f32::consts::FRAC_1_SQRT_2;

                    let mut best_opacity = 0.0_f32;
                    let mut best_radius = 0.0_f32;
                    for (layer, (scale, opacity)) in scales.into_iter().enumerate() {
                        let local_x = rotated_x / scale;
                        let local_y = rotated_y / scale;
                        let radial = ((local_x.abs() / base_radius).powf(3.25)
                            + (local_y.abs() / base_radius).powf(3.25))
                        .powf(1.0 / 3.25);
                        let half_width = (unit * 0.22 * 2.0) / base_radius / 2.0;
                        let distance = (radial - 1.0).abs();
                        if distance > half_width {
                            continue;
                        }
                        let edge_amount =
                            (1.0 - (half_width - distance) / half_width).clamp(0.0, 1.0);
                        let edge_strength = edge_amount.powf(0.35);
                        let density = if edge_amount > 0.62 {
                            1.0
                        } else {
                            0.12 + edge_strength * 0.58
                        };
                        if hash(seed_x + layer as f32 * 101.0, seed_y + layer as f32 * 211.0)
                            > density
                        {
                            continue;
                        }
                        let shimmer = ((elapsed_seconds * (1.2 + hash(seed_x, seed_y) * 1.6)
                            + hash(seed_y, seed_x) * 41.0)
                            .sin()
                            * 0.5
                            + 0.5)
                            * 0.08;
                        best_opacity = best_opacity
                            .max(opacity * (0.12 + edge_strength * 0.88) * pulse + shimmer);
                        best_radius = best_radius.max((0.45 + edge_strength * 1.35) * scale);
                    }

                    if best_opacity <= 0.0 {
                        continue;
                    }
                    let mut dot = color;
                    dot.a = best_opacity.min(1.0);
                    let radius = best_radius.max(0.35);
                    let center = bounds.origin + point(px(x), px(y));
                    window.paint_quad(
                        fill(
                            Bounds {
                                origin: center - point(px(radius), px(radius)),
                                size: size(px(radius * 2.0), px(radius * 2.0)),
                            },
                            dot,
                        )
                        .corner_radii(Corners::<Pixels>::all(px(radius))),
                    );
                }
            }
        },
    )
    .size_full()
}
