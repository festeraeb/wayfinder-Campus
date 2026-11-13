# Wayfinder Campus

A task board for students: **Do Now** (three at most), **Next Up**, **How-To**, and **Done**, with a
Flow view for linking a task to the reference material it needs.

It is a plain web page. There is nothing to install, so it runs on a school Chromebook.

## Two parts

| Part | What it is | Who needs it |
|---|---|---|
| The board (`index.html`, `js/`, `css/`) | The student app. Works with no server and no account. | Everyone |
| The companion (`companion/`) | An optional helper server that answers "Ask Clippy" questions using an AI model running on the same machine. | Only whoever hosts the AI helper |

The AI helper is **off** until a student turns it on in Settings. Before it turns on, the page shows
who runs the helper and the student has to tick a box.

## What data goes where

- **Helper off (the default):** the board is saved in the browser on that device. Nothing is sent anywhere.
- **Helper on:** each question the student types, the personality they picked, and their anchored
  rules are sent to the companion they chose. The board itself is not sent.
- **The companion** passes the question to the AI model on its own machine and returns the answer.
  It does not write questions or answers to disk or to its log. The log records only that a question
  was answered and how long it took.

## Where the companion can run

The same program covers all three. Only `companion.toml` changes.

| Setup | Who runs it | Students open | Notes |
|---|---|---|---|
| Personal server | The site's author | The published page | Needs an `https://` address in front of it (Caddy, nginx or a tunnel), a `join_code`, and `allowed_origins` set to the published page's address. |
| Teacher's desktop | A teacher | `http://<teacher-computer>:8787` | Set `listen = "0.0.0.0:8787"` and `serve_app = ".."`. The companion serves the board itself, so questions never leave the room. The school network must let student devices reach the teacher's computer. |
| School server | The district | The published page, or the server's own address | Same as the personal server, on school equipment. |

A page published over `https://` cannot call a plain `http://` helper on another machine; browsers
block it. That is why the teacher setup serves the board from the companion.

## Run the companion

You need [Rust](https://rustup.rs/) and an OpenAI-compatible model server on the same machine, such
as Lemonade or koboldcpp.

```bash
cd companion
cp companion.example.toml companion.toml
cargo run --release -- companion.toml
```

To try the page with no model at all, set `url = "mock"` under `[upstream]`. The companion then gives
a canned answer.

Settings worth knowing (all are explained in `companion.example.toml`):

- `operator`: shown to students before they opt in.
- `join_code`: a class code students must type. Set one on anything reachable from outside the room.
- `[limits]`: how many questions are answered at once, how many may wait in line, and how long a
  question or an answer may be.
- `[tutor]`: which personalities students may pick, and rules the tutor always follows. These live on
  the companion, so a student cannot change them from the page.

## Offer a helper on the published page

Put the companion's `https://` address in `js/config.js`. Students who turn the helper on will see
that address filled in. Leave it empty to offer none.

## Tests

```bash
cd companion
cargo test
```
