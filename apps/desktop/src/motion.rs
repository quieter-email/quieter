use std::time::{Duration, Instant};

use gpui::Animation;

pub const LAYOUT: Duration = Duration::from_millis(280);
pub const FEEDBACK: Duration = Duration::from_millis(160);

pub fn animation(duration: Duration, reduced_motion: bool) -> Animation {
    if reduced_motion {
        Animation::new(Duration::from_millis(1)).with_easing(|_| 1.0)
    } else {
        Animation::new(duration).with_easing(ease)
    }
}

pub fn ease(progress: f32) -> f32 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    // Invert the x component of the web cubic-bezier(.23, 1, .32, 1).
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..18 {
        let t = (low + high) * 0.5;
        let s = 1.0 - t;
        let x = 3.0 * s * s * t * 0.23 + 3.0 * s * t * t * 0.32 + t * t * t;
        if x < progress {
            low = t;
        } else {
            high = t;
        }
    }
    let t = (low + high) * 0.5;
    1.0 - (1.0_f32 - t).powi(3)
}

pub struct MotionValue {
    from: f32,
    to: f32,
    started: Instant,
    duration: Duration,
}

impl MotionValue {
    pub fn new(value: f32) -> Self {
        Self {
            from: value,
            to: value,
            started: Instant::now(),
            duration: FEEDBACK,
        }
    }

    pub fn retarget(&mut self, target: f32, duration: Duration, reduced_motion: bool) {
        if self.to == target {
            return;
        }
        self.from = self.sample().0;
        self.to = target;
        self.started = Instant::now();
        self.duration = if reduced_motion {
            Duration::ZERO
        } else {
            duration
        };
    }

    pub fn sample(&self) -> (f32, bool) {
        if self.from == self.to || self.duration.is_zero() {
            return (self.to, false);
        }
        let progress = self.started.elapsed().as_secs_f32() / self.duration.as_secs_f32();
        (
            self.from + (self.to - self.from) * ease(progress),
            progress < 1.0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn easing_inverts_time_and_is_monotonic() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert!((ease(0.33125) - 0.875).abs() < 0.0001);
        for index in 1..100 {
            assert!(ease(index as f32 / 100.0) > ease((index - 1) as f32 / 100.0));
        }
    }

    #[test]
    fn interrupted_transition_starts_at_current_position() {
        let mut motion = MotionValue::new(0.0);
        motion.retarget(1.0, Duration::from_secs(1), false);
        motion.started -= Duration::from_millis(300);
        let before = motion.sample().0;
        motion.retarget(0.0, FEEDBACK, false);
        assert!((motion.sample().0 - before).abs() < 0.001);
        motion.retarget(1.0, FEEDBACK, true);
        assert_eq!(motion.sample(), (1.0, false));
    }
}
