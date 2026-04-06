# skill.md Specification v1.0

## Overview

Skills are the extension system for PAW Agents. Each skill defines a complete, validated capability that the agent can use to execute tasks.

Skills are defined as `.skill.md` or `.skill.yaml` files in the `/skills` directory.

## Format

Skills use YAML frontmatter in a Markdown file:

```markdown
---
metadata:
  name: my-skill
  version: "1.0.0"
  # ... full YAML definition
---

# Human-readable documentation
```

## Required Fields

### metadata (required)

| Field       | Type     | Required | Description                     |
|-------------|----------|----------|---------------------------------|
| name        | string   | ✅       | Unique skill identifier         |
| version     | string   | ✅       | Semantic version                |
| author      | string   | ✅       | Skill author                    |
| description | string   | ✅       | What the skill does             |
| category    | string   | ✅       | Category (blockchain, api, etc) |
| tags        | string[] | ✅       | Searchable tags                 |

### capability (required)

| Field   | Type     | Required | Description                |
|---------|----------|----------|----------------------------|
| purpose | string   | ✅       | What the skill achieves    |
| actions | string[] | ✅       | Actions this skill handles |

### input_schema (required)

Array of input field definitions:

| Field      | Type    | Required | Description            |
|------------|---------|----------|------------------------|
| name       | string  | ✅       | Parameter name         |
| type       | string  | ✅       | Data type              |
| required   | boolean | ✅       | Is it required?        |
| validation | string  | ❌       | Validation rules       |
| default    | any     | ❌       | Default value          |
| description| string  | ✅       | What this param is for |

### output_schema (required)

| Field      | Type     | Required | Description              |
|------------|----------|----------|--------------------------|
| structure  | object   | ✅       | Output shape             |
| types      | object   | ✅       | Field types              |
| guarantees | string[] | ✅       | What the output promises |

### execution (required)

| Field                | Type     | Required | Description              |
|----------------------|----------|----------|--------------------------|
| execution_type       | string   | ✅       | `purp`, `js`, or `api`   |
| entrypoint           | string   | ✅       | Tool/function to call    |
| runtime_requirements | string[] | ✅       | Required packages        |
| dependencies         | string[] | ✅       | Other skills needed      |

### safety (required)

| Field                    | Type     | Required | Description                |
|--------------------------|----------|----------|----------------------------|
| max_transaction_lamports | number   | ❌       | Max SOL per tx (lamports)  |
| allowed_contracts        | string[] | ✅       | Solana programs allowed    |
| forbidden_actions        | string[] | ✅       | Actions that must be blocked|
| rate_limit_per_minute    | number   | ✅       | Max calls per minute       |

### permissions (required)

| Field            | Type     | Required | Description          |
|------------------|----------|----------|----------------------|
| allowed_actions  | string[] | ✅       | What the skill can do|
| forbidden_actions| string[] | ✅       | What is blocked      |

### Optional Fields

- **tools**: APIs, contracts, and permissions
- **validation**: Preconditions and postconditions
- **failure_modes**: Known risks and fallback strategies
- **examples**: Input/output pairs for testing

## Safety Rules

1. `rate_limit_per_minute` cannot exceed 100
2. `max_transaction_lamports` cannot exceed 10 SOL (10,000,000,000)
3. Globally forbidden actions cannot be overridden:
   - `upgrade_program`
   - `close_account_owner_override`
4. All skills are validated at load time
5. Invalid skills are rejected, not partially loaded

## Example

See `/skills/examples/` for complete, working examples.
