fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let mut native = cc::Build::new();
        native
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .include("native/macos");
        for file in ["common.m", "desktop.m", "media.m", "audio.m"] {
            let path = format!("native/macos/{file}");
            println!("cargo:rerun-if-changed={path}");
            native.file(path);
        }
        println!("cargo:rerun-if-changed=native/macos/fiore_macos.h");
        native.compile("fiore_macos");
        for framework in [
            "Foundation",
            "AppKit",
            "ApplicationServices",
            "CoreGraphics",
            "CoreAudio",
            "CoreServices",
            "Carbon",
            "ScriptingBridge",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
