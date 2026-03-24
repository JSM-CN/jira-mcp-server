export function validateEnvironment(): void {
  const required = ['JIRA_BASE_URL', 'JIRA_API_TOKEN'];
  const missing = required.filter(env => !process.env[env]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please set the following environment variables:\n' +
      '- JIRA_BASE_URL: Your Jira instance URL (e.g., https://company.atlassian.net)\n' +
      '- JIRA_API_TOKEN: Your Jira API token\n' +
      '- JIRA_EMAIL: Your Jira account email (required for Jira Cloud)\n' +
      '- JIRA_AUTH_TYPE: "cloud" (default) or "server" for Jira Data Center'
    );
  }

  const authType = process.env.JIRA_AUTH_TYPE || 'cloud';

  // Jira Cloud requires email for Basic auth
  if (authType === 'cloud' && !process.env.JIRA_EMAIL) {
    throw new Error(
      'JIRA_EMAIL is required for Jira Cloud authentication. ' +
      'Set JIRA_AUTH_TYPE=server if using Jira Data Center with a Personal Access Token.'
    );
  }

  // Validate URL format
  const baseUrl = process.env.JIRA_BASE_URL!;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid JIRA_BASE_URL format: ${baseUrl}. Please provide a valid URL (e.g., https://company.atlassian.net)`);
  }

  // Enforce HTTPS to prevent credential leakage
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(
      `JIRA_BASE_URL must use HTTPS protocol. Current: ${parsedUrl.protocol}. ` +
      'HTTP connections expose your API token in plain text.'
    );
  }

  // SSRF protection: Block internal/private IP addresses
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedHosts = [
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
  ];

  if (blockedHosts.includes(hostname)) {
    throw new Error(
      `JIRA_BASE_URL cannot point to localhost or loopback addresses for security reasons.`
    );
  }

  // Block private IP ranges
  const privateIpPatterns = [
    /^127\./,                    // 127.0.0.0/8 (loopback)
    /^10\./,                     // 10.0.0.0/8 (Class A private)
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (Class B private)
    /^192\.168\./,               // 192.168.0.0/16 (Class C private)
    /^169\.254\./,               // 169.254.0.0/16 (link-local)
    /^0\.0\.0\.0$/,              // 0.0.0.0
    /^::1$/,                     // IPv6 loopback
    /^fc00:/i,                   // IPv6 private
    /^fe80:/i,                   // IPv6 link-local
  ];

  if (privateIpPatterns.some(pattern => pattern.test(hostname))) {
    throw new Error(
      `JIRA_BASE_URL cannot point to private/internal IP addresses for security reasons. ` +
      `Detected private address: ${hostname}`
    );
  }

  // Validate email format (only for cloud auth)
  if (authType === 'cloud') {
    const email = process.env.JIRA_EMAIL!;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error(`Invalid JIRA_EMAIL format: ${email}. Please provide a valid email address.`);
    }
  }

  // Validate auth type
  if (authType !== 'cloud' && authType !== 'server') {
    throw new Error(`Invalid JIRA_AUTH_TYPE: ${authType}. Must be "cloud" or "server".`);
  }
}

/**
 * Validate and sanitize JQL query to prevent injection attacks
 */
export function sanitizeJQL(jql: string): string {
  if (!jql || typeof jql !== 'string') {
    throw new Error('JQL query must be a non-empty string');
  }

  // Limit JQL length to prevent DoS
  const MAX_JQL_LENGTH = 10000;
  if (jql.length > MAX_JQL_LENGTH) {
    throw new Error(`JQL query exceeds maximum length of ${MAX_JQL_LENGTH} characters`);
  }

  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /;\s*(drop|delete|truncate|update|insert|alter|create|exec|execute)/i,
    /--/,
    /\/\*/,
    /\*\//,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(jql)) {
      throw new Error('JQL query contains potentially dangerous patterns');
    }
  }

  // Escape special characters in string literals within the JQL
  // This is a basic sanitization - Jira's JQL parser handles most escaping
  return jql.trim();
}

/**
 * Validate string input with length and format constraints
 */
export function validateStringInput(value: unknown, fieldName: string, options: {
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  required?: boolean;
} = {}): string {
  const { maxLength = 1000, minLength = 0, pattern, required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  if (value.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters`);
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must not exceed ${maxLength} characters`);
  }

  if (pattern && !pattern.test(value)) {
    throw new Error(`${fieldName} has invalid format`);
  }

  return value.trim();
}

/**
 * Validate issue key format (e.g., PROJ-123)
 */
export function validateIssueKey(issueKey: unknown): string {
  const keyPattern = /^[A-Z][A-Z0-9_]*-\d+$/i;
  return validateStringInput(issueKey, 'Issue key', {
    required: true,
    maxLength: 50,
    pattern: keyPattern,
  });
}

/**
 * Validate project key format (e.g., PROJ)
 */
export function validateProjectKey(projectKey: unknown): string {
  const keyPattern = /^[A-Z][A-Z0-9_]*$/i;
  return validateStringInput(projectKey, 'Project key', {
    required: true,
    maxLength: 20,
    pattern: keyPattern,
  });
}

/**
 * Validate numeric input with range constraints
 */
export function validateNumberInput(value: unknown, fieldName: string, options: {
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
} = {}): number | undefined {
  const { min, max, integer = false, required = false } = options;

  if (value === undefined || value === null) {
    if (required) {
      throw new Error(`${fieldName} is required`);
    }
    return undefined;
  }

  const num = Number(value);

  if (isNaN(num)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (integer && !Number.isInteger(num)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  if (min !== undefined && num < min) {
    throw new Error(`${fieldName} must be at least ${min}`);
  }

  if (max !== undefined && num > max) {
    throw new Error(`${fieldName} must not exceed ${max}`);
  }

  return num;
}