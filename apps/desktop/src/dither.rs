use std::cell::RefCell;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use gpui::{
    Bounds, Corners, Hsla, IntoElement, MouseButton, Pixels, RenderImage, Rgba, canvas, div,
    prelude::*, px,
};
use image::{Frame, Rgba as ImageRgba, RgbaImage};

#[path = "atmosphere.rs"]
mod atmosphere;
#[path = "particles.rs"]
mod particles;

struct DitherCache {
    key: (u32, u32, u32, bool),
    image: Arc<RenderImage>,
}

struct AuthFrame {
    atmosphere: Arc<RenderImage>,
    particles: Arc<RenderImage>,
}

struct AuthRequest {
    width: f32,
    height: f32,
    scale: f32,
    seconds: f32,
    primary: [f32; 3],
    dark: bool,
    pointer: Option<[f32; 2]>,
    clicks: Vec<[f32; 2]>,
}

struct AuthRenderer {
    request: mpsc::SyncSender<AuthRequest>,
    completed: mpsc::Receiver<AuthFrame>,
    current: Option<AuthFrame>,
    started: Instant,
    last_request: Option<Instant>,
    last_configuration: Option<(u32, u32, u32, bool, bool)>,
    pending: bool,
    frame_scheduled: bool,
    bounds: Bounds<Pixels>,
    clicks: Vec<[f32; 2]>,
}

thread_local! {
    static DITHER_CACHE: RefCell<Vec<DitherCache>> = const { RefCell::new(Vec::new()) };
    static AUTH_RENDERER: RefCell<Option<AuthRenderer>> = const { RefCell::new(None) };
}

pub fn workspace_dither(_color: Hsla, dark: bool) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let width = f32::from(bounds.size.width).max(1.0);
            let height = f32::from(bounds.size.height).max(1.0);
            let scale = window.scale_factor().min(2.0);
            let key = (width.to_bits(), height.to_bits(), scale.to_bits(), dark);
            DITHER_CACHE.with_borrow_mut(|cache| {
                let image = if let Some(entry) = cache.iter().find(|entry| entry.key == key) {
                    Arc::clone(&entry.image)
                } else {
                    let image = Arc::new(RenderImage::new([Frame::new(raster_dither(
                        width, height, scale, dark,
                    ))]));
                    if cache.len() == 4 {
                        let expired = cache.remove(0);
                        let _ = window.drop_image(expired.image);
                    }
                    cache.push(DitherCache {
                        key,
                        image: Arc::clone(&image),
                    });
                    image
                };
                let _ = window.paint_image(bounds, Corners::all(px(0.0)), image, 0, false);
            });
        },
    )
    .size_full()
}

fn raster_dither(width: f32, height: f32, scale: f32, dark: bool) -> RgbaImage {
    let pixel_width = (width * scale).ceil() as u32;
    let pixel_height = (height * scale).ceil() as u32;
    let mut image = RgbaImage::new(pixel_width, pixel_height);
    let step = 3.0;
    let columns = (width / step).ceil();
    let rows = (height / step).ceil();
    let drift_x = 1.7_f32.sin() * 0.018;
    let drift_y = 0.03 + 0.8_f32.cos() * 0.015;
    let strength = if dark { 0.55 } else { 2.0 * 0.25 };
    let strength_wave = 1.0 + 0.6_f32.sin() * 0.06;
    for row in 0..=rows as u32 {
        let vertical = row as f32 / rows.max(1.0);
        let edge = smoothstep(0.0, 0.14, vertical) * smoothstep(0.0, 0.14, 1.0 - vertical);
        for column in 0..=columns as u32 {
            let hx = (column as f32 / columns.max(1.0) + drift_x).clamp(0.0, 1.0);
            let vy = (vertical + drift_y).clamp(0.0, 1.0);
            let base = ((1.0 - hx + vy) * 0.5).clamp(0.0, 1.0).powf(1.28)
                + (hx * 13.5 + vy * 6.5).sin() * 0.06
                + (hx * 5.5 - vy * 15.0).sin() * 0.035;
            let density = base.clamp(0.0, 1.0) * edge;
            let seed = (column as f32 * 127.1 + row as f32 * 311.7).sin() * 43_758.547;
            if seed - seed.floor() > density * 1.03 - 0.06 {
                continue;
            }
            let seed =
                ((column as f32 + 53.0) * 127.1 + (row as f32 + 97.0) * 311.7).sin() * 43_758.547;
            let radius = 0.12 + density.powf(1.35) * (0.42 + (seed - seed.floor()) * 0.1);
            let alpha = (0.08 + density.powf(1.18) * 0.32) * strength * strength_wave;
            let center = [column as f32 * step, row as f32 * step];
            let min_x = ((center[0] - radius - 0.5) * scale).floor().max(0.0) as u32;
            let min_y = ((center[1] - radius - 0.5) * scale).floor().max(0.0) as u32;
            let max_x = (((center[0] + radius + 0.5) * scale).ceil() as u32).min(pixel_width);
            let max_y = (((center[1] + radius + 0.5) * scale).ceil() as u32).min(pixel_height);
            for y in min_y..max_y {
                for x in min_x..max_x {
                    let distance = ((x as f32 + 0.5) / scale - center[0])
                        .hypot((y as f32 + 0.5) / scale - center[1]);
                    let coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, distance);
                    let value = if dark { 255 } else { 0 };
                    image.put_pixel(
                        x,
                        y,
                        ImageRgba([
                            value,
                            value,
                            value,
                            (alpha * coverage * 255.0).round() as u8,
                        ]),
                    );
                }
            }
        }
    }
    image
}

pub fn auth_visual(primary: Hsla, dark: bool, reduced_motion: bool) -> impl IntoElement {
    div()
        .id("auth-native-visual")
        .size_full()
        .overflow_hidden()
        .on_mouse_down(MouseButton::Left, move |event, window, _| {
            if reduced_motion {
                return;
            }
            AUTH_RENDERER.with_borrow_mut(|state| {
                if let Some(state) = state.as_mut() {
                    let offset = event.position - state.bounds.origin;
                    state.clicks.push([
                        f32::from(offset.x) / f32::from(state.bounds.size.width).max(1.0),
                        f32::from(offset.y) / f32::from(state.bounds.size.height).max(1.0),
                    ]);
                }
            });
            window.request_animation_frame();
        })
        .child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, cx| {
                    AUTH_RENDERER.with_borrow_mut(|state| {
                        let state = state.get_or_insert_with(|| {
                            let (request_tx, request_rx) = mpsc::sync_channel::<AuthRequest>(1);
                            let (complete_tx, complete_rx) = mpsc::sync_channel(1);
                            std::thread::Builder::new()
                                .name("quieter-auth-visual".into())
                                .spawn(move || {
                                    let mut field = particles::ParticleField::default();
                                    let mut atmosphere = atmosphere::Atmosphere::new();
                                    while let Ok(request) = request_rx.recv() {
                                        let background = atmosphere.render(
                                            request.width,
                                            request.height,
                                            request.seconds,
                                            request.pointer,
                                        );
                                        let dots = field.render(
                                            request.width,
                                            request.height,
                                            request.scale,
                                            request.seconds,
                                            request.primary,
                                            request.dark,
                                            request.pointer,
                                            &request.clicks,
                                        );
                                        let frame = AuthFrame {
                                            atmosphere: Arc::new(RenderImage::new([Frame::new(
                                                background,
                                            )])),
                                            particles: Arc::new(RenderImage::new([Frame::new(
                                                dots,
                                            )])),
                                        };
                                        if complete_tx.send(frame).is_err() {
                                            break;
                                        }
                                    }
                                })
                                .expect("failed to start native visual worker");
                            AuthRenderer {
                                request: request_tx,
                                completed: complete_rx,
                                current: None,
                                started: Instant::now(),
                                last_request: None,
                                last_configuration: None,
                                pending: false,
                                frame_scheduled: false,
                                bounds,
                                clicks: Vec::new(),
                            }
                        });
                        state.bounds = bounds;
                        if let Ok(frame) = state.completed.try_recv() {
                            if let Some(previous) = state.current.replace(frame) {
                                let _ = window.drop_image(previous.atmosphere);
                                let _ = window.drop_image(previous.particles);
                            }
                            state.pending = false;
                        }
                        let now = Instant::now();
                        let configuration = (
                            f32::from(bounds.size.width).to_bits(),
                            f32::from(bounds.size.height).to_bits(),
                            window.scale_factor().to_bits(),
                            dark,
                            reduced_motion,
                        );
                        if !state.pending
                            && (window.is_window_active()
                                || state.current.is_none()
                                || state.last_configuration != Some(configuration))
                            && (!reduced_motion || state.last_configuration != Some(configuration))
                            && state.last_request.is_none_or(|last| {
                                now.duration_since(last) >= Duration::from_millis(41)
                            })
                        {
                            let offset = window.mouse_position() - bounds.origin;
                            let width = f32::from(bounds.size.width).max(1.0);
                            let height = f32::from(bounds.size.height).max(1.0);
                            let pointer =
                                [f32::from(offset.x) / width, f32::from(offset.y) / height];
                            let primary: Rgba = primary.into();
                            let request = AuthRequest {
                                width,
                                height,
                                scale: window.scale_factor(),
                                seconds: if reduced_motion {
                                    0.0
                                } else {
                                    state.started.elapsed().as_secs_f32()
                                },
                                primary: [primary.r, primary.g, primary.b],
                                dark,
                                pointer: (!reduced_motion
                                    && window.is_window_active()
                                    && pointer.iter().all(|value| (0.0..=1.0).contains(value)))
                                .then_some(pointer),
                                clicks: std::mem::take(&mut state.clicks),
                            };
                            if state.request.try_send(request).is_ok() {
                                state.pending = true;
                                state.last_request = Some(now);
                                state.last_configuration = Some(configuration);
                            }
                        }
                        if let Some(frame) = &state.current {
                            let _ = window.paint_image(
                                bounds,
                                Corners::all(px(0.0)),
                                Arc::clone(&frame.atmosphere),
                                0,
                                false,
                            );
                            let _ = window.paint_image(
                                bounds,
                                Corners::all(px(0.0)),
                                Arc::clone(&frame.particles),
                                0,
                                false,
                            );
                        }
                        if ((!reduced_motion && window.is_window_active())
                            || state.pending
                            || state.current.is_none())
                            && !state.frame_scheduled
                        {
                            state.frame_scheduled = true;
                            let entity = window.current_view();
                            window
                                .spawn(cx, async move |cx| {
                                    cx.background_executor()
                                        .timer(Duration::from_millis(42))
                                        .await;
                                    let _ = cx.update(|_, cx| {
                                        AUTH_RENDERER.with_borrow_mut(|state| {
                                            if let Some(state) = state {
                                                state.frame_scheduled = false;
                                            }
                                        });
                                        cx.notify(entity);
                                    });
                                })
                                .detach();
                        }
                    });
                },
            )
            .size_full(),
        )
}

fn smoothstep(edge_0: f32, edge_1: f32, value: f32) -> f32 {
    let amount = ((value - edge_0) / (edge_1 - edge_0)).clamp(0.0, 1.0);
    amount * amount * (3.0 - 2.0 * amount)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dither_matches_web_spacing_and_fades_at_seams() {
        let pixels = raster_dither(240.0, 180.0, 2.0, true);
        assert!(pixels.rows().next().unwrap().all(|pixel| pixel.0[3] == 0));
        assert!(pixels.rows().last().unwrap().all(|pixel| pixel.0[3] == 0));
        let left: u32 = pixels
            .enumerate_pixels()
            .filter(|(x, y, _)| *x < 120 && *y > 180)
            .map(|(_, _, p)| u32::from(p.0[3]))
            .sum();
        let right: u32 = pixels
            .enumerate_pixels()
            .filter(|(x, y, _)| *x > 360 && *y < 180)
            .map(|(_, _, p)| u32::from(p.0[3]))
            .sum();
        assert!(
            left > right * 2,
            "default web dither must anchor bottom-left"
        );
    }
}
