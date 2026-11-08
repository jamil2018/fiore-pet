use std::io;
use std::path::PathBuf;

fn main() -> io::Result<()> {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let mut native = cc::Build::new();
        native
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .include("native/macos");
        for file in ["common.m", "desktop.m", "media.m", "audio.m", "browser.m"] {
            let path = format!("native/macos/{file}");
            println!("cargo:rerun-if-changed={path}");
            native.file(path);
        }
        println!("cargo:rerun-if-changed=native/macos/fiore_macos.h");
        native.compile("fiore_macos");
        link_clang_runtime(&native)?;
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
    tauri_build::build();
    Ok(())
}

fn clang_path(compiler: &cc::Tool, argument: &str) -> io::Result<PathBuf> {
    let output = compiler.to_command().arg(argument).output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "target Clang failed to resolve runtime path with {argument}"
        )));
    }
    let path = String::from_utf8(output.stdout)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(PathBuf::from(path.trim()))
}

fn link_clang_runtime(native: &cc::Build) -> io::Result<()> {
    let compiler = native.try_get_compiler().map_err(io::Error::other)?;
    let mut runtime = clang_path(&compiler, "--print-file-name=libclang_rt.osx.a")?;
    if !runtime.is_absolute() || !runtime.is_file() {
        runtime =
            clang_path(&compiler, "--print-resource-dir")?.join("lib/darwin/libclang_rt.osx.a");
    }
    if !runtime.is_absolute() || !runtime.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "target Clang's macOS compiler-rt archive is missing",
        ));
    }
    let directory = runtime.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid compiler-rt archive path",
        )
    })?;
    // @available emits Clang runtime calls. Rust's -nodefaultlibs omits the
    // driver's normal compiler-rt link, including __isPlatformVersionAtLeast.
    // Resolve through the same target compiler for each universal architecture.
    println!("cargo:rustc-link-search=native={}", directory.display());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
    println!("cargo:rerun-if-changed={}", runtime.display());
    Ok(())
}
