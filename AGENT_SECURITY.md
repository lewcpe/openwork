# OpenWork Agent Security Model

This document outlines the security controls, execution boundaries, and mechanisms that OpenWork employs to limit agent actions, prevent unauthorized access to sensitive data, and constrain capabilities.

## Execution Boundaries & Workspace Isolation

OpenWork anchors the execution of agents within defined workspaces.

### The `external_directory` Permission
Agents are generally restricted from interacting with the file system outside the active workspace directory. Access beyond the workspace requires explicit authorization via the `external_directory` configuration.

- **Storage:** The authorized paths are persisted as part of the `permission.external_directory` configuration inside the runtime config (stored in SQLite under `.config/openwork/runtime.sqlite` or derived files).
- **Enforcement:** The server actively checks and synchronizes these paths. When an agent requests to read/edit outside the workspace, the permission approval mechanism surfaces a detailed prompt (e.g., `session.permission_message_external_directory`) demanding user review before action can proceed.
- **Hidden Entries:** Paths that cannot be cleanly resolved or are legacy form entries might be retained as hidden entries, maintaining backward compatibility while preventing obscure path escalations.

## Automation and Capabilities Control

### Browser Automation
Browser automation is strictly confined to the built-in "OpenWork Browser".

- **Scope limitation:** The internal OpenWork Browser isolates web interactions. By default, OpenWork will not attempt to automate a user's standard desktop browsers (e.g., Chrome, Firefox, Safari) or full OS desktop UI, preventing unauthorized access to logged-in user sessions, cookies, or personal desktop apps.
- **Provider control:** This capability is governed by `toolProviders.browser`. If this extension is disabled (e.g., via `Settings > Extensions`), the agent loses browser access entirely.

### Desktop App Policies & Feature Gates
Capabilities are gated through a robust set of Desktop App Policies (`desktopPolicyDefinitions`).

- **Policy enforcement:** Features like running local bash commands, writing files, and using custom AI models are mediated via hooks like `useCheckDesktopRestriction()`.
- **Role restrictions:** A user's role on the cloud (`Owner`, `Admin`, `Member`) controls which policies apply, heavily restricting standard `Member` or `Viewer` tokens from elevating privileges or modifying the underlying configuration.

## Command & Tool Permissions Framework

All potentially risky agent actions require user consent mediated by a structured permission system.

### Permission Approval Intercept
Whenever an agent tries to execute a command, read/edit a file, access an external directory, or call an MCP tool, the execution is halted and a permission request is dispatched to the UI.

- The system breaks down the request into `scopeValue` (the affected folder/file or bash command) and `metadata` for precise user review.
- The user can select `Allow Once`, `Allow for Session`, or `Deny`.

### "Doom Loop" Protection
To prevent runaway agents from continuously calling a failing tool or making repeated unauthorized requests:
- OpenWork detects a "doom loop" (when an agent repeats a request endlessly) and triggers a specific `doom_loop` permission prompt.
- This forces a manual intervention step, breaking automated retry cycles and conserving resources while avoiding brute-force automation errors.

### Actor Scopes
- **Viewers:** The server explicitly rejects interactive state changes from `viewer` tokens. For instance, `viewer` scopes are blocked from self-approving permission requests via the OpenCode proxy, mitigating risk if a read-only token is compromised.

## Cloud & Identity Level Security

The security posture extends to identity and configuration level limits described in `packages/docs/cloud/security-and-operations.mdx`.
- **RBAC & Secrets:** Only properly authenticated users (`Owner`, `Admin` with `security_configuration.manage` permissions) can modify API keys, SSO configs, and organization-level secrets.
- **Proxy limitations:** OpenWork leverages local-first architectures but requires robust TLS, encrypted at rest storage, and proper Identity Management when operating in a team context.
