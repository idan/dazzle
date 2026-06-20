//! pixel64 — RP2350 / Pico 2 W skeleton.
//!
//! Bring-up milestone 1: prove the no-probe dev loop end to end — flash over USB (BOOTSEL UF2)
//! and read `log` output back over USB-serial on the *same* cable. No cyw43, no panel yet; those
//! land as the modules are ported. See docs/pico-port.md for the full plan + milestones.

#![no_std]
#![no_main]

use embassy_executor::Spawner;
use embassy_rp::bind_interrupts;
use embassy_rp::peripherals::USB;
use embassy_rp::usb::{Driver, InterruptHandler};
use embassy_time::Timer;
use log::info;

// Program metadata for `picotool info`. Optional; the embassy-rp `binary-info` feature also emits
// the RP2350 boot image-def block (.start_block) on its own, so no manual `ImageDef` is needed.
#[unsafe(link_section = ".bi_entries")]
#[used]
pub static PICOTOOL_ENTRIES: [embassy_rp::binary_info::EntryAddr; 3] = [
    embassy_rp::binary_info::rp_program_name!(c"pixel64"),
    embassy_rp::binary_info::rp_cargo_version!(),
    embassy_rp::binary_info::rp_program_build_attribute!(),
];

bind_interrupts!(struct Irqs {
    USBCTRL_IRQ => InterruptHandler<USB>;
});

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    // Without a probe there's no defmt/RTT to print to; just halt. (A panic before USB enumerates
    // is invisible over USB-serial — a known no-probe limitation, see docs/pico-port.md.)
    loop {}
}

/// Runs the USB device + CDC-ACM serial class and pumps `log` records out over it.
#[embassy_executor::task]
async fn logger_task(driver: Driver<'static, USB>) {
    embassy_usb_logger::run!(1024, log::LevelFilter::Info, driver);
}

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    let p = embassy_rp::init(Default::default());

    let driver = Driver::new(p.USB, Irqs);
    // embassy-executor 0.10: #[task] returns Result<SpawnToken, _>; unwrap it, then spawn.
    spawner.spawn(logger_task(driver).unwrap());

    let mut tick: u32 = 0;
    loop {
        info!("pixel64 RP2350 skeleton alive — tick {}", tick);
        tick = tick.wrapping_add(1);
        Timer::after_secs(1).await;
    }
}
