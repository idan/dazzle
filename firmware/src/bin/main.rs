//! pixel64 — RP2350 / Pico 2 W.
//!
//! Bring-up milestone 2a: cyw43 Wi-Fi STA join + DHCP — the device gets online and shows its IP
//! (like the ESP build did), proving the radio's Wi-Fi path on the new HAL. Credentials come from
//! the `WIFI_SSID` / `WIFI_PASS` compile-time env vars so nothing secret lands in the repo:
//!
//!     env WIFI_SSID="YourNetwork" WIFI_PASS="yourpassword" cargo run
//!
//! Status is logged over USB-serial; a solid onboard LED means online. See docs/pico-port.md.

#![no_std]
#![no_main]

use cyw43::JoinOptions;
use cyw43_pio::{PioSpi, RM2_CLOCK_DIVIDER};
use embassy_executor::Spawner;
use embassy_net::{Config as NetConfig, Runner as NetRunner, StackResources};
use embassy_rp::bind_interrupts;
use embassy_rp::clocks::RoscRng;
use embassy_rp::dma::{Channel, InterruptHandler as DmaInterruptHandler};
use embassy_rp::gpio::{Level, Output};
use embassy_rp::peripherals::{DMA_CH0, PIO0, USB};
use embassy_rp::pio::{InterruptHandler as PioInterruptHandler, Pio};
use embassy_rp::usb::{Driver, InterruptHandler as UsbInterruptHandler};
use embassy_time::Timer;
use log::{info, warn};
use static_cell::StaticCell;

// Wi-Fi credentials, baked at compile time from env vars (kept out of source/git). See module docs.
const WIFI_SSID: &str = env!(
    "WIFI_SSID",
    "WIFI_SSID not set — build with: env WIFI_SSID=… WIFI_PASS=… cargo run"
);
const WIFI_PASS: &str = env!(
    "WIFI_PASS",
    "WIFI_PASS not set — build with: env WIFI_SSID=… WIFI_PASS=… cargo run"
);

// Program metadata for `picotool info`. The embassy-rp `binary-info` feature emits the RP2350 boot
// image-def block (.start_block) on its own, so no manual `ImageDef` is needed.
#[unsafe(link_section = ".bi_entries")]
#[used]
pub static PICOTOOL_ENTRIES: [embassy_rp::binary_info::EntryAddr; 3] = [
    embassy_rp::binary_info::rp_program_name!(c"pixel64"),
    embassy_rp::binary_info::rp_cargo_version!(),
    embassy_rp::binary_info::rp_program_build_attribute!(),
];

bind_interrupts!(struct Irqs {
    USBCTRL_IRQ => UsbInterruptHandler<USB>;
    PIO0_IRQ_0 => PioInterruptHandler<PIO0>;
    DMA_IRQ_0 => DmaInterruptHandler<DMA_CH0>;
});

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    // No probe → no defmt/RTT; just halt. (A panic before USB enumerates is invisible over
    // USB-serial — a known no-probe limitation, see docs/pico-port.md.)
    loop {}
}

/// Runs the USB device + CDC-ACM serial class and pumps `log` records out over it.
#[embassy_executor::task]
async fn logger_task(driver: Driver<'static, USB>) {
    embassy_usb_logger::run!(1024, log::LevelFilter::Info, driver);
}

/// Drives the cyw43 chip's low-level SPI event loop (Wi-Fi + BLE traffic). Runs forever.
#[embassy_executor::task]
async fn cyw43_task(
    runner: cyw43::Runner<'static, cyw43::SpiBus<Output<'static>, PioSpi<'static, PIO0, 0>>>,
) -> ! {
    runner.run().await
}

/// Drives the embassy-net IP stack (DHCP, etc.). Runs forever.
#[embassy_executor::task]
async fn net_task(mut runner: NetRunner<'static, cyw43::NetDriver<'static>>) -> ! {
    runner.run().await
}

#[embassy_executor::main]
async fn main(spawner: Spawner) {
    let p = embassy_rp::init(Default::default());

    // USB-serial logging on the same cable that flashes the board.
    let driver = Driver::new(p.USB, Irqs);
    spawner.spawn(logger_task(driver).unwrap());

    info!("pixel64: bringing up cyw43 radio…");

    // cyw43 firmware blobs (vendored). `fw` + `nvram` need 4-byte alignment (aligned_bytes!);
    // `clm` is passed to control.init() as a plain slice.
    let fw = cyw43::aligned_bytes!("../../cyw43-firmware/43439A0.bin");
    let nvram = cyw43::aligned_bytes!("../../cyw43-firmware/nvram_rp2040.bin");
    let clm: &[u8] = include_bytes!("../../cyw43-firmware/43439A0_clm.bin");

    // CYW43439 on GP23 (power) + PIO-emulated SPI on GP24/25/29 — fixed by the board wiring (see
    // docs/pico-pinout.md). PIO0 + DMA_CH0 are dedicated to it.
    let pwr = Output::new(p.PIN_23, Level::Low);
    let cs = Output::new(p.PIN_25, Level::High);
    let Pio {
        mut common,
        sm0,
        irq0,
        ..
    } = Pio::new(p.PIO0, Irqs);
    let spi = PioSpi::new(
        &mut common,
        sm0,
        RM2_CLOCK_DIVIDER,
        irq0,
        cs,
        p.PIN_24, // DIO
        p.PIN_29, // CLK
        Channel::new(p.DMA_CH0, Irqs),
    );

    static STATE: StaticCell<cyw43::State> = StaticCell::new();
    let state = STATE.init(cyw43::State::new());
    let (net_device, mut control, runner) = cyw43::new(state, pwr, spi, fw, nvram).await;
    spawner.spawn(cyw43_task(runner).unwrap());
    control.init(clm).await;
    info!("pixel64: cyw43 up");

    // IP stack (DHCP) over the cyw43 network device.
    let seed = RoscRng.next_u64();
    static RESOURCES: StaticCell<StackResources<4>> = StaticCell::new();
    let (stack, net_runner) = embassy_net::new(
        net_device,
        NetConfig::dhcpv4(Default::default()),
        RESOURCES.init(StackResources::new()),
        seed,
    );
    spawner.spawn(net_task(net_runner).unwrap());

    // Join (retry on failure — wrong password / AP not yet up / out of range).
    info!("pixel64: joining Wi-Fi '{}'…", WIFI_SSID);
    loop {
        match control
            .join(WIFI_SSID, JoinOptions::new(WIFI_PASS.as_bytes()))
            .await
        {
            Ok(()) => {
                info!("pixel64: associated — waiting for DHCP…");
                break;
            }
            Err(e) => {
                warn!("pixel64: join failed ({:?}); retrying in 2s", e);
                Timer::after_secs(2).await;
            }
        }
    }

    stack.wait_config_up().await;
    let ip = stack
        .config_v4()
        .expect("ipv4 config present after wait_config_up")
        .address
        .address();
    info!("pixel64: ONLINE — ip = {}", ip);

    // Solid onboard LED = online.
    control.gpio_set(0, true).await;

    let mut tick: u32 = 0;
    loop {
        info!("pixel64: online at {} — tick {}", ip, tick);
        tick = tick.wrapping_add(1);
        Timer::after_secs(5).await;
    }
}
