fn main() {
    // Expose the Cargo target triple so manager.rs can resolve sidecar binary paths
    // (e.g., "binaries/ogmios-x86_64-unknown-linux-gnu") at runtime.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
