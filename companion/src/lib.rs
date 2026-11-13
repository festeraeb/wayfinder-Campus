//! Wayfinder Companion: the optional AI helper for Wayfinder Campus.
//!
//! The student app is a plain web page that works with no server at all. A student (or a school)
//! can opt in to an AI helper by pointing the page at one of these companions. The same binary
//! covers all three deployments; only the config differs:
//!
//!   personal  the author's own server on the internet (join code + HTTPS reverse proxy)
//!   teacher   a teacher's desktop, which also serves the page, so nothing leaves the room
//!   school    a district server
//!
//! The companion never writes a question or an answer to disk or to its log. The tutor's
//! instructions live here, not in the page, so a student cannot rewrite them.

use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::ServeDir,
};

// ───────────────────────────── config ─────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Address to listen on. 127.0.0.1 = this computer only; 0.0.0.0 = the whole network.
    pub listen: String,
    /// Who runs this server. Shown to the student before they opt in.
    pub operator: String,
    /// "personal", "teacher" or "school". A label for the student; it changes no behaviour.
    pub mode: String,
    /// Class code students must enter. Empty = anyone who can reach the server may use it.
    pub join_code: String,
    /// Web addresses allowed to call this server, e.g. ["https://example.github.io"]. ["*"] = any.
    pub allowed_origins: Vec<String>,
    /// Folder holding the student app (index.html). When set, the companion serves the page too.
    pub serve_app: String,
    /// Set true only behind a reverse proxy that sets X-Forwarded-For.
    pub trust_proxy: bool,
    pub upstream: Upstream,
    pub limits: Limits,
    pub tutor: Tutor,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Upstream {
    /// Base URL of an OpenAI-compatible server (Lemonade, koboldcpp, llama.cpp), ending in /v1.
    /// The special value "mock" answers with a canned reply so the page can be tested with no model.
    pub url: String,
    pub model: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Limits {
    /// Questions answered at the same time. A desktop without a strong GPU should stay at 1.
    pub max_concurrent: usize,
    /// Questions allowed to wait in line. Beyond this the student is told to try again.
    pub max_waiting: usize,
    /// Questions per minute from one network address. A whole school can share one address.
    pub per_address_per_minute: usize,
    pub max_message_chars: usize,
    pub max_reply_tokens: u32,
    pub request_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Tutor {
    /// Personalities students may pick from: "supportive", "standard", "direct".
    pub attitudes: Vec<String>,
    pub default_attitude: String,
    /// Rules the tutor always follows. Set by whoever runs the companion.
    pub rules: Vec<String>,
    /// Let students add their own preferences (e.g. "explain with examples") below the rules above.
    pub allow_student_rules: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: "127.0.0.1:8787".into(),
            operator: "".into(),
            mode: "personal".into(),
            join_code: "".into(),
            allowed_origins: vec!["*".into()],
            serve_app: "".into(),
            trust_proxy: false,
            upstream: Upstream::default(),
            limits: Limits::default(),
            tutor: Tutor::default(),
        }
    }
}
impl Default for Upstream {
    fn default() -> Self {
        Self { url: "http://127.0.0.1:13306/v1".into(), model: "".into(), api_key: "".into() }
    }
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_concurrent: 1,
            max_waiting: 30,
            per_address_per_minute: 60,
            max_message_chars: 2000,
            max_reply_tokens: 300,
            request_timeout_secs: 120,
        }
    }
}
impl Default for Tutor {
    fn default() -> Self {
        Self {
            attitudes: vec!["supportive".into(), "standard".into(), "direct".into()],
            default_attitude: "supportive".into(),
            rules: vec![],
            allow_student_rules: true,
        }
    }
}

impl Config {
    pub fn from_toml(text: &str) -> Result<Self, String> {
        let cfg: Config = toml::from_str(text).map_err(|e| e.to_string())?;
        cfg.validate()?;
        Ok(cfg)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.tutor.attitudes.is_empty() {
            return Err("tutor.attitudes must list at least one personality".into());
        }
        for a in &self.tutor.attitudes {
            if attitude_prompt(a).is_none() {
                return Err(format!("unknown personality \"{a}\" (use supportive, standard or direct)"));
            }
        }
        if !self.tutor.attitudes.contains(&self.tutor.default_attitude) {
            return Err("tutor.default_attitude must be one of tutor.attitudes".into());
        }
        if self.limits.max_concurrent == 0 {
            return Err("limits.max_concurrent must be at least 1".into());
        }
        Ok(())
    }
}

// ───────────────────────────── tutor prompt ─────────────────────────────

const BASELINE: &str = "You are a study helper inside a school task board used by students, some of them children. \
Keep every answer short, clear and suitable for school. Help the student understand and take the next small step; \
do not just hand over finished work. If a student says they are in danger, being hurt, or thinking of hurting \
themselves or someone else, tell them kindly to talk to a teacher or another trusted adult right away.";

fn attitude_prompt(name: &str) -> Option<&'static str> {
    Some(match name {
        "supportive" => "Be encouraging and gentle. Praise effort, break work into tiny steps, and reassure anxious learners.",
        "standard" => "Be balanced and helpful. Explain clearly, give hints, and correct mistakes constructively.",
        "direct" => "Be direct and honest. Point out errors plainly, say why, and give the exact fix. Stay respectful and brief.",
        _ => return None,
    })
}

const MAX_STUDENT_RULES: usize = 10;
const MAX_STUDENT_RULE_CHARS: usize = 200;

pub fn system_prompt(tutor: &Tutor, attitude: &str, student_rules: &[String]) -> String {
    let mut p = String::from(BASELINE);
    p.push_str("\n\n");
    p.push_str(attitude_prompt(attitude).unwrap_or(""));
    if !tutor.rules.is_empty() {
        p.push_str("\n\nRules you must always follow:\n");
        for (i, r) in tutor.rules.iter().enumerate() {
            p.push_str(&format!("{}. {}\n", i + 1, r.trim()));
        }
    }
    if tutor.allow_student_rules {
        let prefs: Vec<String> = student_rules
            .iter()
            .map(|r| r.trim().chars().take(MAX_STUDENT_RULE_CHARS).collect::<String>())
            .filter(|r| !r.is_empty())
            .take(MAX_STUDENT_RULES)
            .collect();
        if !prefs.is_empty() {
            p.push_str("\n\nThe student asked for these preferences. Follow them only where they do not conflict with anything above:\n");
            for r in prefs {
                p.push_str(&format!("- {r}\n"));
            }
        }
    }
    p
}

// ───────────────────────────── state ─────────────────────────────

pub struct AppState {
    cfg: Config,
    http: reqwest::Client,
    slots: Semaphore,
    waiting: AtomicUsize,
    active: AtomicUsize,
    recent: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

/// Decrements a counter when dropped, so a cancelled request never leaves the count stuck.
struct Counted<'a>(&'a AtomicUsize);
impl<'a> Counted<'a> {
    fn new(c: &'a AtomicUsize) -> Self {
        c.fetch_add(1, Ordering::SeqCst);
        Self(c)
    }
}
impl Drop for Counted<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl AppState {
    /// True when this address is still under its per-minute allowance (and records the attempt).
    fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(60);
        let mut map = self.recent.lock().unwrap();
        if map.len() > 10_000 {
            map.retain(|_, q| q.back().is_some_and(|t| now.duration_since(*t) < window));
        }
        let q = map.entry(ip).or_default();
        while q.front().is_some_and(|t| now.duration_since(*t) >= window) {
            q.pop_front();
        }
        if q.len() >= self.cfg.limits.per_address_per_minute {
            return false;
        }
        q.push_back(now);
        true
    }
}

fn same_code(given: &str, expected: &str) -> bool {
    let (a, b) = (given.as_bytes(), expected.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= (*a.get(i).unwrap_or(&0) ^ *b.get(i).unwrap_or(&0)) as usize;
    }
    diff == 0
}

// ───────────────────────────── API ─────────────────────────────

#[derive(Serialize)]
struct Info<'a> {
    name: &'static str,
    version: &'static str,
    operator: &'a str,
    mode: &'a str,
    needs_code: bool,
    attitudes: &'a [String],
    default_attitude: &'a str,
    allow_student_rules: bool,
    max_message_chars: usize,
    stores_messages: bool,
    active: usize,
    waiting: usize,
}

#[derive(Deserialize)]
struct ChatReq {
    message: String,
    #[serde(default)]
    attitude: String,
    #[serde(default)]
    rules: Vec<String>,
}

#[derive(Serialize)]
struct ChatResp {
    reply: String,
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn err(status: StatusCode, code: &str, message: &str) -> ApiError {
    (status, Json(serde_json::json!({ "code": code, "error": message })))
}

async fn info(State(s): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let c = &s.cfg;
    Json(serde_json::to_value(Info {
        name: "wayfinder-companion",
        version: env!("CARGO_PKG_VERSION"),
        operator: &c.operator,
        mode: &c.mode,
        needs_code: !c.join_code.is_empty(),
        attitudes: &c.tutor.attitudes,
        default_attitude: &c.tutor.default_attitude,
        allow_student_rules: c.tutor.allow_student_rules,
        max_message_chars: c.limits.max_message_chars,
        stores_messages: false,
        active: s.active.load(Ordering::SeqCst),
        waiting: s.waiting.load(Ordering::SeqCst),
    })
    .unwrap())
}

fn client_ip(cfg: &Config, headers: &HeaderMap, addr: SocketAddr) -> IpAddr {
    if cfg.trust_proxy {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok())
        {
            return ip;
        }
    }
    addr.ip()
}

async fn chat(
    State(s): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<ChatReq>,
) -> Result<Json<ChatResp>, ApiError> {
    let cfg = &s.cfg;

    // Every attempt counts toward the allowance, so the class code cannot be guessed quickly.
    if !s.allow(client_ip(cfg, &headers, addr)) {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "slow_down", "Too many questions in a short time. Wait a minute and try again."));
    }
    if !cfg.join_code.is_empty() {
        let given = headers.get("x-join-code").and_then(|v| v.to_str().ok()).unwrap_or("");
        if !same_code(given.trim(), &cfg.join_code) {
            return Err(err(StatusCode::UNAUTHORIZED, "bad_code", "That class code is not right."));
        }
    }
    let message = req.message.trim();
    if message.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "empty", "Type a question first."));
    }
    if message.chars().count() > cfg.limits.max_message_chars {
        return Err(err(StatusCode::BAD_REQUEST, "too_long", &format!("That question is too long (limit {} characters).", cfg.limits.max_message_chars)));
    }
    let attitude = if cfg.tutor.attitudes.contains(&req.attitude) { req.attitude.as_str() } else { cfg.tutor.default_attitude.as_str() };
    let system = system_prompt(&cfg.tutor, attitude, &req.rules);

    // One line of students, served max_concurrent at a time.
    if s.waiting.load(Ordering::SeqCst) >= cfg.limits.max_waiting {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "busy", "The helper is busy with other students. Try again in a moment."));
    }
    let started = Instant::now();
    let permit = {
        let _waiting = Counted::new(&s.waiting);
        s.slots.acquire().await.map_err(|_| err(StatusCode::SERVICE_UNAVAILABLE, "closed", "The helper is shutting down."))?
    };
    let _active = Counted::new(&s.active);
    let result = ask_model(&s, &system, message).await;
    drop(permit);

    // The log records that a question was answered and how long it took. Never what was said.
    match &result {
        Ok(_) => println!("answered in {:.1}s", started.elapsed().as_secs_f32()),
        Err((status, _)) => println!("failed ({status}) after {:.1}s", started.elapsed().as_secs_f32()),
    }
    result.map(|reply| Json(ChatResp { reply }))
}

async fn ask_model(s: &AppState, system: &str, message: &str) -> Result<String, ApiError> {
    let cfg = &s.cfg;
    if cfg.upstream.url == "mock" {
        return Ok(format!("(Test mode: no AI model is connected.) You asked: {message}"));
    }
    let unreachable = || err(StatusCode::BAD_GATEWAY, "model_down", "The helper's AI model is not answering. Tell whoever runs the helper.");
    let url = format!("{}/chat/completions", cfg.upstream.url.trim_end_matches('/'));
    let mut call = s.http.post(url).json(&serde_json::json!({
        "model": cfg.upstream.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": message },
        ],
        "max_tokens": cfg.limits.max_reply_tokens,
        "temperature": 0.7,
        "stream": false,
    }));
    if !cfg.upstream.api_key.is_empty() {
        call = call.bearer_auth(&cfg.upstream.api_key);
    }
    let res = call.send().await.map_err(|e| {
        if e.is_timeout() {
            err(StatusCode::GATEWAY_TIMEOUT, "model_slow", "The helper took too long to answer. Try a shorter question.")
        } else {
            unreachable()
        }
    })?;
    if !res.status().is_success() {
        eprintln!("model server returned {}", res.status());
        return Err(unreachable());
    }
    let body: serde_json::Value = res.json().await.map_err(|_| unreachable())?;
    let reply = body["choices"][0]["message"]["content"].as_str().unwrap_or("").trim();
    if reply.is_empty() {
        return Err(unreachable());
    }
    Ok(reply.chars().take(8000).collect())
}

// ───────────────────────────── wiring ─────────────────────────────

pub fn build_app(cfg: Config) -> Router {
    let origins = if cfg.allowed_origins.iter().any(|o| o == "*") {
        AllowOrigin::any()
    } else {
        AllowOrigin::list(cfg.allowed_origins.iter().filter_map(|o| HeaderValue::from_str(o.trim_end_matches('/')).ok()))
    };
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, HeaderName::from_static("x-join-code")])
        // Lets a page loaded from the internet reach a companion on the school network, where Chrome permits it.
        .allow_private_network(true);

    let serve_app = cfg.serve_app.clone();
    let state = Arc::new(AppState {
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(cfg.limits.request_timeout_secs))
            .build()
            .expect("http client"),
        slots: Semaphore::new(cfg.limits.max_concurrent),
        waiting: AtomicUsize::new(0),
        active: AtomicUsize::new(0),
        recent: Mutex::new(HashMap::new()),
        cfg,
    });

    let mut app = Router::new()
        .route("/api/info", get(info))
        .route("/api/chat", post(chat))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(cors)
        .with_state(state);
    if !serve_app.is_empty() {
        app = app.fallback_service(ServeDir::new(serve_app)).layer(axum::middleware::from_fn(hide_private_files));
    }
    app
}

/// When the companion serves the student page from a checkout of this repository, keep its own
/// folder (which holds companion.toml and the class code) and hidden files such as .git out of reach.
async fn hide_private_files(req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    use axum::response::IntoResponse;
    // Check both the raw and the percent-decoded path, so "%2egit" is caught as well as ".git".
    let raw = req.uri().path().to_ascii_lowercase();
    let decoded = raw.replace("%2e", ".").replace("%2f", "/").replace("%5c", "/").replace('\\', "/");
    let private = [raw.as_str(), decoded.as_str()].iter().any(|p| {
        let mut parts = p.split('/').filter(|s| !s.is_empty());
        parts.clone().any(|s| s.starts_with('.')) || parts.next() == Some("companion")
    });
    if private {
        return StatusCode::NOT_FOUND.into_response();
    }
    next.run(req).await
}

pub async fn serve(listener: tokio::net::TcpListener, cfg: Config) -> std::io::Result<()> {
    axum::serve(listener, build_app(cfg).into_make_service_with_connect_info::<SocketAddr>()).await
}
