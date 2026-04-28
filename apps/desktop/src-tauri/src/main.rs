#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::header::{ACCEPT, LOCATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const MAX_CONTENT_BYTES: u64 = 2_000_000;
const MAX_REDIRECTS: usize = 5;
const CLIPBOARD_TIMEOUT_MS: u64 = 3_000;

#[tauri::command]
fn desktop_health() -> &'static str {
    "ok"
}

#[tauri::command]
fn desktop_copy_text(text: String) -> Result<(), String> {
    copy_text_to_clipboard(&text)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopExtractUrlInput {
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopExtractionContext {
    requested_url: String,
    final_url: String,
    title: Option<String>,
    content_type: Option<String>,
    confidence: f64,
    notes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopExtractUrlResult {
    text: String,
    context: DesktopExtractionContext,
}

fn normalize_url(value: &str) -> Result<reqwest::Url, String> {
    let candidate = value.trim();
    if candidate.is_empty() {
        return Err("URL is required.".to_string());
    }
    let with_scheme = if candidate.contains("://") {
        candidate.to_string()
    } else {
        format!("https://{candidate}")
    };
    let parsed = reqwest::Url::parse(&with_scheme).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Only http/https URLs are supported.".to_string()),
    }
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(address) => {
            let octets = address.octets();
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_broadcast()
                || address.is_multicast()
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0 && (octets[2] == 0 || octets[2] == 2))
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                || octets[0] >= 224
        }
        IpAddr::V6(address) => {
            if let Some(mapped) = address.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(mapped));
            }
            let segments = address.segments();
            address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (segments[0] == 0x0100 && segments[1] == 0)
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
                || segments[0] == 0x2002
                || (segments[0] == 0x2001 && segments[1] == 0x0002 && segments[2] == 0)
                || (segments[0] == 0x2001 && (0x0010..=0x001f).contains(&segments[1]))
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

fn normalized_hostname(hostname: &str) -> String {
    hostname
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn dns_override_hostname(hostname: &str) -> String {
    hostname
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase()
}

fn is_private_host(hostname: &str) -> bool {
    let lower = normalized_hostname(hostname);
    if let Ok(ip) = lower.parse::<IpAddr>() {
        return is_private_ip(ip);
    }
    lower == "localhost" || lower.ends_with(".local")
}

fn validate_resolved_addresses_allowed(
    addresses: &[SocketAddr],
    allow_private_network: bool,
) -> Result<(), String> {
    if addresses.is_empty() {
        return Err("URL host could not be resolved.".to_string());
    }
    if !allow_private_network {
        for address in addresses {
            if is_private_ip(address.ip()) {
                return Err("Private-network URLs are disabled by default.".to_string());
            }
        }
    }
    Ok(())
}

fn validate_resolved_url_allowed(
    url: &reqwest::Url,
    allow_private_network: bool,
) -> Result<Vec<SocketAddr>, String> {
    let hostname = url
        .host_str()
        .ok_or_else(|| "URL host is required.".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL port could not be determined.".to_string())?;
    let addresses: Vec<SocketAddr> = (hostname, port)
        .to_socket_addrs()
        .map_err(|_| "URL host could not be resolved.".to_string())?
        .collect();
    validate_resolved_addresses_allowed(&addresses, allow_private_network)?;
    Ok(addresses)
}

async fn read_response_text_with_limit(mut response: reqwest::Response) -> Result<String, String> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if body.len() + chunk.len() > MAX_CONTENT_BYTES as usize {
            return Err("URL response is too large.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn validate_url_allowed(url: &reqwest::Url, allow_private_network: bool) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http/https URLs are supported.".to_string()),
    }
    if !allow_private_network {
        if let Some(hostname) = url.host_str() {
            if is_private_host(hostname) {
                return Err("Private-network URLs are disabled by default.".to_string());
            }
        }
    }
    Ok(())
}

fn decode_basic_entities(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut index = 0;
    while let Some(start_relative) = input[index..].find('&') {
        let start = index + start_relative;
        output.push_str(&input[index..start]);
        let Some(end_relative) = input[start..].find(';') else {
            output.push_str(&input[start..]);
            return output;
        };
        let end = start + end_relative;
        let entity = &input[start + 1..end];
        let decoded = match entity.to_ascii_lowercase().as_str() {
            "amp" => Some('&'),
            "apos" => Some('\''),
            "gt" => Some('>'),
            "lt" => Some('<'),
            "nbsp" => Some(' '),
            "quot" => Some('"'),
            value if value.starts_with("#x") => u32::from_str_radix(&value[2..], 16).ok().and_then(char::from_u32),
            value if value.starts_with('#') => value[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        if let Some(character) = decoded {
            output.push(character);
        } else {
            output.push_str(&input[start..=end]);
        }
        index = end + 1;
    }
    output.push_str(&input[index..]);
    output
}

fn html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start_tag = lower.find("<title")?;
    let content_start = lower[start_tag..].find('>')? + start_tag + 1;
    let content_end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..content_end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if title.is_empty() {
        None
    } else {
        Some(decode_basic_entities(&title))
    }
}

fn strip_tag_blocks(mut input: String, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    loop {
        let lower = input.to_ascii_lowercase();
        let Some(start) = lower.find(&open) else {
            return input;
        };
        let Some(end_relative) = lower[start..].find(&close) else {
            input.replace_range(start.., " ");
            return input;
        };
        let end = start + end_relative + close.len();
        input.replace_range(start..end, " ");
    }
}

fn remove_non_content(html: &str) -> String {
    let mut text = html.to_string();
    for tag in [
        "script", "style", "noscript", "svg", "template", "nav", "header", "footer", "aside",
        "form", "button", "iframe", "canvas",
    ] {
        text = strip_tag_blocks(text, tag);
    }
    text
}

fn normalize_extracted_text(value: &str) -> String {
    decode_basic_entities(value)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn text_from_html_fragment(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    let mut index = 0;
    while let Some(open_relative) = lower[index..].find('<') {
        let open = index + open_relative;
        output.push_str(&html[index..open]);
        let Some(close_relative) = lower[open..].find('>') else {
            break;
        };
        let close = open + close_relative;
        let tag = lower[open + 1..close].trim().trim_start_matches('/');
        if tag.starts_with("li") {
            output.push_str("\n- ");
        } else if tag.starts_with("br")
            || tag.starts_with("hr")
            || tag.starts_with('p')
            || tag.starts_with("div")
            || tag.starts_with("article")
            || tag.starts_with("section")
            || tag.starts_with("main")
            || tag.starts_with('h')
            || tag.starts_with("blockquote")
            || tag.starts_with("tr")
            || tag.starts_with("table")
            || tag.starts_with("ul")
            || tag.starts_with("ol")
        {
            output.push('\n');
        }
        index = close + 1;
    }
    output.push_str(&html[index..]);

    normalize_extracted_text(&output)
}

fn strip_html(html: &str) -> String {
    text_from_html_fragment(&remove_non_content(html))
}

fn word_count(text: &str) -> usize {
    text.split_whitespace()
        .filter(|word| word.chars().any(|character| character.is_alphabetic()))
        .count()
}

fn tag_count(fragment: &str, needle: &str) -> usize {
    fragment.to_ascii_lowercase().matches(needle).count()
}

fn collect_tag_blocks(html: &str, tag: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let open_prefix = format!("<{tag}");
    let close_tag = format!("</{tag}>");
    let mut blocks = Vec::new();
    let mut offset = 0;
    while let Some(start_relative) = lower[offset..].find(&open_prefix) {
        let start = offset + start_relative;
        let Some(open_end_relative) = lower[start..].find('>') else {
            break;
        };
        let content_start = start + open_end_relative + 1;
        let Some(end_relative) = lower[content_start..].find(&close_tag) else {
            break;
        };
        let end = content_start + end_relative + close_tag.len();
        blocks.push(html[start..end].to_string());
        offset = end;
    }
    blocks
}

fn link_density(fragment: &str) -> f64 {
    let link_text = collect_tag_blocks(fragment, "a")
        .iter()
        .map(|block| text_from_html_fragment(block))
        .collect::<Vec<_>>()
        .join(" ");
    let text = text_from_html_fragment(fragment);
    if text.is_empty() {
        0.0
    } else {
        link_text.len() as f64 / text.len() as f64
    }
}

fn candidate_score(fragment: &str) -> i64 {
    let text = text_from_html_fragment(fragment);
    let words = word_count(&text) as i64;
    let paragraph_count = tag_count(fragment, "</p>") as i64;
    let heading_count = tag_count(fragment, "<h") as i64;
    let list_count = tag_count(fragment, "<li") as i64;
    words + paragraph_count * 22 + heading_count * 10 + std::cmp::min(40, list_count * 3)
        - (words as f64 * link_density(fragment) * 1.8).round() as i64
}

fn collect_readable_candidates(html: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    for tag in ["article", "main"] {
        candidates.extend(collect_tag_blocks(html, tag));
    }
    for tag in ["section", "div"] {
        for block in collect_tag_blocks(html, tag) {
            let lower = block.to_ascii_lowercase();
            let opening = lower.split('>').next().unwrap_or("");
            if ["article", "content", "entry", "main", "post", "story", "body"]
                .iter()
                .any(|needle| opening.contains(needle))
            {
                candidates.push(block);
            }
        }
    }
    candidates
}

fn extract_readable_html(html: &str) -> (String, Vec<String>) {
    let cleaned = remove_non_content(html);
    let full_text = text_from_html_fragment(&cleaned);
    let full_words = word_count(&full_text) as f64;
    let mut candidates = collect_readable_candidates(&cleaned)
        .into_iter()
        .map(|fragment| {
            let text = text_from_html_fragment(&fragment);
            let score = candidate_score(&fragment);
            (text, score)
        })
        .filter(|(text, _score)| word_count(text) >= 25)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.1.cmp(&left.1));

    if let Some((text, score)) = candidates.first() {
        if *score as f64 >= 60.0_f64.max(full_words * 0.18) {
            return (
                text.clone(),
                vec!["Readable content extraction selected a likely article body.".to_string()],
            );
        }
    }

    let notes = if candidates.is_empty() {
        Vec::new()
    } else {
        vec!["Readable content extraction used the full page after candidate scoring.".to_string()]
    };
    (full_text, notes)
}

fn estimate_confidence(text: &str) -> f64 {
    let words = word_count(text);
    if words >= 180 {
        0.86
    } else if words >= 80 {
        0.68
    } else if words >= 30 {
        0.42
    } else {
        0.18
    }
}

#[cfg(target_os = "macos")]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    pipe_to_clipboard_command("pbcopy", &[], text)
}

#[cfg(target_os = "windows")]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    pipe_to_clipboard_command("cmd", &["/C", "clip"], text)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    pipe_to_clipboard_command("wl-copy", &[], text).or_else(|wayland_error| {
        pipe_to_clipboard_command("xclip", &["-selection", "clipboard"], text).map_err(|xclip_error| {
            format!("No supported clipboard command was available. wl-copy: {wayland_error}; xclip: {xclip_error}")
        })
    })
}

fn pipe_to_clipboard_command(command: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start clipboard command `{command}`: {error}"))?;

    let Some(mut stdin) = child.stdin.take() else {
        return Err(format!(
            "Clipboard command `{command}` did not accept input."
        ));
    };
    stdin
        .write_all(text.as_bytes())
        .map_err(|error| format!("Could not write to clipboard command `{command}`: {error}"))?;
    drop(stdin);

    let status = child
        .wait_timeout(command, Duration::from_millis(CLIPBOARD_TIMEOUT_MS))
        .map_err(|error| format!("Clipboard command `{command}` did not finish: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Clipboard command `{command}` exited with status {status}."
        ))
    }
}

trait ChildTimeout {
    fn wait_timeout(&mut self, command: &str, timeout: Duration) -> Result<ExitStatus, String>;
}

impl ChildTimeout for Child {
    fn wait_timeout(&mut self, command: &str, timeout: Duration) -> Result<ExitStatus, String> {
        let started_at = Instant::now();
        loop {
            if let Some(status) = self.try_wait().map_err(|error| {
                format!("Clipboard command `{command}` could not be checked: {error}")
            })? {
                return Ok(status);
            }

            if started_at.elapsed() >= timeout {
                let _ = self.kill();
                let _ = self.wait();
                return Err(format!("Clipboard command `{command}` timed out."));
            }

            thread::sleep(Duration::from_millis(20));
        }
    }
}

fn is_readable_content_type(content_type: &str) -> bool {
    content_type.contains("text/html")
        || content_type.contains("text/plain")
        || content_type.contains("application/xhtml+xml")
}

fn is_response_body_too_large(body: &str) -> bool {
    body.len() as u64 > MAX_CONTENT_BYTES
}

#[tauri::command]
async fn desktop_extract_url(
    input: DesktopExtractUrlInput,
) -> Result<DesktopExtractUrlResult, String> {
    let requested_url = normalize_url(&input.url)?;
    let allow_private_network = false;
    let mut current_url = requested_url.clone();
    let mut redirect_count = 0;
    let response = loop {
        validate_url_allowed(&current_url, allow_private_network)?;
        let resolved_addresses =
            validate_resolved_url_allowed(&current_url, allow_private_network)?;
        let hostname = current_url
            .host_str()
            .ok_or_else(|| "URL host is required.".to_string())
            .map(dns_override_hostname)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&hostname, &resolved_addresses)
            .build()
            .map_err(|error| error.to_string())?;
        let response = client
            .get(current_url.clone())
            .header(ACCEPT, "text/html,text/plain;q=0.9,*/*;q=0.2")
            .header(USER_AGENT, "FlavorPressContentAnalyzer/0.1")
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if !response.status().is_redirection() {
            break response;
        }
        if redirect_count >= MAX_REDIRECTS {
            return Err("URL redirected too many times.".to_string());
        }
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                format!(
                    "URL redirect failed without a Location header (HTTP {}).",
                    response.status()
                )
            })?;
        current_url = current_url
            .join(location)
            .map_err(|error| error.to_string())?;
        redirect_count += 1;
    };

    if !response.status().is_success() {
        return Err(format!("URL fetch failed with HTTP {}.", response.status()));
    }

    if response.content_length().unwrap_or(0) > MAX_CONTENT_BYTES {
        return Err("URL response is too large.".to_string());
    }

    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);
    if let Some(value) = &content_type {
        if !is_readable_content_type(value) {
            return Err(format!(
                "URL response is not readable text or HTML ({value})."
            ));
        }
    }

    let body = read_response_text_with_limit(response).await?;
    if is_response_body_too_large(&body) {
        return Err("URL response is too large.".to_string());
    }

    let is_plain = content_type
        .as_deref()
        .map(|value| value.contains("text/plain"))
        .unwrap_or(false);
    let title = if is_plain { None } else { html_title(&body) };
    let (text, extraction_notes) = if is_plain {
        (body.trim().to_string(), Vec::new())
    } else {
        extract_readable_html(&body)
    };
    let confidence = estimate_confidence(&text);
    let mut notes = extraction_notes;
    if confidence < 0.5 {
        notes.push("Readable content extraction returned limited text.".to_string());
    }

    Ok(DesktopExtractUrlResult {
        text,
        context: DesktopExtractionContext {
            requested_url: requested_url.to_string(),
            final_url,
            title,
            content_type,
            confidence,
            notes,
        },
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_health,
            desktop_extract_url,
            desktop_copy_text
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_guard_blocks_private_literal_hosts() {
        for value in [
            "http://127.0.0.1/",
            "http://10.0.0.1/",
            "http://169.254.10.20/",
            "http://[::1]/",
            "http://[fc00::1]/",
            "http://[::ffff:192.168.1.20]/",
            "http://[100::1]/",
            "http://[2001:2::1]/",
            "http://[2001:10::1]/",
            "http://[2002::1]/",
            "http://localhost/",
        ] {
            let url = reqwest::Url::parse(value).expect("test URL should parse");
            assert_eq!(
                validate_url_allowed(&url, false),
                Err("Private-network URLs are disabled by default.".to_string()),
                "{value} should be blocked"
            );
        }
    }

    #[test]
    fn url_guard_allows_private_hosts_only_when_explicitly_enabled() {
        let url = reqwest::Url::parse("http://127.0.0.1/").expect("test URL should parse");
        assert!(validate_url_allowed(&url, true).is_ok());
        assert!(validate_resolved_url_allowed(&url, true).is_ok());
    }

    #[test]
    fn url_guard_blocks_private_dns_results() {
        let url = reqwest::Url::parse("http://localhost/").expect("test URL should parse");
        assert_eq!(
            validate_resolved_url_allowed(&url, false),
            Err("Private-network URLs are disabled by default.".to_string())
        );
    }

    #[test]
    fn resolved_address_guard_blocks_synthetic_private_results() {
        let public = vec!["93.184.216.34:443".parse::<SocketAddr>().expect("valid address")];
        let private = vec!["127.0.0.1:443".parse::<SocketAddr>().expect("valid address")];

        assert!(validate_resolved_addresses_allowed(&public, false).is_ok());
        assert_eq!(
            validate_resolved_addresses_allowed(&private, false),
            Err("Private-network URLs are disabled by default.".to_string())
        );
        assert!(validate_resolved_addresses_allowed(&private, true).is_ok());
    }

    #[test]
    fn dns_override_hostname_preserves_trailing_dot_for_pinning() {
        assert_eq!(normalized_hostname("Example.com."), "example.com");
        assert_eq!(dns_override_hostname("Example.com."), "example.com.");
    }

    #[test]
    fn url_guard_rejects_unsupported_schemes() {
        let url = reqwest::Url::parse("file:///etc/passwd").expect("test URL should parse");
        assert_eq!(
            validate_url_allowed(&url, false),
            Err("Only http/https URLs are supported.".to_string())
        );
    }

    #[test]
    fn content_type_guard_rejects_unreadable_types() {
        assert!(is_readable_content_type("text/html; charset=utf-8"));
        assert!(is_readable_content_type("text/plain"));
        assert!(is_readable_content_type("application/xhtml+xml"));
        assert!(!is_readable_content_type("image/png"));
        assert!(!is_readable_content_type("application/pdf"));
    }

    #[test]
    fn response_size_guard_counts_multibyte_body_bytes() {
        let oversized = "é".repeat((MAX_CONTENT_BYTES as usize / 2) + 1);
        assert!(is_response_body_too_large(&oversized));
    }

    #[test]
    fn html_extraction_decodes_entities_and_records_low_confidence() {
        let text = strip_html(
            "<html><head><title>Example</title></head><body><script>hidden()</script><p>Alpha &amp; beta &lt; gamma &quot;quoted&quot; &#39;text&#39;.</p></body></html>",
        );

        assert!(text.contains("Alpha & beta < gamma \"quoted\" 'text'."));
        assert!(estimate_confidence(&text) < 0.5);
    }

    #[test]
    fn html_extraction_decodes_named_decimal_and_hex_entities() {
        let text = strip_html("<p>Alice&apos;s note uses numeric &#8217; and hex &#x2019; apostrophes.</p>");

        assert!(text.contains("Alice's note uses numeric ’ and hex ’ apostrophes."));
    }

    #[test]
    fn html_extraction_prefers_article_body_over_page_chrome() {
        let (text, notes) = extract_readable_html(include_str!("../../../../tests/fixtures/article-shell.html"));

        assert!(text.contains("Creator workflow notes"));
        assert!(text.contains("source-checking guidance"));
        assert!(text.contains("Alice's editor note uses numeric ’ and hex ’ apostrophes"));
        assert!(!text.contains("Navigation item login"));
        assert!(!text.contains("Newsletter signup"));
        assert!(notes.iter().any(|note| note.contains("article body")));
    }
}
