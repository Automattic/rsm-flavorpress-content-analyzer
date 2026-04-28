<?php
/**
 * Plugin Name: FlavorPress Content Analyzer
 * Description: Adds local editorial content analysis forms, editor tools, and admin report history.
 * Version: 0.1.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Author: FlavorPress
 * License: GPL-3.0-or-later
 * Text Domain: flavorpress-content-analyzer
 * Update URI: false
 */

if (!defined('ABSPATH')) {
    exit;
}

const FPCA_VERSION = '0.1.0';
const FPCA_DB_VERSION = '20260428.1';
const FPCA_REST_NAMESPACE = 'flavorpress/v1';
const FPCA_MANAGE_CAPABILITY = 'manage_flavorpress_reports';
const FPCA_MAX_INPUT_LENGTH = 20000;
const FPCA_MAX_RESULT_BYTES = 2000000;
const FPCA_MAX_PUBLIC_RESULT_BYTES = 200000;
const FPCA_PUBLIC_HOURLY_LIMIT = 10;
const FPCA_PUBLIC_DAILY_LIMIT = 100;
const FPCA_PUBLIC_DUPLICATE_WINDOW = 3600;
const FPCA_RATE_LOCK_TTL = 30;

function fpca_table_name(): string
{
    global $wpdb;
    return $wpdb->prefix . 'fpca_reports';
}

function fpca_default_settings(): array
{
    return [
        'frontend_enabled' => true,
        'store_raw_text' => false,
    ];
}

function fpca_get_settings(): array
{
    $settings = get_option('fpca_settings', []);
    if (!is_array($settings)) {
        $settings = [];
    }
    return array_merge(fpca_default_settings(), $settings);
}

function fpca_required_schema_columns(): array
{
    return [
        'id',
        'created_at',
        'source_type',
        'post_id',
        'user_id',
        'mode',
        'analyzer_version',
        'genre',
        'language_hint',
        'input_hash',
        'input_length',
        'input_excerpt',
        'input_text',
        'stored_raw_text',
        'summary_headline',
        'quality_band',
        'provenance_band',
        'source_band',
        'word_count',
        'result_json',
        'visitor_hash',
        'user_agent_hash',
    ];
}

function fpca_schema_ready(): bool
{
    global $wpdb;
    $columns = $wpdb->get_col('DESC ' . fpca_table_name(), 0);
    if (!is_array($columns)) {
        return false;
    }
    return [] === array_diff(fpca_required_schema_columns(), $columns);
}

function fpca_install_schema(): bool
{
    global $wpdb;

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';

    $charset_collate = $wpdb->get_charset_collate();
    $table = fpca_table_name();
    $sql = "CREATE TABLE {$table} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        created_at datetime NOT NULL,
        source_type varchar(20) NOT NULL,
        post_id bigint(20) unsigned DEFAULT NULL,
        user_id bigint(20) unsigned DEFAULT NULL,
        mode varchar(20) NOT NULL DEFAULT 'editorial',
        analyzer_version varchar(32) DEFAULT NULL,
        genre varchar(32) DEFAULT NULL,
        language_hint varchar(16) DEFAULT NULL,
        input_hash char(64) NOT NULL,
        input_length int(10) unsigned NOT NULL DEFAULT 0,
        input_excerpt text,
        input_text longtext,
        stored_raw_text tinyint(1) unsigned NOT NULL DEFAULT 0,
        summary_headline text,
        quality_band varchar(32) DEFAULT NULL,
        provenance_band varchar(32) DEFAULT NULL,
        source_band varchar(32) DEFAULT NULL,
        word_count int(10) unsigned NOT NULL DEFAULT 0,
        result_json longtext NOT NULL,
        visitor_hash char(64) DEFAULT NULL,
        user_agent_hash char(64) DEFAULT NULL,
        PRIMARY KEY  (id),
        KEY created_at (created_at),
        KEY source_type (source_type),
        KEY post_id (post_id),
        KEY input_hash (input_hash),
        KEY visitor_hash (visitor_hash),
        KEY quality_band (quality_band),
        KEY provenance_band (provenance_band)
    ) {$charset_collate};";
    dbDelta($sql);

    return fpca_schema_ready();
}

function fpca_grant_admin_capability(): void
{
    add_option('fpca_settings', fpca_default_settings());

    $role = get_role('administrator');
    if ($role && !$role->has_cap(FPCA_MANAGE_CAPABILITY)) {
        $role->add_cap(FPCA_MANAGE_CAPABILITY);
    }
}

function fpca_install_site(): void
{
    $schema_ready = fpca_install_schema();
    fpca_grant_admin_capability();
    if ($schema_ready) {
        update_option('fpca_db_version', FPCA_DB_VERSION);
    }
}

function fpca_activate(bool $network_wide = false): void
{
    if ($network_wide && is_multisite()) {
        $site_ids = get_sites(['fields' => 'ids']);
        foreach ($site_ids as $site_id) {
            switch_to_blog((int) $site_id);
            fpca_install_site();
            restore_current_blog();
        }
        return;
    }

    fpca_install_site();
}
register_activation_hook(__FILE__, 'fpca_activate');

function fpca_maybe_upgrade(): void
{
    if (get_option('fpca_db_version') !== FPCA_DB_VERSION || !fpca_schema_ready()) {
        fpca_install_site();
    }
}
add_action('init', 'fpca_maybe_upgrade', 5);

function fpca_asset_version(string $relative_path): string
{
    $path = plugin_dir_path(__FILE__) . ltrim($relative_path, '/');
    return file_exists($path) ? (string) filemtime($path) : FPCA_VERSION;
}

function fpca_script_settings(): array
{
    $settings = fpca_get_settings();
    return [
        'restUrl' => esc_url_raw(rest_url(FPCA_REST_NAMESPACE . '/')),
        'nonce' => wp_create_nonce('wp_rest'),
        'adminUrl' => esc_url_raw(admin_url('admin.php?page=fpca-reports')),
        'frontendEnabled' => (bool) $settings['frontend_enabled'],
        'storeRawText' => (bool) $settings['store_raw_text'],
        'maxInputLength' => FPCA_MAX_INPUT_LENGTH,
        'analyzerVersion' => FPCA_VERSION,
    ];
}

function fpca_register_assets(): void
{
    $script_url = plugins_url('assets/block.js', __FILE__);
    $script_version = fpca_asset_version('assets/block.js');
    $style_url = plugins_url('assets/editor.css', __FILE__);
    $style_version = fpca_asset_version('assets/editor.css');

    wp_register_script(
        'fpca-editor',
        $script_url,
        ['wp-block-editor', 'wp-blocks', 'wp-components', 'wp-data', 'wp-edit-post', 'wp-element', 'wp-plugins'],
        $script_version,
        true
    );
    wp_register_script('fpca-frontend', $script_url, [], $script_version, true);

    $settings_json = wp_json_encode(fpca_script_settings());
    if (is_string($settings_json)) {
        wp_add_inline_script('fpca-editor', 'window.fpcaSettings = ' . $settings_json . ';', 'before');
        wp_add_inline_script('fpca-frontend', 'window.fpcaSettings = ' . $settings_json . ';', 'before');
    }

    wp_register_style('fpca-styles', $style_url, [], $style_version);

    register_block_type(__DIR__ . '/block.json', [
        'render_callback' => 'fpca_render_analyzer_block',
    ]);
}
add_action('init', 'fpca_register_assets');

function fpca_render_analyzer_block(): string
{
    $settings = fpca_get_settings();
    if (!$settings['frontend_enabled']) {
        return '';
    }
    $storage_notice = $settings['store_raw_text']
        ? __('The report is generated locally in your browser and stored for site administrators. This site is configured to store the full submitted text and detailed report content, which may include source-related snippets, plus salted hashes for duplicate detection and rate limiting. You will only see your latest report in this page session.', 'flavorpress-content-analyzer')
        : __('The report is generated locally in your browser and posted back to this same WordPress site so administrators can store aggregate report metadata. Full submitted text and content-bearing report details are discarded after hashing, duplicate checks, rate limiting, and report sanitization; the site stores salted hashes for duplicate detection and rate limiting. You will only see your latest report in this page session.', 'flavorpress-content-analyzer');

    ob_start();
    ?>
    <div class="fpca-frontend-analyzer" data-fpca-frontend>
        <form class="fpca-form" data-fpca-form>
            <label class="fpca-label">
                <span><?php esc_html_e('Text to analyze', 'flavorpress-content-analyzer'); ?></span>
                <textarea data-fpca-text rows="7" maxlength="<?php echo esc_attr((string) FPCA_MAX_INPUT_LENGTH); ?>" required></textarea>
            </label>
            <div class="fpca-context-grid">
                <label class="fpca-label">
                    <span><?php esc_html_e('Language', 'flavorpress-content-analyzer'); ?></span>
                    <select data-fpca-language>
                        <option value="auto" selected><?php esc_html_e('Auto-detect', 'flavorpress-content-analyzer'); ?></option>
                        <option value="en"><?php esc_html_e('English', 'flavorpress-content-analyzer'); ?></option>
                        <option value="es"><?php esc_html_e('Spanish', 'flavorpress-content-analyzer'); ?></option>
                        <option value="pt"><?php esc_html_e('Portuguese', 'flavorpress-content-analyzer'); ?></option>
                        <option value="fr"><?php esc_html_e('French', 'flavorpress-content-analyzer'); ?></option>
                        <option value="de"><?php esc_html_e('German', 'flavorpress-content-analyzer'); ?></option>
                    </select>
                </label>
                <label class="fpca-label">
                    <span><?php esc_html_e('Genre', 'flavorpress-content-analyzer'); ?></span>
                    <select data-fpca-genre>
                        <option value="auto"><?php esc_html_e('Auto-detect', 'flavorpress-content-analyzer'); ?></option>
                        <option value="general"><?php esc_html_e('General', 'flavorpress-content-analyzer'); ?></option>
                        <option value="article"><?php esc_html_e('Article', 'flavorpress-content-analyzer'); ?></option>
                        <option value="marketing"><?php esc_html_e('Marketing', 'flavorpress-content-analyzer'); ?></option>
                        <option value="support"><?php esc_html_e('Support', 'flavorpress-content-analyzer'); ?></option>
                        <option value="documentation"><?php esc_html_e('Documentation', 'flavorpress-content-analyzer'); ?></option>
                        <option value="policy"><?php esc_html_e('Policy', 'flavorpress-content-analyzer'); ?></option>
                        <option value="legal"><?php esc_html_e('Legal', 'flavorpress-content-analyzer'); ?></option>
                        <option value="academic"><?php esc_html_e('Academic', 'flavorpress-content-analyzer'); ?></option>
                        <option value="corporate"><?php esc_html_e('Corporate', 'flavorpress-content-analyzer'); ?></option>
                    </select>
                </label>
                <label class="fpca-label">
                    <span><?php esc_html_e('Review focus', 'flavorpress-content-analyzer'); ?></span>
                    <select data-fpca-goal>
                        <option value="editorial_triage" selected><?php esc_html_e('Editorial triage', 'flavorpress-content-analyzer'); ?></option>
                        <option value="publish_ready_review"><?php esc_html_e('Publishing readiness', 'flavorpress-content-analyzer'); ?></option>
                        <option value="source_support"><?php esc_html_e('Source support', 'flavorpress-content-analyzer'); ?></option>
                        <option value="clarity_rewrite"><?php esc_html_e('Clarity rewrite', 'flavorpress-content-analyzer'); ?></option>
                        <option value="risk_review"><?php esc_html_e('Risk review', 'flavorpress-content-analyzer'); ?></option>
                    </select>
                </label>
            </div>
            <label class="fpca-label">
                <span><?php esc_html_e('Reference sources', 'flavorpress-content-analyzer'); ?></span>
                <textarea data-fpca-sources rows="3" maxlength="<?php echo esc_attr((string) FPCA_MAX_INPUT_LENGTH); ?>" placeholder="<?php echo esc_attr__('One source URL, citation, or source excerpt per line.', 'flavorpress-content-analyzer'); ?>"></textarea>
            </label>
            <button type="submit"><?php esc_html_e('Run content analysis', 'flavorpress-content-analyzer'); ?></button>
            <p class="fpca-muted"><?php echo esc_html($storage_notice); ?></p>
            <p class="fpca-status" data-fpca-status aria-live="polite"></p>
        </form>
        <div data-fpca-output role="region" aria-live="polite" aria-label="<?php echo esc_attr__('Latest content analysis report', 'flavorpress-content-analyzer'); ?>"></div>
    </div>
    <?php
    return (string) ob_get_clean();
}

function fpca_verify_rest_nonce(WP_REST_Request $request): bool
{
    $nonce = $request->get_header('x_wp_nonce');
    if (!$nonce) {
        $nonce = $request->get_header('x-wp-nonce');
    }
    return is_string($nonce) && (bool) wp_verify_nonce($nonce, 'wp_rest');
}

function fpca_remote_ip_hash(): string
{
    $address = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '';
    return hash_hmac('sha256', $address, wp_salt('auth'));
}

function fpca_visitor_hash(): string
{
    $address = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '';
    $agent = isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])) : '';
    return hash_hmac('sha256', $address . '|' . $agent, wp_salt('auth'));
}

function fpca_input_hash(string $input_text): string
{
    return hash_hmac('sha256', $input_text, wp_salt('auth'));
}

function fpca_rate_limit_lock_key(): string
{
    return 'fpca_rate_lock';
}

function fpca_acquire_rate_limit_lock(string $lock_key): bool
{
    $now = time();
    if (add_option($lock_key, (string) $now, '', 'no')) {
        return true;
    }

    $created_at = (int) get_option($lock_key, 0);
    if ($created_at > 0 && $created_at < $now - FPCA_RATE_LOCK_TTL) {
        delete_option($lock_key);
        return add_option($lock_key, (string) $now, '', 'no');
    }

    return false;
}

function fpca_release_rate_limit_lock(string $lock_key): void
{
    delete_option($lock_key);
}

function fpca_rate_limit_public()
{
    $lock_key = fpca_rate_limit_lock_key();
    if (!fpca_acquire_rate_limit_lock($lock_key)) {
        return new WP_Error('fpca_rate_busy', __('Analysis traffic is busy. Try again in a moment.', 'flavorpress-content-analyzer'), ['status' => 429]);
    }

    try {
        $hour_key = 'fpca_rate_ip_' . fpca_remote_ip_hash();
        $hour_count = (int) get_transient($hour_key);
        if ($hour_count >= FPCA_PUBLIC_HOURLY_LIMIT) {
            return new WP_Error('fpca_rate_limited', __('Too many analysis requests. Try again later.', 'flavorpress-content-analyzer'), ['status' => 429]);
        }

        $day_key = 'fpca_rate_site_' . gmdate('Ymd');
        $day_count = (int) get_transient($day_key);
        if ($day_count >= FPCA_PUBLIC_DAILY_LIMIT) {
            return new WP_Error('fpca_site_rate_limited', __('The site has reached today\'s public analysis limit.', 'flavorpress-content-analyzer'), ['status' => 429]);
        }

        set_transient($hour_key, $hour_count + 1, HOUR_IN_SECONDS);
        set_transient($day_key, $day_count + 1, DAY_IN_SECONDS);
        return true;
    } finally {
        fpca_release_rate_limit_lock($lock_key);
    }
}

function fpca_public_permission(WP_REST_Request $request)
{
    $settings = fpca_get_settings();
    if (!$settings['frontend_enabled']) {
        return new WP_Error('fpca_frontend_disabled', __('Frontend analysis is disabled.', 'flavorpress-content-analyzer'), ['status' => 403]);
    }
    if (!fpca_verify_rest_nonce($request)) {
        return new WP_Error('fpca_bad_nonce', __('The analysis session expired. Reload the page and try again.', 'flavorpress-content-analyzer'), ['status' => 403]);
    }
    return true;
}

function fpca_editor_permission(WP_REST_Request $request)
{
    if (!fpca_verify_rest_nonce($request)) {
        return new WP_Error('fpca_bad_nonce', __('The analysis session expired. Reload the editor and try again.', 'flavorpress-content-analyzer'), ['status' => 403]);
    }
    $post_id = absint($request->get_param('postId'));
    if (!$post_id || !current_user_can('edit_post', $post_id)) {
        return new WP_Error('fpca_forbidden', __('You cannot analyze this post.', 'flavorpress-content-analyzer'), ['status' => 403]);
    }
    return true;
}

function fpca_admin_permission(): bool
{
    return current_user_can(FPCA_MANAGE_CAPABILITY) || current_user_can('manage_options');
}

function fpca_settings_permission(): bool
{
    return current_user_can('manage_options');
}

function fpca_admin_menu_capability(): string
{
    return current_user_can(FPCA_MANAGE_CAPABILITY) ? FPCA_MANAGE_CAPABILITY : 'manage_options';
}

function fpca_allowed_mode(string $mode): string
{
    return in_array($mode, ['editorial', 'integrity', 'research'], true) ? $mode : 'editorial';
}

function fpca_result_value(array $result, array $path, $default = '')
{
    $value = $result;
    foreach ($path as $key) {
        if (!is_array($value) || !array_key_exists($key, $value)) {
            return $default;
        }
        $value = $value[$key];
    }
    return $value;
}

function fpca_recent_public_duplicate(string $visitor_hash, string $input_hash): ?int
{
    global $wpdb;
    $cutoff = gmdate('Y-m-d H:i:s', time() - FPCA_PUBLIC_DUPLICATE_WINDOW);
    $id = $wpdb->get_var($wpdb->prepare(
        'SELECT id FROM ' . fpca_table_name() . ' WHERE source_type = %s AND visitor_hash = %s AND input_hash = %s AND created_at >= %s ORDER BY id DESC LIMIT 1',
        'frontend',
        $visitor_hash,
        $input_hash,
        $cutoff
    ));
    return $id ? (int) $id : null;
}

function fpca_sanitize_text_value($value, int $max = 300): string
{
    if (is_array($value) || is_object($value) || null === $value) {
        return '';
    }
    $text = wp_strip_all_tags((string) $value);
    $text = preg_replace('/\s+/u', ' ', $text);
    $text = trim(is_string($text) ? $text : '');
    if (function_exists('mb_strlen') && function_exists('mb_substr')) {
        return mb_strlen($text) > $max ? mb_substr($text, 0, $max) : $text;
    }
    return strlen($text) > $max ? substr($text, 0, $max) : $text;
}

function fpca_sanitize_key_value($value): string
{
    return is_scalar($value) ? sanitize_key((string) $value) : '';
}

function fpca_sanitize_enum($value, array $allowed, string $default): string
{
    $key = fpca_sanitize_key_value($value);
    return in_array($key, $allowed, true) ? $key : $default;
}

function fpca_sanitize_float_value($value, float $default = 0.0, ?float $min = null, ?float $max = null): float
{
    $number = is_numeric($value) ? (float) $value : $default;
    if (null !== $min) {
        $number = max($min, $number);
    }
    if (null !== $max) {
        $number = min($max, $number);
    }
    return $number;
}

function fpca_sanitize_int_value($value, int $default = 0, ?int $min = null, ?int $max = null): int
{
    $number = is_numeric($value) ? (int) $value : $default;
    if (null !== $min) {
        $number = max($min, $number);
    }
    if (null !== $max) {
        $number = min($max, $number);
    }
    return $number;
}

function fpca_sanitize_bool_value($value): bool
{
    return filter_var($value, FILTER_VALIDATE_BOOLEAN);
}

function fpca_sanitize_text_list($value, int $limit = 10, int $max = 300): array
{
    if (!is_array($value)) {
        return [];
    }
    $items = [];
    foreach (array_slice($value, 0, $limit) as $entry) {
        $text = fpca_sanitize_text_value($entry, $max);
        if ('' !== $text) {
            $items[] = $text;
        }
    }
    return $items;
}

function fpca_sanitize_key_list($value, int $limit = 10): array
{
    if (!is_array($value)) {
        return [];
    }
    $items = [];
    foreach (array_slice($value, 0, $limit) as $entry) {
        $key = fpca_sanitize_key_value($entry);
        if ('' !== $key) {
            $items[] = $key;
        }
    }
    return $items;
}

function fpca_sanitize_metadata($value, int $limit = 12): array
{
    if (!is_array($value)) {
        return [];
    }
    $metadata = [];
    foreach (array_slice($value, 0, $limit, true) as $key => $entry) {
        $safe_key = fpca_sanitize_key_value($key);
        if ('' === $safe_key) {
            continue;
        }
        if (is_bool($entry)) {
            $metadata[$safe_key] = $entry;
        } elseif (is_numeric($entry)) {
            $metadata[$safe_key] = fpca_sanitize_float_value($entry);
        } else {
            $metadata[$safe_key] = fpca_sanitize_text_value($entry, 180);
        }
    }
    return $metadata;
}

function fpca_sanitize_score_contributions($value, int $limit = 80): array
{
    if (!is_array($value)) {
        return [];
    }
    $items = [];
    foreach (array_slice($value, 0, $limit) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $items[] = [
            'metricId' => fpca_sanitize_key_value($entry['metricId'] ?? ''),
            'label' => fpca_sanitize_text_value($entry['label'] ?? '', 120),
            'value' => fpca_sanitize_float_value($entry['value'] ?? 0),
            'weight' => fpca_sanitize_float_value($entry['weight'] ?? 0),
            'impact' => fpca_sanitize_float_value($entry['impact'] ?? 0),
            'direction' => fpca_sanitize_enum($entry['direction'] ?? '', ['positive', 'negative', 'neutral'], 'neutral'),
            'reasonCode' => fpca_sanitize_key_value($entry['reasonCode'] ?? ''),
        ];
    }
    return $items;
}

function fpca_sanitize_dimensions($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $items = [];
    foreach (array_slice($value, 0, 30) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $items[] = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'label' => fpca_sanitize_text_value($entry['label'] ?? '', 120),
            'family' => fpca_sanitize_key_value($entry['family'] ?? ''),
            'score' => fpca_sanitize_float_value($entry['score'] ?? 0, 0, 0, 100),
            'confidence' => fpca_sanitize_float_value($entry['confidence'] ?? 0, 0, 0, 1),
            'findings' => fpca_sanitize_text_list($entry['findings'] ?? [], 8, 400),
            'recommendations' => fpca_sanitize_text_list($entry['recommendations'] ?? [], 8, 400),
            'falsePositiveContexts' => fpca_sanitize_text_list($entry['falsePositiveContexts'] ?? [], 8, 240),
            'reasonCodes' => fpca_sanitize_key_list($entry['reasonCodes'] ?? [], 12),
            'metricIds' => fpca_sanitize_key_list($entry['metricIds'] ?? [], 12),
            'scoreContributions' => fpca_sanitize_score_contributions($entry['scoreContributions'] ?? [], 12),
        ];
    }
    return $items;
}

function fpca_sanitize_providers($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $items = [];
    foreach (array_slice($value, 0, 6) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $items[] = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'label' => fpca_sanitize_text_value($entry['label'] ?? '', 120),
            'version' => fpca_sanitize_text_value($entry['version'] ?? '', 40),
            'capabilities' => fpca_sanitize_key_list($entry['capabilities'] ?? [], 12),
            'supportedLanguages' => fpca_sanitize_key_list($entry['supportedLanguages'] ?? [], 12),
            'license' => fpca_sanitize_text_value($entry['license'] ?? '', 80),
            'egress' => fpca_sanitize_enum($entry['egress'] ?? '', ['none', 'localhost_only', 'remote'], 'none'),
            'spanSupport' => fpca_sanitize_bool_value($entry['spanSupport'] ?? false),
            'confidenceSemantics' => fpca_sanitize_text_value($entry['confidenceSemantics'] ?? '', 180),
            'enabledByDefault' => fpca_sanitize_bool_value($entry['enabledByDefault'] ?? false),
            'notes' => fpca_sanitize_text_list($entry['notes'] ?? [], 8, 240),
        ];
    }
    return $items;
}

function fpca_sanitize_proofreading($value, bool $store_raw_text): array
{
    $proofreading = is_array($value) ? $value : [];
    $issues = [];
    if ($store_raw_text && isset($proofreading['issues']) && is_array($proofreading['issues'])) {
        foreach (array_slice($proofreading['issues'], 0, 40) as $issue) {
            if (!is_array($issue)) {
                continue;
            }
            $issues[] = [
                'id' => fpca_sanitize_key_value($issue['id'] ?? ''),
                'start' => fpca_sanitize_int_value($issue['start'] ?? 0, 0, 0),
                'end' => fpca_sanitize_int_value($issue['end'] ?? 0, 0, 0),
                'kind' => fpca_sanitize_key_value($issue['kind'] ?? ''),
                'severity' => fpca_sanitize_enum($issue['severity'] ?? '', ['low', 'medium', 'high'], 'low'),
                'message' => fpca_sanitize_text_value($issue['message'] ?? '', 400),
                'suggestions' => fpca_sanitize_text_list($issue['suggestions'] ?? [], 5, 120),
                'source' => fpca_sanitize_key_value($issue['source'] ?? ''),
                'confidence' => fpca_sanitize_float_value($issue['confidence'] ?? 0, 0, 0, 1),
            ];
        }
    }
    return [
        'status' => fpca_sanitize_enum($proofreading['status'] ?? '', ['available', 'disabled', 'abstained', 'error'], 'abstained'),
        'language' => fpca_sanitize_key_value($proofreading['language'] ?? 'unknown'),
        'providers' => fpca_sanitize_providers($proofreading['providers'] ?? []),
        'issues' => $issues,
        'issueCount' => isset($proofreading['issues']) && is_array($proofreading['issues']) ? count($proofreading['issues']) : 0,
        'caveats' => fpca_sanitize_text_list($proofreading['caveats'] ?? [], 8, 300),
    ];
}

function fpca_sanitize_claims($value, bool $store_raw_text): array
{
    if (!is_array($value)) {
        return [];
    }
    $claims = [];
    foreach (array_slice($value, 0, 32) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $claim = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'type' => fpca_sanitize_enum($entry['type'] ?? '', ['factual', 'opinion', 'prediction', 'recommendation', 'unverifiable'], 'unverifiable'),
            'status' => fpca_sanitize_enum($entry['status'] ?? '', ['supported', 'partially_supported', 'inline_citation_only', 'unsupported', 'not_checked'], 'not_checked'),
            'sentenceIndex' => fpca_sanitize_int_value($entry['sentenceIndex'] ?? 0, 0, 0),
            'paragraphIndex' => fpca_sanitize_int_value($entry['paragraphIndex'] ?? 0, 0, 0),
            'sectionId' => fpca_sanitize_key_value($entry['sectionId'] ?? ''),
            'importance' => fpca_sanitize_enum($entry['importance'] ?? '', ['low', 'medium', 'high'], 'low'),
            'supportCoverage' => fpca_sanitize_float_value($entry['supportCoverage'] ?? 0, 0, 0, 1),
            'freshnessRisk' => fpca_sanitize_bool_value($entry['freshnessRisk'] ?? false),
            'supportNeed' => fpca_sanitize_enum($entry['supportNeed'] ?? '', ['none', 'recommended', 'important', 'essential'], 'none'),
        ];
        if ($store_raw_text) {
            $claim['claim'] = fpca_sanitize_text_value($entry['claim'] ?? '', 1000);
            $claim['start'] = fpca_sanitize_int_value($entry['start'] ?? 0, 0, 0);
            $claim['end'] = fpca_sanitize_int_value($entry['end'] ?? 0, 0, 0);
            $claim['entities'] = fpca_sanitize_text_list($entry['entities'] ?? [], 8, 120);
            $claim['numbers'] = fpca_sanitize_text_list($entry['numbers'] ?? [], 8, 80);
            $claim['dates'] = fpca_sanitize_text_list($entry['dates'] ?? [], 8, 80);
            $claim['evidence'] = fpca_sanitize_text_list($entry['evidence'] ?? [], 8, 240);
            $claim['notes'] = fpca_sanitize_text_value($entry['notes'] ?? '', 400);
            $claim['inlineCitations'] = fpca_sanitize_text_list($entry['inlineCitations'] ?? [], 8, 240);
            $claim['supportGaps'] = fpca_sanitize_text_list($entry['supportGaps'] ?? [], 5, 240);
            $claim['recommendedAction'] = fpca_sanitize_text_value($entry['recommendedAction'] ?? '', 400);
        }
        $claims[] = $claim;
    }
    return $claims;
}

function fpca_sanitize_spans($value, bool $store_raw_text): array
{
    if (!$store_raw_text || !is_array($value)) {
        return [];
    }
    $spans = [];
    foreach (array_slice($value, 0, 80) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $spans[] = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'start' => fpca_sanitize_int_value($entry['start'] ?? 0, 0, 0),
            'end' => fpca_sanitize_int_value($entry['end'] ?? 0, 0, 0),
            'label' => fpca_sanitize_key_value($entry['label'] ?? ''),
            'severity' => fpca_sanitize_enum($entry['severity'] ?? '', ['low', 'medium', 'high'], 'low'),
            'explanation' => fpca_sanitize_text_value($entry['explanation'] ?? '', 400),
            'suggestion' => fpca_sanitize_text_value($entry['suggestion'] ?? '', 400),
        ];
    }
    return $spans;
}

function fpca_sanitize_section_items($value, string $kind, bool $store_raw_text): array
{
    if (!is_array($value)) {
        return [];
    }
    $content_bearing = ['top_actions', 'claim_review', 'highlighted_passages', 'proofreading'];
    if (!$store_raw_text && in_array($kind, $content_bearing, true) && count($value) > 0) {
        return [[
            'id' => 'redacted',
            'title' => __('Details redacted', 'flavorpress-content-analyzer'),
            'body' => __('Content-bearing report details are redacted because raw text storage was disabled for this report.', 'flavorpress-content-analyzer'),
            'severity' => 'low',
            'metadata' => ['redactedItems' => min(count($value), 999)],
        ]];
    }

    $items = [];
    foreach (array_slice($value, 0, 40) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $item = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'title' => fpca_sanitize_text_value($entry['title'] ?? '', 160),
            'body' => fpca_sanitize_text_value($entry['body'] ?? '', 1000),
        ];
        if (isset($entry['severity'])) {
            $item['severity'] = fpca_sanitize_enum($entry['severity'], ['low', 'medium', 'high'], 'low');
        }
        if (isset($entry['score'])) {
            $item['score'] = fpca_sanitize_float_value($entry['score']);
        }
        if (isset($entry['status'])) {
            $item['status'] = fpca_sanitize_text_value($entry['status'], 120);
        }
        if (isset($entry['metadata'])) {
            $item['metadata'] = fpca_sanitize_metadata($entry['metadata']);
        }
        $items[] = $item;
    }
    return $items;
}

function fpca_sanitize_analysis_sections($value, bool $store_raw_text): array
{
    if (!is_array($value)) {
        return [];
    }
    $sections = [];
    foreach (array_slice($value, 0, 12) as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $kind = fpca_sanitize_enum(
            $entry['kind'] ?? '',
            ['top_actions', 'score_overview', 'content_audit', 'context_confidence', 'writing_quality', 'provenance_risk', 'proofreading', 'claim_review', 'highlighted_passages', 'caveats', 'raw_diagnostics'],
            'caveats'
        );
        $sections[] = [
            'id' => fpca_sanitize_key_value($entry['id'] ?? ''),
            'title' => fpca_sanitize_text_value($entry['title'] ?? '', 160),
            'kind' => $kind,
            'summary' => fpca_sanitize_text_value($entry['summary'] ?? '', 500),
            'items' => fpca_sanitize_section_items($entry['items'] ?? [], $kind, $store_raw_text),
        ];
    }
    return $sections;
}

function fpca_sanitize_raw_metrics($value): ?array
{
    if (!is_array($value)) {
        return null;
    }
    $metrics = [];
    foreach (array_slice($value, 0, 80, true) as $key => $entry) {
        if (is_numeric($entry)) {
            $metrics[fpca_sanitize_key_value($key)] = fpca_sanitize_float_value($entry);
        }
    }
    return $metrics;
}

function fpca_compact_label(string $value): string
{
    return str_replace('_', ' ', $value);
}

function fpca_report_headline_from_bands(string $quality_band, string $provenance_band, string $source_band): string
{
    return sprintf(
        /* translators: 1: quality band, 2: provenance-risk band, 3: source-support band. */
        __('Quality is %1$s; provenance-risk is %2$s; source support is %3$s.', 'flavorpress-content-analyzer'),
        $quality_band,
        fpca_compact_label($provenance_band),
        fpca_compact_label($source_band)
    );
}

function fpca_redacted_sections(array $summary, array $context, array $claim_review): array
{
    return [
        [
            'id' => 'score-overview',
            'title' => __('Score Overview', 'flavorpress-content-analyzer'),
            'kind' => 'score_overview',
            'summary' => __('Only non-content bands are stored because raw text storage was disabled.', 'flavorpress-content-analyzer'),
            'items' => [
                [
                    'id' => 'quality-band',
                    'title' => __('Writing quality', 'flavorpress-content-analyzer'),
                    'body' => (string) $summary['qualityBand'],
                    'status' => (string) $summary['qualityBand'],
                ],
                [
                    'id' => 'provenance-band',
                    'title' => __('Provenance-risk', 'flavorpress-content-analyzer'),
                    'body' => fpca_compact_label((string) $summary['provenanceBand']),
                    'status' => (string) $summary['provenanceBand'],
                ],
                [
                    'id' => 'source-band',
                    'title' => __('Source support', 'flavorpress-content-analyzer'),
                    'body' => fpca_compact_label((string) $summary['sourceBand']),
                    'status' => (string) $summary['sourceBand'],
                ],
            ],
        ],
        [
            'id' => 'context-confidence',
            'title' => __('Context And Confidence', 'flavorpress-content-analyzer'),
            'kind' => 'context_confidence',
            'summary' => __('Only aggregate counts are stored because raw text storage was disabled.', 'flavorpress-content-analyzer'),
            'items' => [
                [
                    'id' => 'word-count',
                    'title' => __('Words', 'flavorpress-content-analyzer'),
                    'body' => (string) $context['wordCount'],
                ],
                [
                    'id' => 'sentence-count',
                    'title' => __('Sentences', 'flavorpress-content-analyzer'),
                    'body' => (string) $context['sentenceCount'],
                ],
                [
                    'id' => 'paragraph-count',
                    'title' => __('Paragraphs', 'flavorpress-content-analyzer'),
                    'body' => (string) $context['paragraphCount'],
                ],
            ],
        ],
        [
            'id' => 'claim-review',
            'title' => __('Claim And Source Review', 'flavorpress-content-analyzer'),
            'kind' => 'claim_review',
            'summary' => __('Only aggregate claim counts are stored because raw text storage was disabled.', 'flavorpress-content-analyzer'),
            'items' => [
                [
                    'id' => 'total-claims',
                    'title' => __('Total claims', 'flavorpress-content-analyzer'),
                    'body' => (string) $claim_review['totalClaims'],
                ],
                [
                    'id' => 'unsupported-claims',
                    'title' => __('Unsupported claims', 'flavorpress-content-analyzer'),
                    'body' => (string) $claim_review['unsupportedClaims'],
                ],
                [
                    'id' => 'freshness-risk-claims',
                    'title' => __('Freshness-risk claims', 'flavorpress-content-analyzer'),
                    'body' => (string) $claim_review['freshnessRiskClaims'],
                ],
            ],
        ],
        [
            'id' => 'redaction',
            'title' => __('Redaction', 'flavorpress-content-analyzer'),
            'kind' => 'caveats',
            'items' => [
                [
                    'id' => 'content-redacted',
                    'title' => __('Details redacted', 'flavorpress-content-analyzer'),
                    'body' => __('Raw input and client-supplied free-text report details were not stored for this report.', 'flavorpress-content-analyzer'),
                    'severity' => 'low',
                ],
            ],
        ],
    ];
}

function fpca_sanitize_report_result(array $result, bool $store_raw_text)
{
    if (!isset($result['summary']) || !is_array($result['summary']) || !isset($result['context']) || !is_array($result['context'])) {
        return new WP_Error('fpca_bad_result_schema', __('The analyzer result is missing required summary or context fields.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }

    $input_summary = isset($result['inputSummary']) && is_array($result['inputSummary']) ? $result['inputSummary'] : [];
    $summary = $result['summary'];
    $context = $result['context'];
    $claim_review = isset($result['claimReview']) && is_array($result['claimReview']) ? $result['claimReview'] : [];
    $raw_metrics = fpca_sanitize_raw_metrics($result['rawMetrics'] ?? null);
    $safe_input_summary = [
        'inputType' => fpca_sanitize_enum($input_summary['inputType'] ?? '', ['text', 'url'], 'text'),
        'languageHint' => fpca_sanitize_key_value($input_summary['languageHint'] ?? ''),
        'locale' => fpca_sanitize_key_value($input_summary['locale'] ?? ''),
        'genre' => fpca_sanitize_key_value($input_summary['genre'] ?? ''),
        'goal' => fpca_sanitize_enum($input_summary['goal'] ?? '', ['publish_ready_review', 'source_support', 'clarity_rewrite', 'risk_review', 'editorial_triage'], ''),
        'sourceCount' => fpca_sanitize_int_value($input_summary['sourceCount'] ?? 0, 0, 0),
        'wordCount' => fpca_sanitize_int_value($input_summary['wordCount'] ?? 0, 0, 0),
        'sentenceCount' => fpca_sanitize_int_value($input_summary['sentenceCount'] ?? 0, 0, 0),
        'paragraphCount' => fpca_sanitize_int_value($input_summary['paragraphCount'] ?? 0, 0, 0),
    ];
    $safe_claim_review = [
        'totalClaims' => fpca_sanitize_int_value($claim_review['totalClaims'] ?? 0, 0, 0),
        'factualClaims' => fpca_sanitize_int_value($claim_review['factualClaims'] ?? 0, 0, 0),
        'supportedByProvidedMaterial' => fpca_sanitize_int_value($claim_review['supportedByProvidedMaterial'] ?? 0, 0, 0),
        'partiallySupportedByProvidedMaterial' => fpca_sanitize_int_value($claim_review['partiallySupportedByProvidedMaterial'] ?? 0, 0, 0),
        'inlineCitationOnly' => fpca_sanitize_int_value($claim_review['inlineCitationOnly'] ?? 0, 0, 0),
        'unsupportedClaims' => fpca_sanitize_int_value($claim_review['unsupportedClaims'] ?? 0, 0, 0),
        'notCheckedClaims' => fpca_sanitize_int_value($claim_review['notCheckedClaims'] ?? 0, 0, 0),
        'freshnessRiskClaims' => fpca_sanitize_int_value($claim_review['freshnessRiskClaims'] ?? 0, 0, 0),
        'sourceCount' => fpca_sanitize_int_value($claim_review['sourceCount'] ?? 0, 0, 0),
        'caveats' => $store_raw_text ? fpca_sanitize_text_list($claim_review['caveats'] ?? [], 8, 300) : [],
    ];
    $safe_context = [
        'detectedLanguage' => fpca_sanitize_key_value($context['detectedLanguage'] ?? 'unknown'),
        'languageConfidence' => fpca_sanitize_float_value($context['languageConfidence'] ?? 0, 0, 0, 1),
        'detectedGenre' => fpca_sanitize_key_value($context['detectedGenre'] ?? 'general'),
        'genreConfidence' => fpca_sanitize_float_value($context['genreConfidence'] ?? 0, 0, 0, 1),
        'textLengthStatus' => fpca_sanitize_enum($context['textLengthStatus'] ?? '', ['too_short', 'short', 'sufficient'], 'sufficient'),
        'wordCount' => fpca_sanitize_int_value($context['wordCount'] ?? 0, 0, 0),
        'sentenceCount' => fpca_sanitize_int_value($context['sentenceCount'] ?? 0, 0, 0),
        'paragraphCount' => fpca_sanitize_int_value($context['paragraphCount'] ?? 0, 0, 0),
        'script' => fpca_sanitize_key_value($context['script'] ?? ''),
        'mixedLanguage' => fpca_sanitize_bool_value($context['mixedLanguage'] ?? false),
        'assumptions' => $store_raw_text ? fpca_sanitize_text_list($context['assumptions'] ?? [], 8, 300) : [],
    ];
    $safe_summary = [
        'provenanceBand' => fpca_sanitize_enum($summary['provenanceBand'] ?? '', ['low', 'elevated', 'high', 'insufficient_evidence'], 'insufficient_evidence'),
        'provenanceConfidence' => fpca_sanitize_float_value($summary['provenanceConfidence'] ?? 0, 0, 0, 1),
        'qualityBand' => fpca_sanitize_enum($summary['qualityBand'] ?? '', ['poor', 'fair', 'good', 'strong'], 'fair'),
        'sourceBand' => fpca_sanitize_enum($summary['sourceBand'] ?? '', ['supported', 'mixed', 'weakly_supported', 'not_checked'], 'not_checked'),
        'headline' => '',
        'caveats' => $store_raw_text ? fpca_sanitize_text_list($summary['caveats'] ?? [], 8, 300) : [
            __('Content-bearing report details were redacted because raw text storage was disabled.', 'flavorpress-content-analyzer'),
        ],
        'keyPoints' => $store_raw_text ? fpca_sanitize_text_list($summary['keyPoints'] ?? [], 8, 300) : [],
    ];
    $safe_summary['headline'] = $store_raw_text
        ? fpca_sanitize_text_value($summary['headline'] ?? '', 300)
        : fpca_report_headline_from_bands($safe_summary['qualityBand'], $safe_summary['provenanceBand'], $safe_summary['sourceBand']);

    if (!$store_raw_text) {
        return [
            'reportProfile' => fpca_sanitize_enum($result['reportProfile'] ?? '', ['full', 'checklist', 'claims-csv', 'machine'], 'checklist'),
            'inputSummary' => $safe_input_summary,
            'analysisSections' => fpca_redacted_sections($safe_summary, $safe_context, $safe_claim_review),
            'scoreContributions' => [],
            'proofreading' => [
                'status' => fpca_sanitize_enum($result['proofreading']['status'] ?? '', ['available', 'disabled', 'abstained', 'error'], 'abstained'),
                'language' => isset($result['proofreading']) && is_array($result['proofreading']) ? fpca_sanitize_key_value($result['proofreading']['language'] ?? 'unknown') : 'unknown',
                'providers' => [],
                'issues' => [],
                'issueCount' => isset($result['proofreading']['issues']) && is_array($result['proofreading']['issues']) ? count($result['proofreading']['issues']) : 0,
                'caveats' => [],
            ],
            'claimReview' => $safe_claim_review,
            'context' => $safe_context,
            'summary' => $safe_summary,
            'dimensions' => [],
            'spans' => [],
            'claims' => [],
            'recommendations' => [],
            'generatedAt' => fpca_sanitize_text_value($result['generatedAt'] ?? gmdate('c'), 40),
            'storage' => [
                'generatedClientSide' => true,
                'rawTextStored' => false,
                'contentDetailsRedacted' => true,
                'trustNote' => __('This browser-generated result was stored as aggregate review metadata and was not recomputed server-side.', 'flavorpress-content-analyzer'),
            ],
        ];
    }

    $safe = [
        'reportProfile' => fpca_sanitize_enum($result['reportProfile'] ?? '', ['full', 'checklist', 'claims-csv', 'machine'], 'checklist'),
        'inputSummary' => $safe_input_summary,
        'analysisSections' => fpca_sanitize_analysis_sections($result['analysisSections'] ?? [], $store_raw_text),
        'scoreContributions' => fpca_sanitize_score_contributions($result['scoreContributions'] ?? []),
        'proofreading' => fpca_sanitize_proofreading($result['proofreading'] ?? [], $store_raw_text),
        'claimReview' => $safe_claim_review,
        'context' => $safe_context,
        'summary' => $safe_summary,
        'dimensions' => fpca_sanitize_dimensions($result['dimensions'] ?? []),
        'spans' => fpca_sanitize_spans($result['spans'] ?? [], $store_raw_text),
        'claims' => fpca_sanitize_claims($result['claims'] ?? [], $store_raw_text),
        'recommendations' => $store_raw_text ? fpca_sanitize_text_list($result['recommendations'] ?? [], 12, 1000) : [],
        'generatedAt' => fpca_sanitize_text_value($result['generatedAt'] ?? gmdate('c'), 40),
        'storage' => [
            'generatedClientSide' => true,
            'rawTextStored' => $store_raw_text,
            'contentDetailsRedacted' => !$store_raw_text,
            'trustNote' => __('This browser-generated result was stored as a directional review signal and was not recomputed server-side.', 'flavorpress-content-analyzer'),
        ],
    ];

    if ($store_raw_text) {
        $safe['inputSummary']['requestedUrl'] = esc_url_raw(fpca_sanitize_text_value($input_summary['requestedUrl'] ?? '', 2048));
        $safe['inputSummary']['finalUrl'] = esc_url_raw(fpca_sanitize_text_value($input_summary['finalUrl'] ?? '', 2048));
        $safe['inputSummary']['title'] = fpca_sanitize_text_value($input_summary['title'] ?? '', 300);
        $safe['inputSummary']['audience'] = fpca_sanitize_text_value($input_summary['audience'] ?? '', 180);
        if (isset($context['extraction']) && is_array($context['extraction'])) {
            $safe['context']['extraction'] = [
                'requestedUrl' => esc_url_raw(fpca_sanitize_text_value($context['extraction']['requestedUrl'] ?? '', 2048)),
                'finalUrl' => esc_url_raw(fpca_sanitize_text_value($context['extraction']['finalUrl'] ?? '', 2048)),
                'title' => fpca_sanitize_text_value($context['extraction']['title'] ?? '', 300),
                'contentType' => fpca_sanitize_text_value($context['extraction']['contentType'] ?? '', 100),
                'confidence' => fpca_sanitize_float_value($context['extraction']['confidence'] ?? 0, 0, 0, 1),
                'notes' => fpca_sanitize_text_list($context['extraction']['notes'] ?? [], 8, 300),
            ];
        }
    }

    if (null !== $raw_metrics) {
        $safe['rawMetrics'] = $raw_metrics;
    }

    return $safe;
}

function fpca_create_report(WP_REST_Request $request, string $source_type)
{
    global $wpdb;

    $params = $request->get_json_params();
    if (!is_array($params)) {
        return new WP_Error('fpca_bad_payload', __('Invalid report payload.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }

    $input_text = isset($params['inputText']) && is_string($params['inputText']) ? $params['inputText'] : '';
    $input_text = trim($input_text);
    if (strlen($input_text) < 20) {
        return new WP_Error('fpca_short_input', __('Add more content before running analysis.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }
    if (strlen($input_text) > FPCA_MAX_INPUT_LENGTH) {
        return new WP_Error('fpca_large_input', __('The submitted text is too large.', 'flavorpress-content-analyzer'), ['status' => 413]);
    }

    $result = isset($params['result']) && is_array($params['result']) ? $params['result'] : null;
    if (!$result) {
        return new WP_Error('fpca_missing_result', __('The analyzer result is missing.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }

    $post_id = $source_type === 'editor' ? absint($params['postId'] ?? 0) : null;
    $mode = fpca_allowed_mode(isset($params['mode']) && is_string($params['mode']) ? $params['mode'] : 'editorial');
    $input_hash = fpca_input_hash($input_text);
    $visitor_hash = fpca_visitor_hash();

    if ($source_type === 'frontend') {
        $duplicate_id = fpca_recent_public_duplicate($visitor_hash, $input_hash);
        if ($duplicate_id) {
            return rest_ensure_response([
                'duplicate' => true,
                'stored' => true,
            ]);
        }
        $rate_limit = fpca_rate_limit_public();
        if (is_wp_error($rate_limit)) {
            return $rate_limit;
        }
    }

    $incoming_result_json = wp_json_encode($result);
    if (!is_string($incoming_result_json)) {
        return new WP_Error('fpca_bad_result', __('The analyzer result could not be encoded.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }
    $max_result_bytes = $source_type === 'frontend' ? FPCA_MAX_PUBLIC_RESULT_BYTES : FPCA_MAX_RESULT_BYTES;
    if (strlen($incoming_result_json) > $max_result_bytes) {
        return new WP_Error('fpca_large_result', __('The analyzer result is too large.', 'flavorpress-content-analyzer'), ['status' => 413]);
    }

    $settings = fpca_get_settings();
    $store_raw_text = (bool) $settings['store_raw_text'];
    $stored_result = fpca_sanitize_report_result($result, $store_raw_text);
    if (is_wp_error($stored_result)) {
        return $stored_result;
    }
    $result_json = wp_json_encode($stored_result);
    if (!is_string($result_json)) {
        return new WP_Error('fpca_bad_result', __('The sanitized analyzer result could not be encoded.', 'flavorpress-content-analyzer'), ['status' => 400]);
    }
    if (strlen($result_json) > FPCA_MAX_RESULT_BYTES) {
        return new WP_Error('fpca_large_result', __('The stored analyzer result is too large.', 'flavorpress-content-analyzer'), ['status' => 413]);
    }

    $summary_headline = (string) fpca_result_value($stored_result, ['summary', 'headline'], '');
    $quality_band = (string) fpca_result_value($stored_result, ['summary', 'qualityBand'], '');
    $provenance_band = (string) fpca_result_value($stored_result, ['summary', 'provenanceBand'], '');
    $source_band = (string) fpca_result_value($stored_result, ['summary', 'sourceBand'], '');
    $word_count = absint(fpca_result_value($stored_result, ['context', 'wordCount'], 0));
    $input_summary = fpca_result_value($stored_result, ['inputSummary'], []);

    $inserted = $wpdb->insert(
        fpca_table_name(),
        [
            'created_at' => current_time('mysql', true),
            'source_type' => $source_type,
            'post_id' => $post_id ?: null,
            'user_id' => get_current_user_id() ?: null,
            'mode' => $mode,
            'analyzer_version' => FPCA_VERSION,
            'genre' => is_array($input_summary) && isset($input_summary['genre']) ? fpca_sanitize_key_value($input_summary['genre']) : null,
            'language_hint' => is_array($input_summary) && isset($input_summary['languageHint']) ? fpca_sanitize_key_value($input_summary['languageHint']) : null,
            'input_hash' => $input_hash,
            'input_length' => strlen($input_text),
            'input_excerpt' => $store_raw_text ? wp_html_excerpt(wp_strip_all_tags($input_text), 240, '...') : null,
            'input_text' => $store_raw_text ? $input_text : null,
            'stored_raw_text' => $store_raw_text ? 1 : 0,
            'summary_headline' => wp_strip_all_tags($summary_headline),
            'quality_band' => sanitize_key($quality_band),
            'provenance_band' => sanitize_key($provenance_band),
            'source_band' => sanitize_key($source_band),
            'word_count' => $word_count,
            'result_json' => $result_json,
            'visitor_hash' => $visitor_hash,
            'user_agent_hash' => hash_hmac('sha256', isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])) : '', wp_salt('auth')),
        ],
        ['%s', '%s', '%d', '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s']
    );

    if (!$inserted) {
        return new WP_Error('fpca_insert_failed', __('The report could not be stored.', 'flavorpress-content-analyzer'), ['status' => 500]);
    }

    $id = (int) $wpdb->insert_id;
    if ($source_type === 'frontend') {
        return rest_ensure_response([
            'stored' => true,
        ]);
    }

    return rest_ensure_response([
        'id' => $id,
        'adminUrl' => esc_url_raw(admin_url('admin.php?page=fpca-reports&report_id=' . $id)),
    ]);
}

function fpca_register_rest_routes(): void
{
    register_rest_route(FPCA_REST_NAMESPACE, '/frontend/reports', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => static fn(WP_REST_Request $request) => fpca_create_report($request, 'frontend'),
        'permission_callback' => 'fpca_public_permission',
    ]);

    register_rest_route(FPCA_REST_NAMESPACE, '/editor/reports', [
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => static fn(WP_REST_Request $request) => fpca_create_report($request, 'editor'),
        'permission_callback' => 'fpca_editor_permission',
    ]);

    register_rest_route(FPCA_REST_NAMESPACE, '/reports', [
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'fpca_rest_list_reports',
        'permission_callback' => 'fpca_admin_permission',
    ]);

    register_rest_route(FPCA_REST_NAMESPACE, '/reports/(?P<id>\d+)', [
        [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'fpca_rest_get_report',
            'permission_callback' => 'fpca_admin_permission',
        ],
        [
            'methods' => WP_REST_Server::DELETABLE,
            'callback' => 'fpca_rest_delete_report',
            'permission_callback' => 'fpca_admin_permission',
        ],
    ]);
}
add_action('rest_api_init', 'fpca_register_rest_routes');

function fpca_rest_list_reports(): WP_REST_Response
{
    global $wpdb;
    $rows = $wpdb->get_results("SELECT id, created_at, source_type, post_id, user_id, mode, analyzer_version, stored_raw_text, summary_headline, quality_band, provenance_band, source_band, word_count FROM " . fpca_table_name() . " ORDER BY created_at DESC LIMIT 100", ARRAY_A);
    return rest_ensure_response(is_array($rows) ? $rows : []);
}

function fpca_rest_get_report(WP_REST_Request $request)
{
    global $wpdb;
    $id = absint($request['id']);
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . fpca_table_name() . ' WHERE id = %d', $id), ARRAY_A);
    if (!$row) {
        return new WP_Error('fpca_not_found', __('Report not found.', 'flavorpress-content-analyzer'), ['status' => 404]);
    }
    return rest_ensure_response($row);
}

function fpca_rest_delete_report(WP_REST_Request $request)
{
    global $wpdb;
    $id = absint($request['id']);
    $wpdb->delete(fpca_table_name(), ['id' => $id], ['%d']);
    return rest_ensure_response(['deleted' => true]);
}

function fpca_admin_menu(): void
{
    $capability = fpca_admin_menu_capability();
    add_menu_page(
        __('Content Analyzer Reports', 'flavorpress-content-analyzer'),
        __('Content Analyzer', 'flavorpress-content-analyzer'),
        $capability,
        'fpca-reports',
        'fpca_render_reports_page',
        'dashicons-analytics',
        58
    );
    add_submenu_page(
        'fpca-reports',
        __('Content Analyzer Settings', 'flavorpress-content-analyzer'),
        __('Settings', 'flavorpress-content-analyzer'),
        'manage_options',
        'fpca-settings',
        'fpca_render_settings_page'
    );
}
add_action('admin_menu', 'fpca_admin_menu');

function fpca_get_report(int $id): ?array
{
    global $wpdb;
    $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . fpca_table_name() . ' WHERE id = %d', $id), ARRAY_A);
    return is_array($row) ? $row : null;
}

function fpca_render_reports_page(): void
{
    if (!fpca_admin_permission()) {
        wp_die(esc_html__('You cannot view analyzer reports.', 'flavorpress-content-analyzer'));
    }

    $report_id = isset($_GET['report_id']) ? absint($_GET['report_id']) : 0;
    echo '<div class="wrap">';
    echo '<h1>' . esc_html__('Content Analyzer Reports', 'flavorpress-content-analyzer') . '</h1>';
    echo '<p>' . esc_html__('Reports are local review signals. They are not guarantees, certifications, or production approvals.', 'flavorpress-content-analyzer') . '</p>';

    if ($report_id) {
        fpca_render_report_detail($report_id);
    } else {
        fpca_render_report_list();
    }

    echo '</div>';
}

function fpca_render_report_list(): void
{
    global $wpdb;
    $rows = $wpdb->get_results("SELECT id, created_at, source_type, post_id, user_id, analyzer_version, stored_raw_text, summary_headline, quality_band, provenance_band, source_band, word_count FROM " . fpca_table_name() . " ORDER BY created_at DESC LIMIT 100");

    if (!$rows) {
        echo '<p>' . esc_html__('No reports have been stored yet.', 'flavorpress-content-analyzer') . '</p>';
        return;
    }

    echo '<p class="description">' . esc_html__('Stored bands are browser-generated review snapshots and are not recomputed server-side.', 'flavorpress-content-analyzer') . '</p>';
    echo '<table class="widefat striped">';
    echo '<thead><tr>';
    foreach (['Date', 'Source', 'Post', 'Analyzer', 'Quality', 'Risk', 'Sources', 'Words', 'Raw', 'Actions'] as $heading) {
        echo '<th>' . esc_html($heading) . '</th>';
    }
    echo '</tr></thead><tbody>';
    foreach ($rows as $row) {
        $detail_url = admin_url('admin.php?page=fpca-reports&report_id=' . absint($row->id));
        $delete_url = wp_nonce_url(admin_url('admin-post.php?action=fpca_delete_report&report_id=' . absint($row->id)), 'fpca_delete_report_' . absint($row->id));
        $post_link = $row->post_id ? get_edit_post_link((int) $row->post_id) : '';
        echo '<tr>';
        echo '<td><a href="' . esc_url($detail_url) . '">' . esc_html(get_date_from_gmt($row->created_at)) . '</a><br><small>' . esc_html($row->summary_headline) . '</small></td>';
        echo '<td>' . esc_html($row->source_type) . '</td>';
        echo '<td>' . ($post_link ? '<a href="' . esc_url($post_link) . '">' . esc_html(get_the_title((int) $row->post_id)) . '</a>' : esc_html__('None', 'flavorpress-content-analyzer')) . '</td>';
        echo '<td>' . esc_html((string) $row->analyzer_version) . '</td>';
        echo '<td>' . esc_html($row->quality_band) . '</td>';
        echo '<td>' . esc_html(str_replace('_', ' ', (string) $row->provenance_band)) . '</td>';
        echo '<td>' . esc_html(str_replace('_', ' ', (string) $row->source_band)) . '</td>';
        echo '<td>' . esc_html((string) $row->word_count) . '</td>';
        echo '<td>' . esc_html($row->stored_raw_text ? __('Stored', 'flavorpress-content-analyzer') : __('Redacted', 'flavorpress-content-analyzer')) . '</td>';
        echo '<td><a href="' . esc_url($detail_url) . '">' . esc_html__('View', 'flavorpress-content-analyzer') . '</a> | <a href="' . esc_url($delete_url) . '">' . esc_html__('Delete', 'flavorpress-content-analyzer') . '</a></td>';
        echo '</tr>';
    }
    echo '</tbody></table>';
}

function fpca_render_report_detail(int $report_id): void
{
    $row = fpca_get_report($report_id);
    if (!$row) {
        echo '<p>' . esc_html__('Report not found.', 'flavorpress-content-analyzer') . '</p>';
        return;
    }

    $result = json_decode((string) $row['result_json'], true);
    echo '<p><a href="' . esc_url(admin_url('admin.php?page=fpca-reports')) . '">' . esc_html__('Back to reports', 'flavorpress-content-analyzer') . '</a></p>';
    echo '<h2>' . esc_html($row['summary_headline']) . '</h2>';
    echo '<p><strong>' . esc_html__('Source:', 'flavorpress-content-analyzer') . '</strong> ' . esc_html($row['source_type']) . ' ';
    echo '<strong>' . esc_html__('Created:', 'flavorpress-content-analyzer') . '</strong> ' . esc_html(get_date_from_gmt($row['created_at'])) . '</p>';
    echo '<p><strong>' . esc_html__('Analyzer:', 'flavorpress-content-analyzer') . '</strong> ' . esc_html((string) ($row['analyzer_version'] ?? '')) . '</p>';
    echo '<p><strong>' . esc_html__('Raw text:', 'flavorpress-content-analyzer') . '</strong> ' . esc_html(!empty($row['stored_raw_text']) ? __('stored', 'flavorpress-content-analyzer') : __('redacted', 'flavorpress-content-analyzer')) . '</p>';

    if (!empty($row['input_excerpt'])) {
        echo '<p><strong>' . esc_html__('Input excerpt:', 'flavorpress-content-analyzer') . '</strong> ' . esc_html((string) $row['input_excerpt']) . '</p>';
    } else {
        echo '<p>' . esc_html__('Input excerpt and client-supplied free-text report details were redacted because raw text storage was disabled for this report.', 'flavorpress-content-analyzer') . '</p>';
    }

    if (!empty($row['input_text'])) {
        echo '<details><summary>' . esc_html__('Stored raw input', 'flavorpress-content-analyzer') . '</summary><pre>' . esc_html((string) $row['input_text']) . '</pre></details>';
    }

    if (!is_array($result)) {
        echo '<p>' . esc_html__('Stored result JSON could not be decoded.', 'flavorpress-content-analyzer') . '</p>';
        return;
    }

    $storage = isset($result['storage']) && is_array($result['storage']) ? $result['storage'] : [];
    $trust_note = isset($storage['trustNote']) && is_string($storage['trustNote'])
        ? $storage['trustNote']
        : __('This browser-generated result was stored as a directional review signal and was not recomputed server-side.', 'flavorpress-content-analyzer');
    echo '<p class="description">' . esc_html($trust_note) . '</p>';

    $summary = isset($result['summary']) && is_array($result['summary']) ? $result['summary'] : [];
    echo '<h3>' . esc_html__('Summary', 'flavorpress-content-analyzer') . '</h3>';
    echo '<ul>';
    echo '<li>' . esc_html__('Quality:', 'flavorpress-content-analyzer') . ' ' . esc_html((string) ($summary['qualityBand'] ?? '')) . '</li>';
    echo '<li>' . esc_html__('Provenance-risk:', 'flavorpress-content-analyzer') . ' ' . esc_html(str_replace('_', ' ', (string) ($summary['provenanceBand'] ?? ''))) . '</li>';
    echo '<li>' . esc_html__('Source support:', 'flavorpress-content-analyzer') . ' ' . esc_html(str_replace('_', ' ', (string) ($summary['sourceBand'] ?? ''))) . '</li>';
    echo '</ul>';

    $sections = isset($result['analysisSections']) && is_array($result['analysisSections']) ? $result['analysisSections'] : [];
    foreach ($sections as $section) {
        if (!is_array($section) || empty($section['items']) || !is_array($section['items'])) {
            continue;
        }
        echo '<h3>' . esc_html((string) ($section['title'] ?? 'Report section')) . '</h3>';
        echo '<ul>';
        foreach (array_slice($section['items'], 0, 12) as $item) {
            if (!is_array($item)) {
                continue;
            }
            echo '<li><strong>' . esc_html((string) ($item['title'] ?? 'Item')) . ':</strong> ' . esc_html((string) ($item['body'] ?? '')) . '</li>';
        }
        echo '</ul>';
    }

    echo '<details><summary>' . esc_html__('Raw JSON', 'flavorpress-content-analyzer') . '</summary><pre>' . esc_html(wp_json_encode($result, JSON_PRETTY_PRINT)) . '</pre></details>';
}

function fpca_render_settings_page(): void
{
    if (!fpca_settings_permission()) {
        wp_die(esc_html__('You cannot manage analyzer settings.', 'flavorpress-content-analyzer'));
    }
    $settings = fpca_get_settings();
    echo '<div class="wrap">';
    echo '<h1>' . esc_html__('Content Analyzer Settings', 'flavorpress-content-analyzer') . '</h1>';
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('fpca_save_settings');
    echo '<input type="hidden" name="action" value="fpca_save_settings">';
    echo '<p><label><input type="checkbox" name="frontend_enabled" value="1" ' . checked($settings['frontend_enabled'], true, false) . '> ' . esc_html__('Allow public frontend submissions', 'flavorpress-content-analyzer') . '</label></p>';
    echo '<p><label><input type="checkbox" name="store_raw_text" value="1" ' . checked($settings['store_raw_text'], true, false) . '> ' . esc_html__('Store full raw input text for future reports', 'flavorpress-content-analyzer') . '</label></p>';
    echo '<p class="description">' . esc_html__('Raw text storage is off by default. When disabled, input excerpts, claim text, highlighted passages, detailed proofreading items, claim-specific recommendations, and other client-supplied free-text report details are redacted from stored reports. Stored reports still include salted hashes of the input, visitor IP plus user agent, and user agent for duplicate detection, rate limiting, and admin history. Reports are retained until an administrator deletes them.', 'flavorpress-content-analyzer') . '</p>';
    submit_button(__('Save settings', 'flavorpress-content-analyzer'));
    echo '</form></div>';
}

function fpca_save_settings(): void
{
    if (!fpca_settings_permission()) {
        wp_die(esc_html__('You cannot manage analyzer settings.', 'flavorpress-content-analyzer'));
    }
    check_admin_referer('fpca_save_settings');
    update_option('fpca_settings', [
        'frontend_enabled' => isset($_POST['frontend_enabled']),
        'store_raw_text' => isset($_POST['store_raw_text']),
    ]);
    wp_safe_redirect(admin_url('admin.php?page=fpca-settings&updated=1'));
    exit;
}
add_action('admin_post_fpca_save_settings', 'fpca_save_settings');

function fpca_delete_report(): void
{
    if (!fpca_admin_permission()) {
        wp_die(esc_html__('You cannot delete analyzer reports.', 'flavorpress-content-analyzer'));
    }
    $report_id = isset($_GET['report_id']) ? absint($_GET['report_id']) : 0;
    check_admin_referer('fpca_delete_report_' . $report_id);
    global $wpdb;
    if ($report_id) {
        $wpdb->delete(fpca_table_name(), ['id' => $report_id], ['%d']);
    }
    wp_safe_redirect(admin_url('admin.php?page=fpca-reports'));
    exit;
}
add_action('admin_post_fpca_delete_report', 'fpca_delete_report');
