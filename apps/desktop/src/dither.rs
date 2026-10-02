use std::cell::RefCell;
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use gpui::{
    Bounds, Corners, Hsla, IntoElement, MouseButton, Pixels, RenderImage, Rgba, canvas, div,
    prelude::*, px,
};
use image::Frame;

#[path = "particles.rs"]
mod particles;

struct AuthFrame {
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
    static AUTH_RENDERER: RefCell<Option<AuthRenderer>> = const { RefCell::new(None) };
}

pub fn auth_visual(primary: Hsla, dark: bool, reduced_motion: bool) -> impl IntoElement {
    div()
        .id("auth-native-visual")
        .size_full()
        .overflow_hidden()
        .bg(gpui::rgb(0x0a0a0a))
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
                                    while let Ok(request) = request_rx.recv() {
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
