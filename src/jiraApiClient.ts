import { JiraConfig, ApiResponse, JiraError } from './types/index.js';
import { Logger } from './utils/logger.js';
import { RateLimiter } from './utils/rateLimiter.js';

// Default request timeout in milliseconds (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

export type JiraAuthType = 'cloud' | 'server';

export class JiraApiClient {
  private config: JiraConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private authHeader: string;
  private timeoutMs: number;
  private authType: JiraAuthType;

  constructor(timeoutMs?: number) {
    this.config = this.getJiraConfig();
    this.logger = new Logger('JiraApiClient');
    this.rateLimiter = new RateLimiter();
    this.authType = (process.env.JIRA_AUTH_TYPE as JiraAuthType) || 'cloud';

    // For Jira Server, use Bearer token; for Jira Cloud, use Basic auth
    if (this.authType === 'server') {
      this.authHeader = `Bearer ${this.config.apiToken}`;
    } else {
      this.authHeader = `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`;
    }
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  private getJiraConfig(): JiraConfig {
    const baseUrl = process.env.JIRA_BASE_URL;
    const apiToken = process.env.JIRA_API_TOKEN;
    const email = process.env.JIRA_EMAIL; // Optional for Jira Server

    if (!baseUrl || !apiToken) {
      throw new Error(
        'Missing Jira configuration. Please set JIRA_BASE_URL and JIRA_API_TOKEN environment variables.'
      );
    }

    // Ensure baseUrl doesn't end with slash
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    return { baseUrl: cleanBaseUrl, email: email || '', apiToken };
  }

  /**
   * Get API options with correct version for Jira Cloud vs Server
   */
  private getApiOptions(): { useV3Api: boolean } {
    return { useV3Api: this.authType === 'cloud' };
  }

  async testConnection(): Promise<void> {
    try {
      // Jira Server/Data Center uses API v2, Jira Cloud supports v3
      await this.makeRequest('/myself', { useV3Api: this.authType === 'cloud' });
      this.logger.info('Jira connection test successful');
    } catch (error) {
      this.logger.error('Jira connection test failed:', error);
      throw new Error('Failed to connect to Jira. Please check your credentials and network connection.');
    }
  }

  async makeRequest<T = any>(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      useV3Api?: boolean;
      useAgileApi?: boolean;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      useV3Api = false,
      useAgileApi = false,
      headers = {},
    } = options;

    // Apply rate limiting
    await this.rateLimiter.waitForSlot();

    const apiPath = useAgileApi ? '/rest/agile/1.0' : useV3Api ? '/rest/api/3' : '/rest/api/2';
    const url = `${this.config.baseUrl}${apiPath}${endpoint}`;

    const requestHeaders = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Enhanced-Jira-MCP-Server/2.0.0',
      ...headers,
    };

    this.logger.debug(`Making ${method} request to: ${url}`);

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      // Only add body if it exists
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      // Clear timeout after successful fetch
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          // Sanitize error message to avoid leaking sensitive info
          errorMessage = this.sanitizeErrorMessage(
            errorJson.errorMessages?.join(', ') || errorJson.message || errorText
          );
        } catch {
          errorMessage = 'An error occurred';
        }

        throw new JiraError(
          `Jira API error: ${response.status}`,
          response.status,
          errorMessage
        );
      }

      const responseText = await response.text();
      if (!responseText) {
        return {} as T;
      }
      return JSON.parse(responseText) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      this.logger.error(`API request failed for endpoint ${endpoint}:`, this.sanitizeForLog(error));

      if (error instanceof JiraError) {
        throw error;
      }

      // Handle timeout/abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw new JiraError(
          'Request timed out',
          0,
          `Request exceeded timeout of ${this.timeoutMs}ms`
        );
      }

      throw new JiraError(
        'Network error occurred',
        0,
        'Unable to complete the request. Please check your network connection.'
      );
    }
  }

  /**
   * Sanitize error messages to prevent information leakage
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove potential sensitive information patterns
    const sensitivePatterns = [
      /token[=:]\s*\S+/gi,
      /password[=:]\s*\S+/gi,
      /api[-_]?key[=:]\s*\S+/gi,
      /secret[=:]\s*\S+/gi,
      /bearer\s+\S+/gi,
      /basic\s+\S+/gi,
    ];

    let sanitized = message;
    for (const pattern of sensitivePatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    return sanitized;
  }

  /**
   * Sanitize data before logging to prevent credential leakage
   */
  private sanitizeForLog(data: any): any {
    if (!data) return data;

    const sensitiveKeys = [
      'password', 'token', 'apiToken', 'apiKey', 'secret',
      'authorization', 'credential', 'auth', 'key'
    ];

    if (typeof data === 'object') {
      const sanitized: any = Array.isArray(data) ? [] : {};
      for (const key in data) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitizeForLog(data[key]);
        }
      }
      return sanitized;
    }

    return data;
  }

  // Board-related methods
  async getBoards(params: { type?: string; projectKeyOrId?: string } = {}): Promise<ApiResponse<any>> {
    const queryParams = new URLSearchParams();
    if (params.type) queryParams.append('type', params.type);
    if (params.projectKeyOrId) queryParams.append('projectKeyOrId', params.projectKeyOrId);
    
    const endpoint = `/board${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.makeRequest(endpoint, { useAgileApi: true });
  }

  async getBoard(boardId: string): Promise<any> {
    return this.makeRequest(`/board/${boardId}`, { useAgileApi: true });
  }

  async getBoardIssues(boardId: string, params: {
    jql?: string;
    maxResults?: number;
    startAt?: number;
    fields?: string[];
  } = {}): Promise<ApiResponse<any>> {
    const queryParams = new URLSearchParams();
    if (params.jql) queryParams.append('jql', params.jql);
    if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString());
    if (params.startAt) queryParams.append('startAt', params.startAt.toString());
    if (params.fields) queryParams.append('fields', params.fields.join(','));
    
    const endpoint = `/board/${boardId}/issue${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.makeRequest(endpoint, { useAgileApi: true });
  }

  // Issue-related methods
  async searchIssues(jql: string, params: {
    maxResults?: number;
    startAt?: number;
    fields?: string[];
    expand?: string[];
  } = {}): Promise<ApiResponse<any>> {
    const queryParams = new URLSearchParams();
    queryParams.append('jql', jql);
    if (params.maxResults) queryParams.append('maxResults', params.maxResults.toString());
    if (params.startAt) queryParams.append('startAt', params.startAt.toString());
    if (params.fields) queryParams.append('fields', params.fields.join(','));
    if (params.expand) queryParams.append('expand', params.expand.join(','));

    return this.makeRequest(`/search?${queryParams}`, this.getApiOptions());
  }

  async getIssue(issueIdOrKey: string, params: {
    fields?: string[];
    expand?: string[];
  } = {}): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params.fields) queryParams.append('fields', params.fields.join(','));
    if (params.expand) queryParams.append('expand', params.expand.join(','));

    const endpoint = `/issue/${issueIdOrKey}${queryParams.toString() ? `?${queryParams}` : ''}`;
    return this.makeRequest(endpoint, this.getApiOptions());
  }

  async addComment(issueIdOrKey: string, comment: string): Promise<any> {
    // Jira Cloud uses ADF, Jira Server uses plain text
    const body = this.authType === 'cloud' ? {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: comment }],
          },
        ],
      },
    } : { body: comment };

    return this.makeRequest(`/issue/${issueIdOrKey}/comment`, {
      method: 'POST',
      body,
      ...this.getApiOptions(),
    });
  }

  async updateIssue(issueIdOrKey: string, updateData: any): Promise<void> {
    await this.makeRequest(`/issue/${issueIdOrKey}`, {
      method: 'PUT',
      body: updateData,
      ...this.getApiOptions(),
    });
  }

  async createIssue(issueData: any): Promise<any> {
    return this.makeRequest('/issue', {
      method: 'POST',
      body: issueData,
      ...this.getApiOptions(),
    });
  }

  async transitionIssue(issueIdOrKey: string, transitionId: string, comment?: string): Promise<void> {
    const body: any = {
      transition: { id: transitionId }
    };

    if (comment) {
      if (this.authType === 'cloud') {
        body.update = {
          comment: [{
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: comment }]
                }]
              }
            }
          }]
        };
      } else {
        // Jira Server uses plain text for transition comments
        body.update = {
          comment: [{
            add: { body: comment }
          }]
        };
      }
    }

    await this.makeRequest(`/issue/${issueIdOrKey}/transitions`, {
      method: 'POST',
      body,
      ...this.getApiOptions(),
    });
  }

  async getIssueTransitions(issueIdOrKey: string): Promise<any> {
    return this.makeRequest(`/issue/${issueIdOrKey}/transitions`, this.getApiOptions());
  }

  // User-related methods
  async getCurrentUser(): Promise<any> {
    return this.makeRequest('/myself', this.getApiOptions());
  }

  async searchUsers(query: string): Promise<any[]> {
    // Jira Server uses 'username' parameter, Cloud uses 'query'
    const param = this.authType === 'cloud' ? 'query' : 'username';
    return this.makeRequest(`/user/search?${param}=${encodeURIComponent(query)}`, this.getApiOptions());
  }

  async getUser(accountId: string): Promise<any> {
    // Jira Server uses 'username', Cloud uses 'accountId'
    const param = this.authType === 'cloud' ? 'accountId' : 'username';
    return this.makeRequest(`/user?${param}=${accountId}`, this.getApiOptions());
  }

  // Project-related methods
  async getProjects(): Promise<any[]> {
    return this.makeRequest('/project', this.getApiOptions());
  }

  async getProject(projectIdOrKey: string): Promise<any> {
    return this.makeRequest(`/project/${projectIdOrKey}`, this.getApiOptions());
  }

  // Server info
  async getServerInfo(): Promise<any> {
    return this.makeRequest('/serverInfo', this.getApiOptions());
  }

  // Worklog methods
  async addWorklog(issueIdOrKey: string, timeSpent: string, comment?: string, startedDate?: string): Promise<any> {
    const body: any = {
      timeSpent,
      started: startedDate || new Date().toISOString(),
    };

    if (comment) {
      // Jira Cloud uses ADF, Jira Server uses plain text
      body.comment = this.authType === 'cloud' ? {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: comment }]
        }]
      } : comment;
    }

    return this.makeRequest(`/issue/${issueIdOrKey}/worklog`, {
      method: 'POST',
      body,
      ...this.getApiOptions(),
    });
  }

  async getWorklogs(issueIdOrKey: string): Promise<any> {
    return this.makeRequest(`/issue/${issueIdOrKey}/worklog`, this.getApiOptions());
  }
}