=== FlavorPress Content Analyzer ===
Contributors: flavorpress
Tags: content, editorial, gutenberg, analysis
Requires at least: 6.4
Tested up to: 6.9
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Experimental local-first editorial content analysis for WordPress.

== Description ==

FlavorPress Content Analyzer is an experimental local-first prototype created during Automattic Radical Speed Month as part of Lucas and Matthias's FlavorPress initiative.

The plugin is provided as-is, without warranties. It adds a public Gutenberg block with text and analysis-context controls for local browser analysis, an editor sidebar action for analyzing the current draft, and a private WordPress admin report history. Reports are review signals only. They are not guarantees, certifications, or production approvals.

Analysis runs in the browser from the bundled shared analyzer core with conservative local proofreading. Report storage remains local to the WordPress site. No hosted analysis service is used.

== Installation ==

This scaffold is intended for local development WordPress sites.

1. Build the plugin assets.
2. Copy or symlink this directory into `wp-content/plugins`.
3. Activate FlavorPress Content Analyzer.
4. Add the Content Analyzer block or open the editor sidebar tool.

Do not submit or distribute this plugin package without explicit maintainer approval.

== Frequently Asked Questions ==

= Does this send content to a hosted service? =

No. The current implementation runs analysis in the browser and stores reports in the local WordPress database.

Frontend submissions are still posted back to the same WordPress site so the plugin can store the report snapshot and maintain duplicate-detection and rate-limit hashes. They are not sent to a hosted third-party analysis service by the plugin.

= Is raw visitor text stored? =

By default, no. Full raw input text, source-related report details, excerpts, claim text, highlighted passages, detailed proofreading items, claim-specific recommendations, and other client-supplied free-text report details are redacted unless an administrator opts in for future reports from the plugin settings screen.

Stored reports still keep salted hashes of the input, visitor IP plus user agent, and user agent for duplicate detection, rate limiting, and admin history. Reports remain in the local WordPress database until an administrator deletes them.

= Are reports authoritative? =

No. Reports are directional review signals and should be reviewed by a human editor.

== Changelog ==

= 0.1.0 =

* Experimental local-first scaffold.
