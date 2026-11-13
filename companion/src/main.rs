use wayfinder_companion::{serve, Config};

#[tokio::main]
async fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "companion.toml".into());
    let cfg = match std::fs::read_to_string(&path) {
        Ok(text) => match Config::from_toml(&text) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("{path}: {e}");
                std::process::exit(2);
            }
        },
        Err(_) => {
            eprintln!("No config at {path}. Copy companion.example.toml to companion.toml and edit it.");
            std::process::exit(2);
        }
    };

    let listener = match tokio::net::TcpListener::bind(&cfg.listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Cannot listen on {}: {e}", cfg.listen);
            std::process::exit(1);
        }
    };
    let addr = listener.local_addr().expect("local address");
    println!("Wayfinder Companion ({}) listening on http://{addr}", cfg.mode);
    if cfg.upstream.url == "mock" {
        println!("TEST MODE: upstream is \"mock\", so answers are canned. No AI model is used.");
    } else {
        println!("AI model: {} at {}", cfg.upstream.model, cfg.upstream.url);
    }
    if !cfg.serve_app.is_empty() {
        println!("Serving the student page from {}", cfg.serve_app);
    }
    if !addr.ip().is_loopback() && cfg.join_code.is_empty() {
        println!("WARNING: reachable from the network with no join_code. Anyone who can reach this address can use the helper.");
    }
    if let Err(e) = serve(listener, cfg).await {
        eprintln!("server stopped: {e}");
        std::process::exit(1);
    }
}
