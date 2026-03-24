# Jira MCP Server

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

A production-ready **Model Context Protocol (MCP)** server for Jira integration. Supports both **Jira Cloud** and **Jira Data Center/Server** with comprehensive issue management, board operations, time tracking, and project management capabilities.

## Features

### Core Functionality
- **Board Management**: List, filter, and manage Jira boards with detailed information
- **Issue Operations**: Create, update, search, transition, and manage issues comprehensively
- **User Management**: Search users, get user details, and manage assignments
- **Project Administration**: View projects, get detailed project information
- **Time Tracking**: Add and view work logs with flexible time formats
- **Comment System**: Add comments with rich text support

### Enhanced Features
- **Dual Authentication**: Supports both Jira Cloud (Basic Auth) and Jira Data Center/Server (Bearer Token)
- **Rate Limiting**: Intelligent API request throttling to respect Jira limits
- **Request Timeout**: Built-in 30-second timeout with AbortController
- **Comprehensive Logging**: Configurable logging with multiple levels
- **Error Handling**: Robust error handling with sanitized error messages
- **Input Validation**: Thorough validation and sanitization of all inputs
- **Security**: HTTPS enforcement, SSRF protection, sensitive data sanitization

## Requirements

- **Node.js**: 18.0.0 or higher
- **Jira**: Access to a Jira Cloud or Jira Data Center/Server instance
- **API Token**:
  - Jira Cloud: [Create API Token](https://id.atlassian.com/manage-profile/security/api-tokens)
  - Jira Server: Personal Access Token (Profile → Personal Access Tokens)

## Installation

### Option 1: Clone and Build

```bash
git clone https://github.com/JSM-CN/jira-mcp-server.git
cd jira-mcp-server
npm install
npm run build
```

### Option 2: Use Directly with npx

```bash
npx @jsm-cn/jira-mcp-server
```

## Configuration

### Environment Variables

Create a `.env` file or set these environment variables:

#### Jira Cloud

```bash
JIRA_BASE_URL=https://your-company.atlassian.net
JIRA_EMAIL=your-email@company.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_AUTH_TYPE=cloud
LOG_LEVEL=INFO  # Optional: ERROR, WARN, INFO, DEBUG
```

#### Jira Data Center/Server

```bash
JIRA_BASE_URL=https://jira.your-company.com
JIRA_API_TOKEN=your-personal-access-token
JIRA_AUTH_TYPE=server
LOG_LEVEL=INFO
```

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_BASE_URL` | Yes | Your Jira instance URL (must use HTTPS) |
| `JIRA_API_TOKEN` | Yes | API token (Cloud) or Personal Access Token (Server) |
| `JIRA_EMAIL` | Cloud only | Your Jira account email |
| `JIRA_AUTH_TYPE` | No | `cloud` (default) or `server` |
| `LOG_LEVEL` | No | Logging level: ERROR, WARN, INFO, DEBUG |

### Claude Code Configuration

Add to your `~/.claude/settings.json`:

```json
{
  "env": {
    "JIRA_BASE_URL": "https://your-company.atlassian.net",
    "JIRA_EMAIL": "your-email@company.com",
    "JIRA_API_TOKEN": "your-api-token",
    "JIRA_AUTH_TYPE": "cloud"
  }
}
```

And create `~/.mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/jira-mcp-server/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "${JIRA_BASE_URL}",
        "JIRA_EMAIL": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}",
        "JIRA_AUTH_TYPE": "${JIRA_AUTH_TYPE}",
        "LOG_LEVEL": "INFO"
      }
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_boards` | List all boards with optional filtering |
| `get_board_details` | Get detailed board information |
| `get_board_issues` | Get issues from a board with filters |
| `search_issues` | Search issues using JQL |
| `get_issue_details` | Get comprehensive issue information |
| `create_issue` | Create a new issue |
| `update_issue` | Update an existing issue |
| `transition_issue` | Move issue to a different status |
| `add_comment` | Add a comment to an issue |
| `get_current_user` | Get authenticated user info |
| `search_users` | Find users by name or email |
| `get_user_details` | Get detailed user information |
| `get_projects` | List all accessible projects |
| `get_project_details` | Get project information |
| `add_worklog` | Log work time on an issue |
| `get_worklogs` | View work logs for an issue |
| `get_server_info` | Get Jira server information |

## Usage Examples

### Natural Language Commands with Claude

```
"Show me all my open issues"
"Create a new bug in PROJECT-X about login issues"
"Move ticket PROJ-123 to In Progress"
"Log 2 hours of work on PROJ-456 for code review"
"Add a comment to PROJ-789 saying the fix is deployed"
"Show me all Scrum boards for the mobile project"
"Get details for issue PROJ-100 including comments"
```

### JQL Query Examples

```jql
# Your open issues
assignee = currentUser() AND status != Done

# Recent issues in a project
project = "MYPROJ" AND created >= -7d

# High priority bugs
priority = High AND issuetype = Bug

# Issues due this week
duedate >= startOfWeek() AND duedate <= endOfWeek()
```

## Security Features

This server implements multiple security measures:

- **HTTPS Enforcement**: All connections must use HTTPS
- **SSRF Protection**: Blocks requests to private IP addresses (10.x, 172.16-31.x, 192.168.x, localhost)
- **Input Sanitization**: JQL injection prevention and input length limits
- **Credential Protection**: Sensitive data is redacted in logs and error messages
- **Request Timeout**: 30-second timeout prevents resource exhaustion

## Development

### Setup

```bash
git clone https://github.com/JSM-CN/jira-mcp-server.git
cd jira-mcp-server
npm install
```

### Scripts

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build for production
npm run clean    # Clean build directory
npm run start    # Start production server
```

### Project Structure

```
src/
├── index.ts              # Main server entry point
├── jiraApiClient.ts      # Jira API client with auth support
├── toolRegistry.ts       # Tool registration and routing
├── types/
│   └── index.ts         # TypeScript type definitions
├── services/
│   ├── boardService.ts   # Board operations
│   ├── issueService.ts   # Issue operations
│   ├── userService.ts    # User operations
│   ├── projectService.ts # Project operations
│   ├── worklogService.ts # Worklog operations
│   └── serverService.ts  # Server operations
└── utils/
    ├── logger.ts        # Logging utility
    ├── rateLimiter.ts   # Rate limiting
    ├── validation.ts    # Input validation
    └── formatters.ts    # Response formatting
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Authentication Failed | Verify API token and email (Cloud) or PAT (Server) |
| Permission Denied | Check Jira permissions for your user |
| Connection Timeout | Check network connectivity and firewall settings |
| 401 Error on Jira Server | Use Personal Access Token, not Cloud API Token |

### Debug Mode

```bash
export LOG_LEVEL=DEBUG
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Inspired by the MCP community and best practices